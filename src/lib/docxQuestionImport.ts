import type { QuestionAsset } from "../types";

export type ImportedQuestionAsset =
  | {
      id: string;
      kind: "image";
      dataUrl: string;
      sourceIndex: number;
    }
  | {
      id: string;
      kind: "table";
      html: string;
      plainText: string;
      sourceIndex: number;
    };

export type ImportedQuestion = {
  stem: string;
  choices: string[];
  correctIndex: number;
  assets: ImportedQuestionAsset[];
};

/** Internal ordered blocks from the Word HTML (document order). */
export type ImportedDocBlock =
  | { kind: "paragraph"; text: string; hasBold: boolean; sourceIndex: number }
  | { kind: "image"; asset: ImportedQuestionAsset; sourceIndex: number }
  | { kind: "table"; asset: ImportedQuestionAsset; sourceIndex: number };

export type ImportedAssetLinkGroup = {
  assetId: string;
  asset: ImportedQuestionAsset;
  startQuestion1: number;
  endQuestion1: number;
};

export type ImportDebugReport = {
  htmlParagraphCount: number;
  htmlImageCount: number;
  htmlTableCount: number;
  rawLineCount: number;
  htmlLineCount: number;
  tokenCount: number;
  expectedChoicesPerQuestion: number | null;
  parsedFromTokenCount: number;
  parsedFromRawCount: number;
  finalQuestionCount: number;
  fallbackUsed: "none" | "raw-count";
  assetMatch: {
    exactStem: number;
    fuzzyStem: number;
    positional: number;
  };
  warnings: string[];
};

type ImportOptions = {
  expectedChoicesPerQuestion?: number;
  onWarnings?: (warnings: string[]) => void;
  onDebug?: (debug: ImportDebugReport) => void;
};

type ParsedLine = {
  text: string;
  hasBold: boolean;
};

type ParseState = {
  stemLines: string[];
  choices: string[];
  correctIndex: number | null;
  answerText: string | null;
  lastChoiceIndex: number | null;
  sawLabeledChoice: boolean;
  sawQuestionStart: boolean;
  assets: ImportedQuestionAsset[];
};

type ParseToken =
  | { kind: "text"; line: ParsedLine }
  | { kind: "asset"; asset: ImportedQuestionAsset };

