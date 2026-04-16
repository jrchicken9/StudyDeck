import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReturnNavButton from "../components/ReturnNavButton";
import {
  attachImportedAssetToQuestion,
  importHasVisualOrTableAssets,
  importedAssetContentKey,
  importQuestionsFromDocx,
  importedQuestionToStoragePayload,
  listImportedAssetLinkGroups,
  questionNeedsVisualCue,
  removeImportedAssetContentEverywhere,
  setAssetContentOnSpecificQuestions,
  setAssetContentRangeOnQuestions,
  type ImportDebugReport,
  type ImportedQuestion,
  type ImportedQuestionAsset,
} from "../lib/docxQuestionImport";
import { supabase } from "../lib/supabaseClient";

const MAX_QUESTIONS = 500;
const MAX_CHOICES_PER_QUESTION = 26;
const MIN_CHOICES_PER_QUESTION = 2;

type Draft = {
  stem: string;
  choices: string[];
  correct: number;
};

const emptyDraft = (): Draft => ({
  stem: "",
  choices: ["", "", ""],
  correct: 0,
});

function draftValid(d: Draft): boolean {
  const validChoices = d.choices.map((c) => c.trim()).filter((c) => c.length > 0);
  return (
    d.stem.trim().length > 0 &&
    validChoices.length >= 2 &&
    Number.isInteger(d.correct) &&
    d.correct >= 0 &&
    d.correct < d.choices.length &&
    d.choices[d.correct]?.trim().length > 0
  );
}

function sanitizeImportedQuestions(input: ImportedQuestion[]): ImportedQuestion[] {
  const out: ImportedQuestion[] = [];
  for (const q of input) {
    const choices = q.choices
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .slice(0, MAX_CHOICES_PER_QUESTION);
    if (choices.length < MIN_CHOICES_PER_QUESTION) continue;
    const correctIndex =
      q.correctIndex >= 0 && q.correctIndex < choices.length ? q.correctIndex : 0;
    const assets: ImportedQuestionAsset[] = [];
    for (const a of q.assets ?? []) {
      if (a.kind === "image") {
        const url = typeof a.dataUrl === "string" ? a.dataUrl.trim() : "";
        if (url.length > 0) assets.push({ ...a, dataUrl: url });
      } else if (a.kind === "table" && typeof a.html === "string" && a.html.length > 0) {
        assets.push({
          ...a,
          html: a.html,
          plainText: typeof a.plainText === "string" ? a.plainText : "",
        });
      }
    }
    out.push({
      stem: q.stem.trim(),
      choices,
      correctIndex,
      assets,
    });
  }
  return out;
}