const QUESTION_START_RE = /^(?:(?:\(?\d+\)?[\).\-\s]+)|(?:\d+\s+)|q(?:uestion)?\s*\d+[:.)\-\s]+)/i;
const CHOICE_RE = /^([A-Z])[)\].:\-\s]+\s*(.+)$/i;
// Numeric answer labels should not consume numbered stems like "1. Question ...".
const NUMERIC_CHOICE_RE = /^(\d+)[)\]:\-\s]+\s*(.+)$/;
const ROMAN_CHOICE_RE = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)[)\].:\-\s]+\s*(.+)$/i;
const BULLET_CHOICE_RE = /^(?:[-*•])\s+(.+)$/;
const ANSWER_RE = /^(?:answer|correct answer)\s*[:\-]\s*([A-Z])\b/i;
const ANSWER_TEXT_RE = /^(?:answer|correct answer)\s*[:\-]\s*(.+)$/i;
const STAR_MARK_RE = /\*([^*]+)\*/;
const NEW_QUESTION_CANDIDATE_RE = /^[A-Z][A-Za-z0-9"'\-(),\s]{14,}$/;

const VISUAL_CUE_RE =
  /\b(diagram|figure|image|chart|graph|table|map|model|framework|structure|shown|represented\b|according to the (?:diagram|table)|above|below|illustrated)\b/i;
const SHAPE_COLOR_RE =
  /\b(circle|rectangle|square|box|arrow|line|column|row|cell|green|blue|yellow|red|orange|shaded|highlighted)\b/i;

function makeAssetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `asset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSpace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function makeState(): ParseState {
  return {
    stemLines: [],
    choices: [],
    correctIndex: null,
    answerText: null,
    lastChoiceIndex: null,
    sawLabeledChoice: false,
    sawQuestionStart: false,
    assets: [],
  };
}

function isLikelyHeadingOrCaption(text: string): boolean {
  const t = normalizeSpace(text);
  if (!t) return true;
  if (/^(figure|table)\s+\d+[\.:]/i.test(t)) return true;
  if (/^(studydeck|purpose:|formatting notes)/i.test(t)) return true;
  if (
    /\b(?:multiple-choice questions with visuals|answer labels intentionally vary|correct answers are bolded|each visual is meant to be used)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 6 && !/[?:]/.test(t)) {
    const titleLike = words.every((w) => /^[A-Z][a-z0-9'/-]*$/.test(w));
    if (titleLike) return true;
  }
  return false;
}

function isLikelyQuestionStem(stem: string, sawQuestionStart: boolean): boolean {
  const s = normalizeSpace(stem);
  if (!s) return false;
  if (isLikelyHeadingOrCaption(s)) return false;
  if (sawQuestionStart) return true;
  if (/\?$/.test(s)) return true;
  if (
    /^(which|what|who|when|where|why|how|according to|in relation to|based on|from the|the .* refers to|the .* represents)/i.test(
      s,
    )
  ) {
    return true;
  }
  return s.length >= 45 && /\b(?:is|are|does|do|refers|represents|comes|contains)\b/i.test(s);
}

function pushAssetUnique(list: ImportedQuestionAsset[], asset: ImportedQuestionAsset): void {
  if (
    list.some((x) => {
      if (x.id === asset.id) return true;
      if (x.kind !== asset.kind) return false;
      if (x.kind === "image" && asset.kind === "image") {
        return normalizeSpace(x.dataUrl) === normalizeSpace(asset.dataUrl);
      }
      if (x.kind === "table" && asset.kind === "table") {
        return (
          normalizeSpace(x.html) === normalizeSpace(asset.html) ||
          normalizeSpace(x.plainText) === normalizeSpace(asset.plainText)
        );
      }
      return false;
    })
  ) {
    return;
  }
  list.push(asset);
}

export function importedAssetContentKey(asset: ImportedQuestionAsset): string {
  if (asset.kind === "image") {
    return `image:${normalizeSpace(asset.dataUrl)}`;
  }
  const tableBasis = normalizeSpace(asset.plainText) || normalizeSpace(asset.html);
  return `table:${tableBasis}`;
}

function toQuestion(state: ParseState): ImportedQuestion | null {
  const stem = normalizeSpace(state.stemLines.join(" "));
  if (!stem) return null;
  if (!isLikelyQuestionStem(stem, state.sawQuestionStart)) {
    return null;
  }
  const validChoices = state.choices.map((c) => normalizeSpace(c)).filter((c) => c.length > 0);
  if (validChoices.length < 2) return null;
  let correctIndex = state.correctIndex;
  if ((correctIndex === null || correctIndex < 0 || correctIndex >= validChoices.length) && state.answerText) {
    const answerText = normalizeSpace(state.answerText).toLowerCase();
    const byExact = validChoices.findIndex((c) => c.toLowerCase() === answerText);
    if (byExact >= 0) correctIndex = byExact;
    if (byExact < 0) {
      const byIncludes = validChoices.findIndex((c) => c.toLowerCase().includes(answerText));
      if (byIncludes >= 0) correctIndex = byIncludes;
    }
  }
  if (correctIndex === null || correctIndex < 0 || correctIndex >= validChoices.length) {
    correctIndex = 0;
  }
  return {
    stem,
    choices: validChoices,
    correctIndex,
    assets: [...state.assets],
  };
}

export function questionNeedsVisualCue(stem: string): boolean {
  return VISUAL_CUE_RE.test(stem) || SHAPE_COLOR_RE.test(stem);
}

export function questionVisualCueScore(stem: string): number {
  let s = 0;
  if (VISUAL_CUE_RE.test(stem)) s += 2;
  const m = stem.match(SHAPE_COLOR_RE);
  if (m) s += m.length;
  return s;
}

function tokenizeStem(s: string): string[] {
  return s
    .toLowerCase()
    .replace(QUESTION_START_RE, "")
    .split(/\W+/)
    .filter((w) => w.length > 2);
}

export function questionLooksRelatedToPrevious(previousStem: string, currentStem: string): boolean {
  if (!previousStem || !currentStem) return false;
  const prev = previousStem.trim();
  const curr = currentStem.trim();
  const a = prev.replace(/^(the|a|an)\s+/i, "").trim();
  const b = curr.replace(/^(the|a|an)\s+/i, "").trim();
  const aParts = a.split(/\s+/).filter(Boolean);
  const bParts = b.split(/\s+/).filter(Boolean);
  if (aParts.length >= 2 && bParts.length >= 2) {
    const lastA = aParts[aParts.length - 1] ?? "";
    const lastB = bParts[bParts.length - 1] ?? "";
    const firstA = aParts[0] ?? "";
    const firstB = bParts[0] ?? "";
    if (
      lastA.toLowerCase() === lastB.toLowerCase() &&
      firstA.toLowerCase() !== firstB.toLowerCase()
    ) {
      if (/^(red|blue|green|yellow|orange|black|white|gray|grey|purple|pink|brown)$/i.test(firstA)) {
        if (/^(red|blue|green|yellow|orange|black|white|gray|grey|purple|pink|brown)$/i.test(firstB)) {
          return true;
        }
      }
    }
  }
  const A = new Set(tokenizeStem(prev));
  const B = new Set(tokenizeStem(curr));
  let inter = 0;
  for (const t of A) {
    if (B.has(t)) inter += 1;
  }
  const union = A.size + B.size - inter;
  if (union === 0) return false;
  return inter / union >= 0.35 && inter >= 2;
}

function isStrongSectionHeading(text: string): boolean {
  const t = text.trim();
  if (t.length > 60 || t.length < 3) return false;
  if (/^(part|section|chapter|unit)\s+[ivxlcdm\d]+/i.test(t)) return true;
  if (/^[A-Z0-9][A-Z0-9\s\-]{2,50}$/.test(t) && t === t.toUpperCase() && !/\?/.test(t)) return true;
  return false;
}

function stemsClearlyUnrelated(prevStem: string, currStem: string): boolean {
  if (!prevStem || !currStem) return false;
  if (questionLooksRelatedToPrevious(prevStem, currStem)) return false;
  const a = new Set(tokenizeStem(prevStem));
  const b = new Set(tokenizeStem(currStem));
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  return inter === 0 && a.size >= 3 && b.size >= 3;
}

/**
 * Extend diagram/table associations across consecutive related questions (first pass is position-only).
 */
function applyHeuristicAssetInheritance(questions: ImportedQuestion[]): void {
  let inherited: ImportedQuestionAsset[] = [];
  let noCueStreak = 0;
  let prevStem = "";

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i]!;
    const stem = q.stem;

    if (isStrongSectionHeading(stem)) {
      inherited = [];
      noCueStreak = 0;
    }

    const direct = q.assets.length > 0;
    if (direct) {
      inherited = q.assets.map((a) => ({ ...a }));
      noCueStreak = 0;
      prevStem = stem;
      continue;
    }

    if (inherited.length === 0) {
      prevStem = stem;
      continue;
    }

    if (stemsClearlyUnrelated(prevStem, stem)) {
      inherited = [];
      noCueStreak = 0;
      prevStem = stem;
      continue;
    }

    const needs = questionNeedsVisualCue(stem);
    const related = questionLooksRelatedToPrevious(prevStem, stem);
    const score = questionVisualCueScore(stem);
    const shouldAttach = needs || related || score >= 2;

    if (shouldAttach) {
      for (const a of inherited) {
        pushAssetUnique(q.assets, { ...a });
      }
      noCueStreak = needs || score > 0 ? 0 : noCueStreak + 1;
    } else {
      noCueStreak += 1;
    }

    if (noCueStreak >= 3) {
      inherited = [];
      noCueStreak = 0;
    }

    prevStem = stem;
  }
}

function linesFromRawText(text: string): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ text: line, hasBold: false }));
}

function fragmentHasBold(fragmentHtml: string): boolean {
  if (!fragmentHtml.trim()) return false;
  const tmp = document.createElement("div");
  tmp.innerHTML = fragmentHtml;
  return (
    tmp.querySelector("strong,b") !== null ||
    !!tmp.querySelector('[style*="font-weight: bold"], [style*="font-weight:700"]')
  );
}

/** Split Google-Docs-style blobs: <br>, newlines, and inline <img> into ordered blocks. */
function expandElementToBlocks(el: HTMLElement, sourceIndexRef: { n: number }): ImportedDocBlock[] {
  const blocks: ImportedDocBlock[] = [];
  const rawHtml = el.innerHTML;
  const imgTagSplitRe = new RegExp("(<img\\b[^>]*>)", "gi");
  const imgSplit = rawHtml.split(imgTagSplitRe);

  const pushParagraphLinesFromHtmlChunk = (chunkHtml: string, inheritedBold: boolean): void => {
    const trimmed = chunkHtml.trim();
    if (!trimmed) return;
    const brParts = trimmed.split(new RegExp("<br\\s*/?>", "i"));
    for (const brChunk of brParts) {
      const piece = brChunk.trim();
      if (!piece) continue;
      const tmp = document.createElement("div");
      tmp.innerHTML = piece;
      const nlPieces = (tmp.textContent ?? "")
        .split(/\r?\n/)
        .map((s) => normalizeSpace(s))
        .filter((s) => s.length > 0);
      if (nlPieces.length <= 1) {
        const text = normalizeSpace(tmp.textContent ?? "");
        if (!text) continue;
        const hasBold = fragmentHasBold(piece) || inheritedBold;
        const si = sourceIndexRef.n;
        sourceIndexRef.n += 1;
        blocks.push({ kind: "paragraph", text, hasBold, sourceIndex: si });
      } else {
        for (const text of nlPieces) {
          const hasBold =
            inheritedBold ||
            el.querySelector("strong,b") !== null ||
            !!el.querySelector('[style*="font-weight: bold"], [style*="font-weight:700"]');
          const si = sourceIndexRef.n;
          sourceIndexRef.n += 1;
          blocks.push({ kind: "paragraph", text, hasBold, sourceIndex: si });
        }
      }
    }
  };

  const inheritedBold =
    el.querySelector("strong,b") !== null ||
    !!el.querySelector('[style*="font-weight: bold"], [style*="font-weight:700"]');

  for (const part of imgSplit) {
    if (!part) continue;
    if (new RegExp("^<img\\b", "i").test(part.trim())) {
      const wrap = document.createElement("div");
      wrap.innerHTML = part.trim();
      const img = wrap.querySelector("img");
      if (img) {
        const src = normalizeSpace(img.getAttribute("src") ?? "");
        if (src) {
          const asset: ImportedQuestionAsset = {
            id: makeAssetId(),
            kind: "image",
            dataUrl: src,
            sourceIndex: sourceIndexRef.n,
          };
          blocks.push({ kind: "image", asset, sourceIndex: sourceIndexRef.n });
          sourceIndexRef.n += 1;
        }
      }
      continue;
    }
    pushParagraphLinesFromHtmlChunk(part, inheritedBold);
  }

  if (blocks.length === 0) {
    const text = normalizeSpace(el.textContent ?? "");
    if (text) {
      blocks.push({
        kind: "paragraph",
        text,
        hasBold: inheritedBold,
        sourceIndex: sourceIndexRef.n,
      });
      sourceIndexRef.n += 1;
    }
  }

  return blocks;
}

function collectOrderedFlowElements(body: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const visit = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const tag = child.tagName.toLowerCase();
      if (child instanceof HTMLImageElement || tag === "img") {
        out.push(child);
        continue;
      }
      if (child instanceof HTMLTableElement || tag === "table") {
        out.push(child);
        continue;
      }
      if (tag === "ul" || tag === "ol") {
        for (const li of Array.from(child.children)) {
          if (li instanceof HTMLElement && li.tagName.toLowerCase() === "li") {
            out.push(li);
          }
        }
        continue;
      }
      if (tag === "p" || tag === "li" || /^h[1-6]$/.test(tag)) {
        out.push(child);
        continue;
      }
      if (tag === "div" || tag === "section" || tag === "article" || tag === "main" || tag === "header") {
        visit(child);
        continue;
      }
      visit(child);
    }
  };
  visit(body);
  return out;
}

function linesFromHtml(html: string): ParsedLine[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  if (!body) return [];
  const lines: ParsedLine[] = [];
  const si = { n: 0 };
  for (const el of collectOrderedFlowElements(body)) {
    if (el instanceof HTMLTableElement || el instanceof HTMLImageElement) continue;
    for (const b of expandElementToBlocks(el, si)) {
      if (b.kind === "paragraph") {
        lines.push({ text: b.text, hasBold: b.hasBold });
      }
    }
  }
  return lines;
}

function sanitizeTableHtml(table: HTMLTableElement): string {
  const out = document.createElement("table");
  for (const trSrc of table.querySelectorAll("tr")) {
    const tr = document.createElement("tr");
    for (const cellSrc of trSrc.querySelectorAll("th, td")) {
      const tag = cellSrc.tagName.toLowerCase() === "th" ? "th" : "td";
      const cell = document.createElement(tag);
      const cs = cellSrc.getAttribute("colspan");
      const rs = cellSrc.getAttribute("rowspan");
      if (cs && /^\d+$/.test(cs)) cell.setAttribute("colspan", cs);
      if (rs && /^\d+$/.test(rs)) cell.setAttribute("rowspan", rs);
      cell.textContent = cellSrc.textContent ?? "";
      tr.appendChild(cell);
    }
    if (tr.childNodes.length > 0) out.appendChild(tr);
  }
  return out.outerHTML;
}

function tablePlainText(table: HTMLTableElement): string {
  const lines: string[] = [];
  for (const tr of table.querySelectorAll("tr")) {
    const cells = Array.from(tr.querySelectorAll("th, td")).map((c) => normalizeSpace(c.textContent ?? ""));
    if (cells.some((c) => c.length > 0)) lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

function htmlToOrderedBlocks(html: string): ImportedDocBlock[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  if (!body) return [];
  const blocks: ImportedDocBlock[] = [];
  const sourceIndexRef = { n: 0 };

  for (const el of collectOrderedFlowElements(body)) {
    if (el instanceof HTMLTableElement) {
      const htmlStr = sanitizeTableHtml(el);
      const plainText = tablePlainText(el);
      const asset: ImportedQuestionAsset = {
        id: makeAssetId(),
        kind: "table",
        html: htmlStr,
        plainText,
        sourceIndex: sourceIndexRef.n,
      };
      blocks.push({ kind: "table", asset, sourceIndex: sourceIndexRef.n });
      sourceIndexRef.n += 1;
      continue;
    }

    if (el instanceof HTMLImageElement) {
      const src = normalizeSpace(el.getAttribute("src") ?? "");
      if (src) {
        const asset: ImportedQuestionAsset = {
          id: makeAssetId(),
          kind: "image",
          dataUrl: src,
          sourceIndex: sourceIndexRef.n,
        };
        blocks.push({ kind: "image", asset, sourceIndex: sourceIndexRef.n });
        sourceIndexRef.n += 1;
      }
      continue;
    }

    const expanded = expandElementToBlocks(el, sourceIndexRef);
    for (const b of expanded) {
      blocks.push(b);
    }
  }

  return blocks;
}

function blocksToTokens(blocks: ImportedDocBlock[]): ParseToken[] {
  const tokens: ParseToken[] = [];
  for (const b of blocks) {
    if (b.kind === "paragraph") {
      tokens.push({
        kind: "text",
        line: { text: b.text, hasBold: b.hasBold },
      });
    } else {
      tokens.push({ kind: "asset", asset: b.asset });
    }
  }
  return tokens;
}

function letterIndex(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - 65;
}

function romanIndex(roman: string): number | null {
  const map: Record<string, number> = {
    i: 0,
    ii: 1,
    iii: 2,
    iv: 3,
    v: 4,
    vi: 5,
    vii: 6,
    viii: 7,
    ix: 8,
    x: 9,
  };
  const key = roman.toLowerCase();
  return key in map ? map[key]! : null;
}

function stripStarMarkers(input: string): { text: string; hadMarker: boolean } {
  const hadMarker = STAR_MARK_RE.test(input);
  const text = input.replace(/\*/g, "").trim();
  return { text, hadMarker };
}

function isQuestionLine(text: string): boolean {
  return QUESTION_START_RE.test(text) || /\?\s*$/.test(text) || /:\s*$/.test(text);
}

function looksLikeChoiceContinuation(text: string): boolean {
  const t = normalizeSpace(text);
  if (!t) return false;
  if (/^[a-z]/.test(t)) return true;
  if (/^[,.;:)\]-]/.test(t)) return true;
  if (/^(?:and|or|with|to|of|the|for|in|on|by)\b/i.test(t)) return true;
  if (NEW_QUESTION_CANDIDATE_RE.test(t)) return false;
  return t.length <= 18;
}

function looksLikePotentialStem(text: string): boolean {
  const t = normalizeSpace(text);
  if (!t) return false;
  if (isQuestionLine(t)) return true;
  if (CHOICE_RE.test(t) || BULLET_CHOICE_RE.test(t) || ANSWER_RE.test(t)) return false;
  if (t.length < 18) return false;
  if (/^(?:true|false|yes|no)$/i.test(t)) return false;
  // Typical long statement stem in these banks (often without question marks).
  return /^[A-Z0-9"“]/.test(t);
}

function inferExpectedChoicesPerQuestion(lines: ParsedLine[]): number | null {
  const counts: number[] = [];
  let inQuestion = false;
  let choiceCount = 0;
  for (const line of lines) {
    if (isQuestionLine(line.text)) {
      if (inQuestion && choiceCount >= 2) counts.push(choiceCount);
      inQuestion = true;
      choiceCount = 0;
      continue;
    }
    if (!inQuestion) continue;
    if (line.text.match(ANSWER_RE)) continue;
    choiceCount += 1;
  }
  if (inQuestion && choiceCount >= 2) counts.push(choiceCount);
  if (counts.length === 0) return null;
  const freq = new Map<number, number>();
  for (const n of counts) {
    if (n < 2 || n > 10) continue;
    freq.set(n, (freq.get(n) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestFreq = -1;
  for (const [n, f] of freq.entries()) {
    if (f > bestFreq) {
      best = n;
      bestFreq = f;
    }
  }
  // Sergeant-style banks frequently have 3 choices and omit reliable question punctuation.
  return best ?? 3;
}

function parseQuestionBankTokens(
  tokens: ParseToken[],
  opts?: { expectedChoicesPerQuestion?: number | null },
): ImportedQuestion[] {
  const cleanTokens: ParseToken[] = [];
  for (const t of tokens) {
    if (t.kind === "text") {
      const text = normalizeSpace(t.line.text);
      if (!text) continue;
      cleanTokens.push({ kind: "text", line: { text, hasBold: t.line.hasBold } });
    } else {
      cleanTokens.push(t);
    }
  }

  const parsed: ImportedQuestion[] = [];
  let state = makeState();
  let pendingAssets: ImportedQuestionAsset[] = [];
  const expectedChoicesPerQuestion =
    typeof opts?.expectedChoicesPerQuestion === "number" && opts.expectedChoicesPerQuestion >= 2
      ? Math.floor(opts.expectedChoicesPerQuestion)
      : null;

  const attachPendingToNewQuestion = () => {
    for (const a of pendingAssets) {
      pushAssetUnique(state.assets, a);
    }
    pendingAssets = [];
  };

  const flushStateQuestionOrCarryAssets = () => {
    const maybe = toQuestion(state);
    if (maybe) {
      parsed.push(maybe);
      return;
    }
    // If the block was discarded (heading/caption), carry any captured assets
    // forward so the next valid question can still inherit them.
    for (const a of state.assets) {
      pushAssetUnique(pendingAssets, a);
    }
  };

  for (const tok of cleanTokens) {
    if (tok.kind === "asset") {
      const inQuestion = state.stemLines.length > 0 || state.choices.length > 0;
      if (inQuestion) {
        pushAssetUnique(state.assets, tok.asset);
      } else {
        pushAssetUnique(pendingAssets, tok.asset);
      }
      continue;
    }

    const line = tok.line;
    const answerMatch = line.text.match(ANSWER_RE);
    if (answerMatch) {
      const letter = answerMatch[1]?.toUpperCase();
      if (letter && letter.length === 1) {
        const i = letterIndex(letter);
        if (i >= 0) state.correctIndex = i;
      }
      continue;
    }
    const answerTextMatch = line.text.match(ANSWER_TEXT_RE);
    if (answerTextMatch) {
      const answerText = normalizeSpace(answerTextMatch[1] ?? "");
      if (answerText) state.answerText = answerText;
      continue;
    }

    if (isQuestionLine(line.text)) {
      flushStateQuestionOrCarryAssets();
      state = makeState();
      attachPendingToNewQuestion();
      state.stemLines.push(line.text.replace(QUESTION_START_RE, "").trim());
      state.sawQuestionStart = true;
      continue;
    }

    const romanChoice = line.text.match(ROMAN_CHOICE_RE);
    if (romanChoice && state.stemLines.length > 0) {
      const index = romanIndex(romanChoice[1] ?? "");
      const content = romanChoice[2] ?? "";
      if (index !== null && index >= 0 && index < 12) {
        while (state.choices.length <= index) state.choices.push("");
        const { text: cleanChoice, hadMarker } = stripStarMarkers(content);
        state.choices[index] = cleanChoice;
        state.lastChoiceIndex = index;
        state.sawLabeledChoice = true;
        if (hadMarker || line.hasBold) state.correctIndex = index;
        continue;
      }
    }

    const choiceMatch = line.text.match(CHOICE_RE);
    if (choiceMatch) {
      const letter = choiceMatch[1]!.toUpperCase();
      const content = choiceMatch[2] ?? "";
      const i = letterIndex(letter);
      if (i < 0) continue;
      while (state.choices.length <= i) state.choices.push("");
      const { text: cleanChoice, hadMarker } = stripStarMarkers(content);
      state.choices[i] = cleanChoice;
      state.lastChoiceIndex = i;
      state.sawLabeledChoice = true;
      if (hadMarker || line.hasBold) state.correctIndex = i;
      continue;
    }
    const numericChoice = line.text.match(NUMERIC_CHOICE_RE);
    if (numericChoice && state.stemLines.length > 0) {
      const index = Number.parseInt(numericChoice[1] ?? "", 10) - 1;
      const content = numericChoice[2] ?? "";
      if (Number.isFinite(index) && index >= 0 && index < 12) {
        while (state.choices.length <= index) state.choices.push("");
        const { text: cleanChoice, hadMarker } = stripStarMarkers(content);
        state.choices[index] = cleanChoice;
        state.lastChoiceIndex = index;
        state.sawLabeledChoice = true;
        if (hadMarker || line.hasBold) state.correctIndex = index;
        continue;
      }
    }

    const bulletChoice = line.text.match(BULLET_CHOICE_RE);
    if (bulletChoice && state.choices.length > 0) {
      const idx = state.choices.length;
      const { text: cleanChoice, hadMarker } = stripStarMarkers(bulletChoice[1] ?? "");
      state.choices.push(cleanChoice);
      state.lastChoiceIndex = idx;
      if (hadMarker || line.hasBold) state.correctIndex = idx;
      continue;
    }

    if (state.sawLabeledChoice) {
      if (
        expectedChoicesPerQuestion !== null &&
        state.lastChoiceIndex !== null &&
        state.choices.length < expectedChoicesPerQuestion &&
        looksLikeChoiceContinuation(line.text)
      ) {
        const idx = state.lastChoiceIndex;
        state.choices[idx] = `${state.choices[idx]} ${line.text}`.trim();
        continue;
      }

      flushStateQuestionOrCarryAssets();
      state = makeState();
      attachPendingToNewQuestion();
      state.stemLines.push(line.text.replace(QUESTION_START_RE, "").trim());
      state.sawQuestionStart = isQuestionLine(line.text);
      continue;
    }

    if (
      expectedChoicesPerQuestion !== null &&
      state.stemLines.length > 0 &&
      state.choices.length >= expectedChoicesPerQuestion
    ) {
      flushStateQuestionOrCarryAssets();
      state = makeState();
      attachPendingToNewQuestion();
      state.stemLines.push(line.text.replace(QUESTION_START_RE, "").trim());
      state.sawQuestionStart = isQuestionLine(line.text);
      continue;
    }

    if (state.stemLines.length > 0) {
      const unlabeledChoiceCap = expectedChoicesPerQuestion ?? 3;
      if (
        !state.sawLabeledChoice &&
        state.choices.length >= Math.max(2, unlabeledChoiceCap) &&
        looksLikePotentialStem(line.text) &&
        !looksLikeChoiceContinuation(line.text)
      ) {
        flushStateQuestionOrCarryAssets();
        state = makeState();
        attachPendingToNewQuestion();
        state.stemLines.push(line.text.replace(QUESTION_START_RE, "").trim());
        state.sawQuestionStart = isQuestionLine(line.text);
        continue;
      }
      const idx = state.choices.length;
      const { text: cleanChoice, hadMarker } = stripStarMarkers(line.text);
      state.choices.push(cleanChoice);
      state.lastChoiceIndex = idx;
      if (hadMarker || line.hasBold) state.correctIndex = idx;
      continue;
    }

    if (state.lastChoiceIndex !== null && state.choices.length > 0) {
      const idx = state.lastChoiceIndex;
      state.choices[idx] = `${state.choices[idx]} ${line.text}`.trim();
      continue;
    }

    if (state.stemLines.length === 0) {
      attachPendingToNewQuestion();
    }
    state.stemLines.push(line.text);
  }

  for (const a of pendingAssets) {
    pushAssetUnique(state.assets, a);
  }
  pendingAssets = [];
  const finalQ = toQuestion(state);
  if (finalQ) parsed.push(finalQ);
  return parsed;
}

function parseQuestionBankLines(
  lines: ParsedLine[],
  opts?: { expectedChoicesPerQuestion?: number | null },
): ImportedQuestion[] {
  const tokens: ParseToken[] = lines.map((line) => ({ kind: "text" as const, line }));
  return parseQuestionBankTokens(tokens, opts);
}

function normalizeStemKey(s: string): string {
  return normalizeSpace(s).toLowerCase();
}

function stemSimilarity(a: string, b: string): number {
  const A = new Set(normalizeStemKey(a).split(/\W+/).filter((w) => w.length > 2));
  const B = new Set(normalizeStemKey(b).split(/\W+/).filter((w) => w.length > 2));
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter += 1;
  }
  const u = A.size + B.size - inter;
  return u === 0 ? 0 : inter / u;
}

/** When raw text yields more questions than HTML tokens, prefer raw stems and copy assets from HTML parse by stem match. */
function copyAssetsByStemMatch(
  target: ImportedQuestion[],
  source: ImportedQuestion[],
): { exactStem: number; fuzzyStem: number; positional: number } {
  let exactStem = 0;
  let fuzzyStem = 0;
  let positional = 0;
  const unused = new Set(source.map((_, i) => i));
  for (const t of target) {
    const tn = normalizeStemKey(t.stem);
    let bestIdx: number | null = null;
    let matchedBy: "exact" | "fuzzy" | null = null;
    for (const i of unused) {
      if (normalizeStemKey(source[i]!.stem) === tn) {
        bestIdx = i;
        matchedBy = "exact";
        break;
      }
    }
    if (bestIdx === null) {
      let bestScore = 0;
      let cand: number | null = null;
      for (const i of unused) {
        const sc = stemSimilarity(t.stem, source[i]!.stem);
        if (sc > bestScore) {
          bestScore = sc;
          cand = i;
        }
      }
      if (bestScore >= 0.45 && cand !== null) {
        bestIdx = cand;
        matchedBy = "fuzzy";
      }
    }
    if (bestIdx !== null) {
      t.assets = source[bestIdx]!.assets.map((a) => ({ ...a }));
      unused.delete(bestIdx);
      if (matchedBy === "exact") exactStem += 1;
      if (matchedBy === "fuzzy") fuzzyStem += 1;
    }
  }

  // Positional fallback: if stem matching misses assets, map by relative question order.
  const sourceWithAssets = source
    .map((q, i) => ({ q, i }))
    .filter((x) => x.q.assets.length > 0);
  if (sourceWithAssets.length === 0 || target.length === 0) {
    return { exactStem, fuzzyStem, positional };
  }
  for (let ti = 0; ti < target.length; ti += 1) {
    if (target[ti]!.assets.length > 0) continue;
    const ratio = target.length === 1 ? 0 : ti / (target.length - 1);
    const approxSourceIdx = Math.round(ratio * (source.length - 1));
    let best = sourceWithAssets[0]!;
    let bestDist = Math.abs(best.i - approxSourceIdx);
    for (const cand of sourceWithAssets) {
      const d = Math.abs(cand.i - approxSourceIdx);
      if (d < bestDist) {
        best = cand;
        bestDist = d;
      }
    }
    if (bestDist <= 2) {
      target[ti]!.assets = best.q.assets.map((a) => ({ ...a }));
      positional += 1;
    }
  }
  return { exactStem, fuzzyStem, positional };
}

function uniqueWarnings(warnings: string[]): string[] {
  return Array.from(new Set(warnings.map((w) => normalizeSpace(w)).filter((w) => w.length > 0)));
}

function deriveImportWarnings(messages: Array<{ message?: string }>): string[] {
  const collected: string[] = [];
  for (const m of messages) {
    const text = typeof m?.message === "string" ? m.message : "";
    if (!text) continue;
    const lower = text.toLowerCase();
    if (
      lower.includes("unrecognised element was ignored: v:") ||
      lower.includes("unrecognised element was ignored: w:pict")
    ) {
      collected.push(
        "This .docx contains Word/Google Docs drawing objects (VML), which cannot always be auto-extracted as visuals. Convert diagrams/shapes to images, then re-export and import.",
      );
    }
  }
  return uniqueWarnings(collected);
}

function logImportDebug(
  questions: ImportedQuestion[],
  blocks: ImportedDocBlock[],
  label: string,
): void {
  if (!import.meta.env.DEV) return;
  const img = blocks.filter((b) => b.kind === "image").length;
  const tbl = blocks.filter((b) => b.kind === "table").length;
  console.info(`[docx import:${label}] questions=${questions.length} images=${img} tables=${tbl}`);
  const byId = new Map<string, ImportedQuestionAsset>();
  for (const q of questions) {
    for (const a of q.assets) {
      byId.set(a.id, a);
    }
  }
  for (const a of byId.values()) {
    const idxs: number[] = [];
    for (let i = 0; i < questions.length; i += 1) {
      if (questions[i]!.assets.some((x) => x.id === a.id)) idxs.push(i + 1);
    }
    if (idxs.length === 0) continue;
    const lo = Math.min(...idxs);
    const hi = Math.max(...idxs);
    const range = lo === hi ? `${lo}` : `${lo}-${hi}`;
    console.info(`[docx import:${label}] Asset ${a.kind} ${a.id.slice(0, 8)}… -> questions ${range}`);
  }
}

export function importHasVisualOrTableAssets(questions: ImportedQuestion[]): boolean {
  return questions.some((q) =>
    q.assets.some((a) => a.kind === "image" || a.kind === "table"),
  );
}

export function listImportedAssetLinkGroups(questions: ImportedQuestion[]): ImportedAssetLinkGroup[] {
  const idToAsset = new Map<string, ImportedQuestionAsset>();
  const idToIndices = new Map<string, number[]>();
  for (let i = 0; i < questions.length; i += 1) {
    for (const a of questions[i]!.assets) {
      if (!idToAsset.has(a.id)) idToAsset.set(a.id, a);
      const arr = idToIndices.get(a.id) ?? [];
      arr.push(i);
      idToIndices.set(a.id, arr);
    }
  }
  const groups: ImportedAssetLinkGroup[] = [];
  for (const [assetId, indices] of idToIndices.entries()) {
    const sorted = [...new Set(indices)].sort((x, y) => x - y);
    if (sorted.length === 0) continue;
    let runStart = sorted[0]!;
    let prev = sorted[0]!;
    const asset = idToAsset.get(assetId)!;
    const pushRun = () => {
      groups.push({
        assetId,
        asset,
        startQuestion1: runStart + 1,
        endQuestion1: prev + 1,
      });
    };
    for (let k = 1; k < sorted.length; k += 1) {
      const cur = sorted[k]!;
      if (cur === prev + 1) {
        prev = cur;
        continue;
      }
      pushRun();
      runStart = cur;
      prev = cur;
    }
    pushRun();
  }
  groups.sort((a, b) => a.startQuestion1 - b.startQuestion1 || a.assetId.localeCompare(b.assetId));
  return groups;
}

export function setAssetRangeOnQuestions(
  questions: ImportedQuestion[],
  assetId: string,
  startQuestion1: number,
  endQuestion1: number,
  assetTemplate: ImportedQuestionAsset,
): void {
  const lo = Math.min(startQuestion1, endQuestion1) - 1;
  const hi = Math.max(startQuestion1, endQuestion1) - 1;
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i]!;
    q.assets = q.assets.filter((a) => a.id !== assetId);
    if (i >= lo && i <= hi) {
      pushAssetUnique(q.assets, { ...assetTemplate, id: assetId });
    }
  }
}

export function removeImportedAssetEverywhere(questions: ImportedQuestion[], assetId: string): void {
  for (const q of questions) {
    q.assets = q.assets.filter((a) => a.id !== assetId);
  }
}

export function removeImportedAssetContentEverywhere(
  questions: ImportedQuestion[],
  assetTemplate: ImportedQuestionAsset,
): void {
  const key = importedAssetContentKey(assetTemplate);
  for (const q of questions) {
    q.assets = q.assets.filter((a) => importedAssetContentKey(a) !== key);
  }
}

export function setAssetContentRangeOnQuestions(
  questions: ImportedQuestion[],
  assetTemplate: ImportedQuestionAsset,
  startQuestion1: number,
  endQuestion1: number,
): void {
  const key = importedAssetContentKey(assetTemplate);
  const canonicalId = assetTemplate.id;
  const lo = Math.min(startQuestion1, endQuestion1) - 1;
  const hi = Math.max(startQuestion1, endQuestion1) - 1;
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i]!;
    q.assets = q.assets.filter((a) => importedAssetContentKey(a) !== key);
    if (i >= lo && i <= hi) {
      pushAssetUnique(q.assets, { ...assetTemplate, id: canonicalId });
    }
  }
}

export function setAssetContentOnSpecificQuestions(
  questions: ImportedQuestion[],
  assetTemplate: ImportedQuestionAsset,
  questionNumbers1: number[],
): void {
  const key = importedAssetContentKey(assetTemplate);
  const canonicalId = assetTemplate.id;
  const keep = new Set(
    questionNumbers1
      .map((n) => n - 1)
      .filter((n) => Number.isInteger(n) && n >= 0 && n < questions.length),
  );
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i]!;
    q.assets = q.assets.filter((a) => importedAssetContentKey(a) !== key);
    if (keep.has(i)) {
      pushAssetUnique(q.assets, { ...assetTemplate, id: canonicalId });
    }
  }
}

export function attachImportedAssetToQuestion(
  questions: ImportedQuestion[],
  questionNumber1: number,
  assetTemplate: ImportedQuestionAsset,
): void {
  const idx = questionNumber1 - 1;
  if (idx < 0 || idx >= questions.length) return;
  pushAssetUnique(questions[idx]!.assets, { ...assetTemplate });
}

/** Maps importer assets to DB `assets` json and legacy `media_url` (first image). */
export function importedQuestionToStoragePayload(q: ImportedQuestion): {
  media_url: string | null;
  assets: QuestionAsset[] | null;
} {
  const assets: QuestionAsset[] = q.assets.map((a) =>
    a.kind === "image"
      ? { kind: "image", url: a.dataUrl }
      : { kind: "table", html: a.html, plainText: a.plainText },
  );
  const firstImage = q.assets.find((x) => x.kind === "image");
  return {
    media_url: firstImage?.dataUrl ?? null,
    assets: assets.length > 0 ? assets : null,
  };
}

export async function importQuestionsFromDocx(
  file: File,
  options?: ImportOptions,
): Promise<ImportedQuestion[]> {
  const mammoth = await import("mammoth");
  const buf = await file.arrayBuffer();
  const htmlResult = await mammoth.convertToHtml(
    { arrayBuffer: buf },
    {
      convertImage: mammoth.images.imgElement((image: {
        read: (x: string) => Promise<string>;
        contentType: string;
      }) =>
        image.read("base64").then((base64: string) => ({
          src: `data:${image.contentType};base64,${base64}`,
        })),
      ),
    },
  );
  const { value: html } = htmlResult;
  const { value: rawText } = await mammoth.extractRawText({ arrayBuffer: buf });
  const importWarnings = deriveImportWarnings(
    Array.isArray(htmlResult.messages) ? htmlResult.messages : [],
  );
  if (options?.onWarnings) options.onWarnings(importWarnings);
  const htmlStr = html ?? "";
  const blocks = htmlToOrderedBlocks(htmlStr);
  const tokens = blocksToTokens(blocks);
  const htmlLines = linesFromHtml(htmlStr);
  const rawLines = linesFromRawText(rawText ?? "");
  const expectedChoicesPerQuestion =
    typeof options?.expectedChoicesPerQuestion === "number" &&
    options.expectedChoicesPerQuestion >= 2
      ? Math.floor(options.expectedChoicesPerQuestion)
      : inferExpectedChoicesPerQuestion(rawLines.length > 0 ? rawLines : htmlLines);

  let parsed =
    tokens.length > 0
      ? parseQuestionBankTokens(tokens, { expectedChoicesPerQuestion })
      : [];
  const parsedFromTokenCount = parsed.length;

  if (parsed.length === 0 && rawLines.length > 0) {
    parsed = parseQuestionBankLines(rawLines, { expectedChoicesPerQuestion });
  } else if (parsed.length === 0 && htmlLines.length > 0) {
    parsed = parseQuestionBankLines(htmlLines, { expectedChoicesPerQuestion });
  }

  if (parsed.length === 0) {
    throw new Error(
      "No valid questions found in this .docx file. Use numbered questions, lettered choices (A, B, C...), and mark correct answers with bold text, *asterisks*, or an Answer: line.",
    );
  }

  const rawParsed =
    rawLines.length > 0 ? parseQuestionBankLines(rawLines, { expectedChoicesPerQuestion }) : [];
  const hasRichAssets = blocks.some((b) => b.kind === "image" || b.kind === "table");
  let fallbackUsed: "none" | "raw-count" = "none";
  let assetMatch = { exactStem: 0, fuzzyStem: 0, positional: 0 };

  if (rawParsed.length > parsed.length) {
    if (import.meta.env.DEV) {
      console.info(
        `[docx import] Using raw text question count (${rawParsed.length}) over HTML stream (${parsed.length})`,
      );
    }
    if (!hasRichAssets) {
      parsed = rawParsed.map((q) => ({ ...q, assets: [] }));
    } else {
      const htmlParsed = parsed;
      parsed = rawParsed.map((q) => ({
        stem: q.stem,
        choices: q.choices,
        correctIndex: q.correctIndex,
        assets: [],
      }));
      assetMatch = copyAssetsByStemMatch(parsed, htmlParsed);
    }
    fallbackUsed = "raw-count";
  }

  applyHeuristicAssetInheritance(parsed);
  logImportDebug(parsed, blocks, "blocks");
  if (options?.onDebug) {
    options.onDebug({
      htmlParagraphCount: htmlLines.length,
      htmlImageCount: blocks.filter((b) => b.kind === "image").length,
      htmlTableCount: blocks.filter((b) => b.kind === "table").length,
      rawLineCount: rawLines.length,
      htmlLineCount: htmlLines.length,
      tokenCount: tokens.length,
      expectedChoicesPerQuestion,
      parsedFromTokenCount,
      parsedFromRawCount: rawParsed.length,
      finalQuestionCount: parsed.length,
      fallbackUsed,
      assetMatch,
      warnings: importWarnings,
    });
  }
  return parsed;
}