export default function MyBankCreatePage() {
  const navigate = useNavigate();
  const uploadFileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [parsingDocx, setParsingDocx] = useState(false);
  const [importingDocx, setImportingDocx] = useState(false);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importDebug, setImportDebug] = useState<ImportDebugReport | null>(null);
  const [docxQuestions, setDocxQuestions] = useState<ImportedQuestion[] | null>(null);
  const [mediaMapConfirmed, setMediaMapConfirmed] = useState(false);
  const [assetRangeInputs, setAssetRangeInputs] = useState<
    Record<string, { start: string; end: string }>
  >({});
  const [assetQuestionInputs, setAssetQuestionInputs] = useState<Record<string, string>>({});
  const [assetPreview, setAssetPreview] = useState<ImportedQuestionAsset | null>(null);
  const [manualQuestions, setManualQuestions] = useState<ImportedQuestion[]>([]);
  const [newQ, setNewQ] = useState<Draft>(emptyDraft());
  const [expectedChoicesInput, setExpectedChoicesInput] = useState("");
  const [hintModalOpen, setHintModalOpen] = useState(false);
  const [hintTab, setHintTab] = useState<"best" | "styles">("best");
  const [addPath, setAddPath] = useState<"none" | "manual" | "docs">("none");
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(12);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewOnlyNeedsAsset, setPreviewOnlyNeedsAsset] = useState(false);

  async function createBankAndInsert(questions: ImportedQuestion[]) {
    if (!supabase) return;
    const t = title.trim();
    if (!t) {
      setError("Please enter a test name first.");
      return;
    }
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) {
      setError("You must be signed in to create a custom test.");
      return;
    }

    const sanitized = sanitizeImportedQuestions(questions).slice(0, MAX_QUESTIONS);
    if (sanitized.length === 0) {
      setError("Add at least one valid question before creating this test.");
      return;
    }

    setCreating(true);
    setError(null);
    const { data, error: insErr } = await supabase
      .from("user_question_banks")
      .insert({ user_id: uid, title: t })
      .select("id")
      .maybeSingle();
    setCreating(false);
    if (insErr || !data?.id) {
      setError(insErr?.message ?? "Could not create test.");
      return;
    }

    const bankId = String(data.id);
    const payload = sanitized.map((q, i) => {
      const { media_url, assets } = importedQuestionToStoragePayload(q);
      return {
        bank_id: bankId,
        stem: q.stem,
        choices: q.choices,
        correct_index: q.correctIndex,
        media_url,
        assets,
        position: i * 10,
      };
    });
    const { error: qErr } = await supabase.from("user_questions").insert(payload);
    setCreating(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    navigate(`/my-banks/${bankId}`, { replace: true });
  }

  function resetImportUiState() {
    setDocxQuestions(null);
    setImportFileName(null);
    setImportWarnings([]);
    setImportDebug(null);
    setAssetRangeInputs({});
    setAssetQuestionInputs({});
    setAssetPreview(null);
    setPreviewSearch("");
    setPreviewOnlyNeedsAsset(false);
    setPreviewPage(1);
    setPreviewPageSize(12);
    setMediaMapConfirmed(false);
  }

  async function onPickDocx(file: File, expectedChoicesRaw: string) {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setError("Please upload a .docx Word file.");
      return;
    }
    const expectedN = Number.parseInt(expectedChoicesRaw, 10);
    if (
      !Number.isFinite(expectedN) ||
      expectedN < MIN_CHOICES_PER_QUESTION ||
      expectedN > MAX_CHOICES_PER_QUESTION
    ) {
      setError(
        `Choose how many answer choices each question has (${MIN_CHOICES_PER_QUESTION}–${MAX_CHOICES_PER_QUESTION}) before uploading.`,
      );
      return;
    }
    setError(null);
    setParsingDocx(true);
    setImportWarnings([]);
    setImportDebug(null);
    try {
      const expectedChoices = Number.parseInt(expectedChoicesRaw, 10);
      const parsed = await importQuestionsFromDocx(file, {
        expectedChoicesPerQuestion: Number.isFinite(expectedChoices)
          ? expectedChoices
          : undefined,
        onWarnings: (warnings) => setImportWarnings(warnings),
        onDebug: (debug) => setImportDebug(debug),
      });
      const sanitized = sanitizeImportedQuestions(parsed).slice(0, MAX_QUESTIONS);
      if (sanitized.length === 0) {
        resetImportUiState();
        setError("No importable questions were found after validating choices.");
        return;
      }
      setDocxQuestions(sanitized);
      initializeImportEditingState(sanitized);
      setPreviewPage(1);
      setPreviewPageSize(12);
      setImportFileName(file.name);
      setMediaMapConfirmed(!importHasVisualOrTableAssets(sanitized));
      if (!title.trim()) {
        setTitle(file.name.replace(/\.docx$/i, ""));
      }
    } catch (e) {
      resetImportUiState();
      setError(e instanceof Error ? e.message : "Could not parse this file.");
    } finally {
      setParsingDocx(false);
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = "";
    }
  }

  async function createBankFromDocx() {
    if (!docxQuestions || docxQuestions.length === 0) return;
    if (!title.trim()) {
      setError("Please enter a test name first.");
      return;
    }
    setImportingDocx(true);
    await createBankAndInsert(docxQuestions);
    setImportingDocx(false);
  }

  function setDraftChoice(idx: number, value: string) {
    setNewQ((prev) => {
      const next = [...prev.choices];
      next[idx] = value;
      return { ...prev, choices: next };
    });
  }

  function addDraftChoice() {
    setNewQ((prev) => {
      if (prev.choices.length >= MAX_CHOICES_PER_QUESTION) return prev;
      return { ...prev, choices: [...prev.choices, ""] };
    });
  }

  function removeDraftChoice(idx: number) {
    setNewQ((prev) => {
      if (prev.choices.length <= 2) return prev;
      const nextChoices = prev.choices.filter((_, i) => i !== idx);
      let nextCorrect = prev.correct;
      if (prev.correct === idx) nextCorrect = 0;
      else if (prev.correct > idx) nextCorrect = prev.correct - 1;
      return { ...prev, choices: nextChoices, correct: nextCorrect };
    });
  }

  function addManualQuestionToDraft() {
    if (!draftValid(newQ)) {
      setError("Enter a question, at least 2 answer choices, and select a valid correct answer.");
      return;
    }
    if (manualQuestions.length >= MAX_QUESTIONS) {
      setError(`You can add at most ${MAX_QUESTIONS} questions per test.`);
      return;
    }
    setError(null);
    const nextQuestion: ImportedQuestion = {
      stem: newQ.stem.trim(),
      choices: newQ.choices.map((c) => c.trim()),
      correctIndex: newQ.correct,
      assets: [],
    };
    setManualQuestions((prev) => [...prev, nextQuestion]);
    setNewQ(emptyDraft());
  }

  function removeManualQuestion(idx: number) {
    setManualQuestions((prev) => prev.filter((_, i) => i !== idx));
  }

  const docxAssetGroups = useMemo(() => {
    if (!docxQuestions) return [];
    const rawGroups = listImportedAssetLinkGroups(docxQuestions);
    const byContent = new Map<
      string,
      { assetId: string; asset: ImportedQuestionAsset; startQuestion1: number; endQuestion1: number }
    >();
    for (const g of rawGroups) {
      const key = importedAssetContentKey(g.asset);
      const existing = byContent.get(key);
      if (!existing) {
        byContent.set(key, { ...g });
        continue;
      }
      existing.startQuestion1 = Math.min(existing.startQuestion1, g.startQuestion1);
      existing.endQuestion1 = Math.max(existing.endQuestion1, g.endQuestion1);
    }
    return Array.from(byContent.values()).sort(
      (a, b) => a.startQuestion1 - b.startQuestion1 || a.assetId.localeCompare(b.assetId),
    );
  }, [docxQuestions]);
  const cueQuestionsWithoutAssets = useMemo(
    () =>
      docxQuestions
        ? docxQuestions.filter((q) => q.assets.length === 0 && questionNeedsVisualCue(q.stem)).length
        : 0,
    [docxQuestions],
  );
  const linkedQuestionCount = useMemo(
    () => (docxQuestions ? docxQuestions.filter((q) => q.assets.length > 0).length : 0),
    [docxQuestions],
  );
  const filteredPreviewQuestions = useMemo(() => {
    if (!docxQuestions) return [];
    const term = previewSearch.trim().toLowerCase();
    const out: Array<{ q: ImportedQuestion; index: number }> = [];
    for (let i = 0; i < docxQuestions.length; i += 1) {
      const q = docxQuestions[i]!;
      if (previewOnlyNeedsAsset && q.assets.length > 0) continue;
      if (term) {
        const haystack = `${q.stem} ${q.choices.join(" ")} #${i + 1} question ${i + 1}`.toLowerCase();
        if (!haystack.includes(term)) continue;
      }
      out.push({ q, index: i });
    }
    return out;
  }, [docxQuestions, previewOnlyNeedsAsset, previewSearch]);
  const previewTotalPages = Math.max(
    1,
    Math.ceil(filteredPreviewQuestions.length / Math.max(1, previewPageSize)),
  );
  const previewPageSafe = Math.min(previewPage, previewTotalPages);
  const previewPageStart = (previewPageSafe - 1) * previewPageSize;
  const visiblePreviewQuestions = filteredPreviewQuestions.slice(
    previewPageStart,
    previewPageStart + previewPageSize,
  );

  function initializeImportEditingState(questions: ImportedQuestion[]) {
    const next: Record<string, { start: string; end: string }> = {};
    const specific: Record<string, string> = {};
    for (const g of listImportedAssetLinkGroups(questions)) {
      next[g.assetId] = {
        start: String(g.startQuestion1),
        end: String(g.endQuestion1),
      };
      specific[g.assetId] = `${g.startQuestion1}`;
    }
    setAssetRangeInputs(next);
    setAssetQuestionInputs(specific);
  }

  function isAssetRangeValid(assetId: string, totalQuestions: number): boolean {
    const draft = assetRangeInputs[assetId];
    if (!draft) return false;
    const s = Number.parseInt(draft.start, 10);
    const e = Number.parseInt(draft.end, 10);
    return (
      Number.isFinite(s) &&
      Number.isFinite(e) &&
      s >= 1 &&
      e >= 1 &&
      s <= totalQuestions &&
      e <= totalQuestions
    );
  }

  function applyImportedAssetRange(assetId: string, template: ImportedQuestionAsset) {
    if (!docxQuestions) return;
    const draft = assetRangeInputs[assetId];
    const s = Number.parseInt(draft?.start ?? "1", 10);
    const e = Number.parseInt(draft?.end ?? "1", 10);
    if (
      !Number.isFinite(s) ||
      !Number.isFinite(e) ||
      s < 1 ||
      e < 1 ||
      s > docxQuestions.length ||
      e > docxQuestions.length
    ) {
      setError("Enter valid start and end question numbers (within the import list).");
      return;
    }
    setDocxQuestions((prev) => {
      if (!prev) return prev;
      const copy = prev.map((q) => ({ ...q, assets: [...q.assets] }));
      setAssetContentRangeOnQuestions(copy, template, s, e);
      return copy;
    });
    setMediaMapConfirmed(false);
    setError(null);
  }

  function parseQuestionList(raw: string, total: number): number[] {
    const out = new Set<number>();
    for (const token of raw.split(",").map((x) => x.trim()).filter(Boolean)) {
      const m = token.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        const a = Number.parseInt(m[1] ?? "", 10);
        const b = Number.parseInt(m[2] ?? "", 10);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const lo = Math.max(1, Math.min(a, b));
        const hi = Math.min(total, Math.max(a, b));
        for (let i = lo; i <= hi; i += 1) out.add(i);
        continue;
      }
      const n = Number.parseInt(token, 10);
      if (Number.isFinite(n) && n >= 1 && n <= total) out.add(n);
    }
    return [...out].sort((a, b) => a - b);
  }

  function applyImportedAssetSpecific(assetId: string, template: ImportedQuestionAsset) {
    if (!docxQuestions) return;
    const raw = assetQuestionInputs[assetId] ?? "";
    const picked = parseQuestionList(raw, docxQuestions.length);
    if (picked.length === 0) {
      setError("Enter valid questions, e.g. 2,4,7-9.");
      return;
    }
    setDocxQuestions((prev) => {
      if (!prev) return prev;
      const copy = prev.map((q) => ({ ...q, assets: [...q.assets] }));
      setAssetContentOnSpecificQuestions(copy, template, picked);
      return copy;
    });
    setMediaMapConfirmed(false);
    setError(null);
  }

  function attachAssetToQuestion(questionIdx0: number, assetId: string) {
    if (!docxQuestions) return;
    const selected = docxAssetGroups.find((g) => g.assetId === assetId)?.asset;
    if (!selected) {
      setError("Selected visual/table is no longer available.");
      return;
    }
    setDocxQuestions((prev) => {
      if (!prev) return prev;
      const copy = prev.map((q) => ({ ...q, assets: [...q.assets] }));
      attachImportedAssetToQuestion(copy, questionIdx0 + 1, selected);
      return copy;
    });
    setMediaMapConfirmed(false);
    setError(null);
  }

  function removeAssetFromQuestion(questionIdx0: number, asset: ImportedQuestionAsset) {
    setDocxQuestions((prev) => {
      if (!prev) return prev;
      const copy = prev.map((q) => ({ ...q, assets: [...q.assets] }));
      copy[questionIdx0]!.assets = copy[questionIdx0]!.assets.filter((a) => a.id !== asset.id);
      return copy;
    });
    setMediaMapConfirmed(false);
  }

  function dropImportedAsset(template: ImportedQuestionAsset) {
    if (!docxQuestions) return;
    setDocxQuestions((prev) => {
      if (!prev) return prev;
      const copy = prev.map((q) => ({ ...q, assets: [...q.assets] }));
      removeImportedAssetContentEverywhere(copy, template);
      return copy;
    });
    setMediaMapConfirmed(false);
    setError(null);
  }

  const importChoicesReady = useMemo(() => {
    const n = Number.parseInt(expectedChoicesInput, 10);
    return (
      Number.isFinite(n) &&
      n >= MIN_CHOICES_PER_QUESTION &&
      n <= MAX_CHOICES_PER_QUESTION
    );
  }, [expectedChoicesInput]);

  return (
    <main className="page page-my-bank-create page-custom-tests">
      <ReturnNavButton fallbackTo="/my-banks" className="custom-tests-page-nav" />
      <section className="card my-bank-create-card">
        <p className="eyebrow custom-tests-eyebrow">Work Shop</p>
        <h1 className="page-title custom-tests-page-title">Create custom test</h1>
        <p className="lead lead--compact custom-tests-lead">
          Enter a test name, then choose how you want to add questions.
        </p>

        <div className="field">
          <label htmlFor="create-bank-title">Test name</label>
          <input
            id="create-bank-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. March revision set"
          />
        </div>

        <div className="my-bank-pool-toolbar card">
          <div className="my-bank-pool-toolbar-row">
            <div className="my-bank-pool-toolbar-heading">
              <h2 className="my-bank-pool-toolbar-title">Add questions</h2>
            </div>
            <div className="my-bank-pool-toolbar-add" role="group" aria-label="How to add questions">
              <span className="my-bank-pool-toolbar-add-label muted">Via</span>
              <button
                type="button"
                className={`btn btn-compact${addPath === "manual" ? "" : " secondary"}`}
                disabled={!supabase || creating || parsingDocx || importingDocx}
                onClick={() => {
                  setAddPath("manual");
                  setDocxQuestions(null);
                  setImportFileName(null);
                }}
              >
                Manual
              </button>
              <button
                type="button"
                className={`btn btn-compact${addPath === "docs" ? "" : " secondary"}`}
                disabled={!supabase || creating || parsingDocx || importingDocx}
                onClick={() => {
                  setAddPath("docs");
                  setManualQuestions([]);
                }}
              >
                <span className="docx-cta-icon" aria-hidden>W</span>
                Upload
              </button>
            </div>
          </div>
          {addPath === "none" ? (
            <p className="my-bank-pool-toolbar-hint muted">
              Choose <strong>Manual</strong> or <strong>Upload</strong> to start.
            </p>
          ) : null}
        </div>

        {addPath === "manual" ? (
          <section className="card my-banks-import-review">
            <div className="my-banks-import-review-head">
              <h2 className="my-bank-section-title">Manual questions</h2>
              <p className="muted my-bank-section-sub">{manualQuestions.length} drafted</p>
            </div>
            <p className="muted my-bank-manual-hint">
              Tap a letter to mark the correct answer. You need at least two non-empty options.
            </p>
            <div className="field">
              <label htmlFor="manual-stem-create">Question</label>
              <textarea
                id="manual-stem-create"
                className="input my-bank-textarea"
                rows={3}
                value={newQ.stem}
                onChange={(e) => setNewQ((prev) => ({ ...prev, stem: e.target.value }))}
                placeholder="Type your question"
              />
            </div>
            <div className="my-bank-manual-choices" role="list">
              {newQ.choices.map((choice, idx) => {
                const letter = String.fromCharCode(65 + idx);
                const isCorrect = newQ.correct === idx;
                return (
                  <div
                    key={`draft-choice-${idx}`}
                    className={`my-bank-manual-choice-row${isCorrect ? " my-bank-manual-choice-row--correct" : ""}`}
                    role="listitem"
                  >
                    <button
                      type="button"
                      className={`my-bank-manual-letter${isCorrect ? " my-bank-manual-letter--selected" : ""}`}
                      aria-pressed={isCorrect}
                      aria-label={
                        isCorrect ? `${letter} is the correct answer` : `Mark ${letter} as the correct answer`
                      }
                      onClick={() => setNewQ((prev) => ({ ...prev, correct: idx }))}
                    >
                      {letter}
                    </button>
                    <input
                      id={`manual-choice-create-${idx}`}
                      className="input my-bank-manual-choice-input"
                      value={choice}
                      onChange={(e) => setDraftChoice(idx, e.target.value)}
                      placeholder={`Option ${letter}`}
                      aria-label={`Choice ${letter} text`}
                    />
                    {newQ.choices.length > 2 ? (
                      <button
                        type="button"
                        className="my-bank-manual-remove"
                        aria-label={`Remove choice ${letter}`}
                        onClick={() => removeDraftChoice(idx)}
                      >
                        <span aria-hidden>×</span>
                      </button>
                    ) : (
                      <span className="my-bank-manual-remove-spacer" aria-hidden />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="my-bank-manual-footer">
              <div className="my-bank-manual-footer-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={newQ.choices.length >= MAX_CHOICES_PER_QUESTION}
                  onClick={addDraftChoice}
                >
                  + Add option
                </button>
                <span className="muted my-bank-manual-count">
                  {newQ.choices.length} / {MAX_CHOICES_PER_QUESTION} options
                </span>
              </div>
              <button type="button" className="btn" onClick={addManualQuestionToDraft}>
                Add question to draft
              </button>
            </div>
            {manualQuestions.length > 0 ? (
              <>
                <ul className="my-banks-import-preview-list">
                  {manualQuestions.slice(0, 8).map((q, i) => (
                    <li key={`${q.stem.slice(0, 24)}-${i}`} className="my-banks-import-preview-item">
                      <p className="my-banks-import-preview-stem">
                        {i + 1}. {q.stem}
                      </p>
                      <p className="muted my-banks-import-preview-meta">
                        {q.choices.length} choices, correct {String.fromCharCode(65 + q.correctIndex)}
                      </p>
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        onClick={() => removeManualQuestion(i)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="btn-row my-banks-import-review-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={creating || parsingDocx || importingDocx}
                    onClick={() => void createBankAndInsert(manualQuestions)}
                  >
                    {creating ? "Creating…" : "Create test with drafted questions"}
                  </button>
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {addPath === "docs" ? (
          <div className="my-bank-import-inline card my-bank-import-inline--compact my-bank-import-unified">
            <div className="my-bank-import-unified-header">
              <div className="my-bank-import-unified-track" aria-label="Import progress">
                <span
                  className={`my-bank-import-unified-track-step${importChoicesReady ? " my-bank-import-unified-track-step--done" : " my-bank-import-unified-track-step--active"}`}
                >
                  Choices
                </span>
                <span className="my-bank-import-unified-track-line" aria-hidden />
                <span
                  className={`my-bank-import-unified-track-step${importChoicesReady ? " my-bank-import-unified-track-step--active" : ""}`}
                >
                  Upload
                </span>
              </div>
              <button
                type="button"
                className="btn btn-guide btn-compact"
                title="Import format guide"
                onClick={() => setHintModalOpen(true)}
              >
                <span className="guide-cta-icon" aria-hidden>?</span>
                Guide
              </button>
            </div>

            <p className="my-bank-import-unified-lead">
              How many answer choices per question?{" "}
              <span className="muted">
                ({MIN_CHOICES_PER_QUESTION}–{MAX_CHOICES_PER_QUESTION}, match your Word file.)
              </span>
            </p>

            <div className="my-bank-import-choices-row my-bank-import-choices-row--unified">
              <div className="my-bank-import-preset-group" role="group" aria-label="Common choice counts">
                {[3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`my-bank-import-preset${expectedChoicesInput === String(n) ? " my-bank-import-preset--active" : ""}`}
                    onClick={() => setExpectedChoicesInput(String(n))}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="my-bank-import-custom-field">
                <label htmlFor="expected-choices-inline-create" className="my-bank-import-custom-label">
                  Custom
                </label>
                <input
                  id="expected-choices-inline-create"
                  className="input my-bank-import-custom-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={MIN_CHOICES_PER_QUESTION}
                  max={MAX_CHOICES_PER_QUESTION}
                  value={expectedChoicesInput}
                  onChange={(e) => setExpectedChoicesInput(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="—"
                  aria-label={`Number of answer choices per question, ${MIN_CHOICES_PER_QUESTION} to ${MAX_CHOICES_PER_QUESTION}`}
                  aria-invalid={expectedChoicesInput.length > 0 && !importChoicesReady}
                />
              </div>
            </div>

            <div
              className={`my-bank-import-unified-surface${importChoicesReady ? " my-bank-import-unified-surface--unlocked" : ""}`}
            >
              {!importChoicesReady ? (
                <div className="my-bank-import-unified-teaser" aria-live="polite">
                  <span className="my-bank-import-unified-teaser-icon" aria-hidden>
                    ↓
                  </span>
                  <p className="muted my-bank-import-unified-teaser-text">
                    Choose a count above — this area will open for your{" "}
                    <code className="docx-dropzone-code">.docx</code> file.
                  </p>
                </div>
              ) : (
                <div
                  key="upload-open"
                  className="docx-dropzone docx-dropzone--inline docx-dropzone--unified"
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) void onPickDocx(file, expectedChoicesInput);
                  }}
                >
                  <p className="muted docx-dropzone-hint">
                    Drop a <code className="docx-dropzone-code">.docx</code> here or browse.
                  </p>
                  <div className="my-bank-import-toolbar my-bank-import-toolbar--inline">
                    <button
                      type="button"
                      className="btn secondary btn-compact"
                      disabled={!supabase || creating || parsingDocx || importingDocx}
                      onClick={() => uploadFileInputRef.current?.click()}
                    >
                      <span className="docx-cta-icon" aria-hidden>W</span>
                      {parsingDocx ? "Reading…" : "Browse"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <input
              ref={uploadFileInputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="my-banks-file-input"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) void onPickDocx(file, expectedChoicesInput);
                e.currentTarget.value = "";
              }}
            />
          </div>
        ) : null}

        {docxQuestions ? (
          <section className="card my-banks-import-review">
            <div className="my-banks-import-review-head">
              <h2 className="my-bank-section-title">Review imported questions</h2>
              <p className="muted my-bank-section-sub">
                {docxQuestions.length} detected from {importFileName ?? "uploaded file"}
              </p>
            </div>
            <p className="muted my-banks-import-review-note">
              Review page {previewPageSafe} of {previewTotalPages}. Adjust visuals and tables below before creating
              the test.
            </p>
            <div className="my-bank-import-stats">
              <span className="my-bank-import-stat">{docxAssetGroups.length} asset groups</span>
              <span className="my-bank-import-stat">{linkedQuestionCount} questions linked</span>
              <span className="my-bank-import-stat">
                {docxQuestions.length > 0
                  ? `${Math.round((linkedQuestionCount / docxQuestions.length) * 100)}% assignment coverage`
                  : "0% assignment coverage"}
              </span>
              {cueQuestionsWithoutAssets > 0 ? (
                <span className="my-bank-import-stat my-bank-import-stat--warn">
                  {cueQuestionsWithoutAssets} cue-heavy questions without assets
                </span>
              ) : null}
            </div>
            {importWarnings.length > 0 ? (
              <div className="my-bank-import-warning card">
                {importWarnings.map((warning) => (
                  <p key={warning} className="muted my-bank-import-warning-text">
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}
            {importDebug ? (
              <details className="my-bank-import-debug card">
                <summary>Import debugger</summary>
                <p className="muted my-bank-import-debug-line">
                  Final: {importDebug.finalQuestionCount} · token parse {importDebug.parsedFromTokenCount} · raw parse{" "}
                  {importDebug.parsedFromRawCount}
                </p>
                <p className="muted my-bank-import-debug-line">
                  Lines raw/html: {importDebug.rawLineCount}/{importDebug.htmlLineCount} · tokens {importDebug.tokenCount}
                </p>
                <p className="muted my-bank-import-debug-line">
                  Assets html images/tables: {importDebug.htmlImageCount}/{importDebug.htmlTableCount} · fallback{" "}
                  {importDebug.fallbackUsed}
                </p>
                <p className="muted my-bank-import-debug-line">
                  Asset match exact/fuzzy/positional: {importDebug.assetMatch.exactStem}/
                  {importDebug.assetMatch.fuzzyStem}/{importDebug.assetMatch.positional}
                </p>
              </details>
            ) : null}
            {docxAssetGroups.length > 0 ? (
              <div className="my-banks-import-asset-groups card">
                <h3 className="my-bank-add-title">Visuals &amp; tables</h3>
                <p className="muted my-bank-section-sub">
                  Each item can apply to one question or a range of consecutive questions.
                </p>
                <ul className="my-banks-import-asset-group-list">
                  {docxAssetGroups.map((g) => (
                    <li key={g.assetId} className="my-banks-import-asset-group">
                      <p className="my-banks-import-asset-label">
                        <strong>{g.asset.kind === "image" ? "Visual" : "Table"}</strong>
                        <span className="muted">
                          {" "}
                          · Questions {g.startQuestion1}
                          {g.endQuestion1 !== g.startQuestion1 ? `–${g.endQuestion1}` : ""}
                        </span>
                      </p>
                      {g.asset.kind === "image" ? (
                        <button
                          type="button"
                          className="my-banks-import-asset-open"
                          onClick={() => setAssetPreview(g.asset)}
                        >
                          <img
                            src={g.asset.dataUrl}
                            className="my-bank-q-media my-banks-import-asset-thumb"
                            alt=""
                            loading="lazy"
                          />
                          <span className="muted my-banks-import-asset-open-label">Click to enlarge</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="my-banks-import-asset-open"
                          onClick={() => setAssetPreview(g.asset)}
                        >
                          <div
                            className="my-banks-import-table-preview my-banks-import-table-preview--compact"
                            dangerouslySetInnerHTML={{ __html: g.asset.html }}
                          />
                          <span className="muted my-banks-import-asset-open-label">Click to enlarge</span>
                        </button>
                      )}
                      <div className="my-banks-import-asset-range-row">
                        <label className="muted" htmlFor={`create-asset-start-${g.assetId}`}>
                          From #
                        </label>
                        <input
                          id={`create-asset-start-${g.assetId}`}
                          className="input my-bank-import-count-input"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={assetRangeInputs[g.assetId]?.start ?? ""}
                          onChange={(e) =>
                            setAssetRangeInputs((prev) => ({
                              ...prev,
                              [g.assetId]: {
                                start: e.target.value.replace(/[^\d]/g, ""),
                                end: prev[g.assetId]?.end ?? String(g.endQuestion1),
                              },
                            }))
                          }
                        />
                        <label className="muted" htmlFor={`create-asset-end-${g.assetId}`}>
                          To #
                        </label>
                        <input
                          id={`create-asset-end-${g.assetId}`}
                          className="input my-bank-import-count-input"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={assetRangeInputs[g.assetId]?.end ?? ""}
                          onChange={(e) =>
                            setAssetRangeInputs((prev) => ({
                              ...prev,
                              [g.assetId]: {
                                start: prev[g.assetId]?.start ?? String(g.startQuestion1),
                                end: e.target.value.replace(/[^\d]/g, ""),
                              },
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact"
                          disabled={!isAssetRangeValid(g.assetId, docxQuestions.length)}
                          onClick={() => applyImportedAssetRange(g.assetId, g.asset)}
                        >
                          Apply range
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact"
                          onClick={() => dropImportedAsset(g.asset)}
                        >
                          Unlink
                        </button>
                      </div>
                      <div className="my-banks-import-asset-range-row">
                        <label className="muted" htmlFor={`create-specific-${g.assetId}`}>
                          Question list
                        </label>
                        <input
                          id={`create-specific-${g.assetId}`}
                          className="input my-banks-import-asset-specific-input"
                          value={assetQuestionInputs[g.assetId] ?? ""}
                          onChange={(e) =>
                            setAssetQuestionInputs((prev) => ({ ...prev, [g.assetId]: e.target.value }))
                          }
                          placeholder="e.g. 2,4,7-9"
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact"
                          onClick={() => applyImportedAssetSpecific(g.assetId, g.asset)}
                        >
                          Apply list
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="my-bank-import-preview-toolbar">
              <input
                className="input my-bank-import-preview-search"
                value={previewSearch}
                onChange={(e) => setPreviewSearch(e.target.value)}
                placeholder="Search preview questions (#, text, choices)"
              />
              <label className="my-bank-select-all muted">
                <input
                  type="checkbox"
                  checked={previewOnlyNeedsAsset}
                  onChange={(e) => setPreviewOnlyNeedsAsset(e.target.checked)}
                />
                Only show questions without assets
              </label>
              <p className="muted my-bank-section-sub">
                Showing {visiblePreviewQuestions.length} of {filteredPreviewQuestions.length}
              </p>
            </div>
            <ul className="my-banks-import-preview-list">
              {visiblePreviewQuestions.map(({ q, index: i }) => (
                <li key={`${q.stem.slice(0, 30)}-${i}`} className="my-banks-import-preview-item">
                  <p className="my-banks-import-preview-stem">
                    {i + 1}. {q.stem}
                  </p>
                  <p className="muted my-banks-import-preview-meta">
                    Correct: {String.fromCharCode(65 + q.correctIndex)}
                    {q.assets.length > 0
                      ? ` · ${q.assets.length} attached asset${q.assets.length === 1 ? "" : "s"}`
                      : ""}
                  </p>
                  {q.assets.length > 0 ? (
                    <div className="my-banks-import-media-review my-banks-import-multi-assets">
                      {q.assets.map((a) =>
                        a.kind === "image" ? (
                          <div key={a.id} className="my-banks-import-preview-asset-item">
                            <img src={a.dataUrl} className="my-bank-q-media" alt="" loading="lazy" />
                            <button
                              type="button"
                              className="btn btn-ghost btn-compact"
                              onClick={() => removeAssetFromQuestion(i, a)}
                            >
                              Remove visual
                            </button>
                          </div>
                        ) : (
                          <div key={a.id} className="my-banks-import-preview-asset-item">
                            <div
                              className="my-banks-import-table-preview"
                              dangerouslySetInnerHTML={{ __html: a.html }}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-compact"
                              onClick={() => removeAssetFromQuestion(i, a)}
                            >
                              Remove table
                            </button>
                          </div>
                        ),
                      )}
                    </div>
                  ) : null}
                  {docxAssetGroups.length > 0 ? (
                    <div className="my-banks-import-media-review-row">
                      <label className="muted">
                        Attach detected visual/table
                      </label>
                      <div className="my-banks-import-attach-chip-row">
                        {docxAssetGroups.map((g, gi) => (
                          <button
                            key={`create-attach-chip-${g.assetId}-${i}`}
                            type="button"
                            className="btn btn-ghost btn-compact my-banks-import-attach-chip"
                            onClick={() => attachAssetToQuestion(i, g.assetId)}
                            title={`Attach ${g.asset.kind} ${gi + 1}`}
                          >
                            {g.asset.kind === "image" ? "Visual" : "Table"} {gi + 1} (Q{g.startQuestion1}
                            {g.endQuestion1 !== g.startQuestion1 ? `-${g.endQuestion1}` : ""})
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                    </li>
                  ))}
                </ul>
                {filteredPreviewQuestions.length > previewPageSize ? (
                  <div className="btn-row my-bank-import-preview-controls">
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={previewPageSafe <= 1}
                  onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={previewPageSafe >= previewTotalPages}
                  onClick={() => setPreviewPage((p) => Math.min(previewTotalPages, p + 1))}
                >
                  Next
                </button>
                <select
                  className="input my-banks-import-page-size-select"
                  value={String(previewPageSize)}
                  onChange={(e) => {
                    const next = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(next) && next > 0) {
                      setPreviewPageSize(next);
                      setPreviewPage(1);
                    }
                  }}
                >
                  <option value="8">8 / page</option>
                  <option value="12">12 / page</option>
                  <option value="25">25 / page</option>
                </select>
              </div>
            ) : null}
            {importHasVisualOrTableAssets(docxQuestions) ? (
              <label className="my-bank-select-all muted">
                <input
                  type="checkbox"
                  checked={mediaMapConfirmed}
                  onChange={(e) => setMediaMapConfirmed(e.target.checked)}
                />
                I confirmed visuals and tables are attached to the correct questions/ranges.
              </label>
            ) : null}
            <div className="btn-row my-banks-import-review-actions">
              <button
                type="button"
                className="btn"
                disabled={creating || parsingDocx || importingDocx || !mediaMapConfirmed}
                onClick={() => void createBankFromDocx()}
              >
                {importingDocx ? "Importing…" : "Create test from this file"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={importingDocx}
                onClick={() => {
                  resetImportUiState();
                }}
              >
                Cancel import
              </button>
            </div>
          </section>
        ) : null}
      </section>
      {hintModalOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="docx-hint-title-create"
          onClick={() => setHintModalOpen(false)}
        >
          <div className="modal-panel modal-panel--guide card" onClick={(e) => e.stopPropagation()}>
            <h2 id="docx-hint-title-create" className="modal-title">
              Import format guide
            </h2>
            <section className="docx-import-hint">
              <p className="muted docx-import-hint-sub">
                Use this as a quick checklist before uploading your `.docx`.
              </p>
              <div className="docx-guide-grid">
                <div className="docx-guide-card">
                  <h3 className="docx-guide-card-title">Quick rules</h3>
                  <ul className="docx-guide-list">
                    <li>Keep one question per block.</li>
                    <li>Use consistent choice count (e.g. always 3).</li>
                    <li>Set <strong>Answers per question</strong> in the import area.</li>
                    <li>Prefer lowercase/uppercase `a) b) c)` labels for each choice.</li>
                  </ul>
                </div>
                <div className="docx-guide-card">
                  <h3 className="docx-guide-card-title">Correct answer styles</h3>
                  <div className="docx-guide-tags">
                    <span className="docx-guide-tag">Answer: b</span>
                    <span className="docx-guide-tag">Bold correct choice</span>
                    <span className="docx-guide-tag">*asterisk-wrapped*</span>
                  </div>
                </div>
              </div>
              <div className="docx-guide-tabs" role="tablist" aria-label="Importer examples">
                <button
                  type="button"
                  role="tab"
                  aria-selected={hintTab === "best"}
                  className={`docx-guide-tab${hintTab === "best" ? " docx-guide-tab--active" : ""}`}
                  onClick={() => setHintTab("best")}
                >
                  Best Practice
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={hintTab === "styles"}
                  className={`docx-guide-tab${hintTab === "styles" ? " docx-guide-tab--active" : ""}`}
                  onClick={() => setHintTab("styles")}
                >
                  Accepted Variants
                </button>
              </div>
              <div className="docx-guide-examples">
                {hintTab === "best" ? (
                  <img
                    className="docx-import-hint-image"
                    src="/import-docx-best-practice.svg"
                    alt="Example Word format: question line, a b c choices, and Answer line"
                  />
                ) : (
                  <img
                    className="docx-import-hint-image"
                    src="/import-docx-variants.svg"
                    alt="Additional examples: Answer line, bold answer, and asterisk answer"
                  />
                )}
              </div>
            </section>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setHintModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {assetPreview ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setAssetPreview(null)}>
          <div className="modal-panel card my-banks-import-asset-modal" onClick={(e) => e.stopPropagation()}>
            {assetPreview.kind === "image" ? (
              <img src={assetPreview.dataUrl} className="my-banks-import-asset-modal-img" alt="" />
            ) : (
              <div
                className="my-banks-import-table-preview"
                dangerouslySetInnerHTML={{ __html: assetPreview.html }}
              />
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAssetPreview(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {error ? <p className="auth-error custom-tests-error">{error}</p> : null}
    </main>
  );
}
