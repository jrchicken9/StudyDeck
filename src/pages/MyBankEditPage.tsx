import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { Link, useBeforeUnload, useBlocker, useLocation, useNavigate, useParams } from "react-router-dom";
import ConfirmModal from "../components/ConfirmModal";
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
import { useAuth } from "../context/AuthContext";
import { isUuid } from "../lib/isUuid";
import {
  clampQuestionTimerSeconds,
  describeQuestionTimerRecipe,
  maxSecondsForTimerScope,
  questionTimerFromBankRow,
  questionTimersEqual,
  questionTimerToJson,
  QUESTION_TIMER_MAX_MIN_WHOLE_TEST,
  QUESTION_TIMER_MAX_SEC,
} from "../lib/questionTimer";
import { supabase } from "../lib/supabaseClient";
import type { QuestionAsset, QuestionTimerSettings } from "../types";

type ResolveTimerDraftResult =
  | { ok: true; timer: QuestionTimerSettings; draftDisplay: string }
  | { ok: false; message: string };

/** Reject durations that cannot work as a countdown/count-up target (e.g. 0→0). */
function rejectNonsenseTimer(timer: QuestionTimerSettings): { ok: false; message: string } | null {
  if (timer.seconds <= 0) {
    return {
      ok: false,
      message:
        timer.scope === "whole_test"
          ? "Full test duration must be greater than zero. A zero-length countdown would end the session immediately."
          : "Per-question timer must be longer than zero seconds — a 0→0 countdown has no time to run.",
    };
  }
  if (timer.scope === "whole_test") {
    if (timer.seconds < 60) {
      return {
        ok: false,
        message: "Full test duration must be at least 1 whole minute.",
      };
    }
    if (timer.seconds % 60 !== 0) {
      return {
        ok: false,
        message:
          "Full test duration must be a whole number of minutes. Adjust the value or choose a preset (stored time is in one-minute steps).",
      };
    }
  }
  return null;
}

/** Shared validation for Confirm timer, Lock name persist, and duration draft resolution. */
function resolveTimerDraftForMeta(
  timer: QuestionTimerSettings,
  draft: string,
  mode: "confirm" | "persist",
  durationCommitted: boolean,
): ResolveTimerDraftResult {
  const trimmed = draft.trim();
  if (trimmed === "") {
    if (mode === "persist" && durationCommitted) {
      const nonsense = rejectNonsenseTimer(timer);
      if (nonsense) return nonsense;
      return {
        ok: true,
        timer,
        draftDisplay:
          timer.scope === "whole_test"
            ? String(timer.seconds === 0 ? 0 : Math.round(timer.seconds / 60))
            : String(timer.seconds),
      };
    }
    return {
      ok: false,
      message:
        timer.scope === "whole_test"
          ? `Enter how long the full test lasts in whole minutes (1–${QUESTION_TIMER_MAX_MIN_WHOLE_TEST}), or choose a preset.`
          : `Enter how long each question lasts in seconds (1–${maxSecondsForTimerScope("per_question")}), or choose a preset.`,
    };
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n)) {
    return {
      ok: false,
      message:
        timer.scope === "whole_test" ? "Minutes must be a whole number." : "Seconds must be a whole number.",
    };
  }
  if (timer.scope === "whole_test" && n < 1) {
    return {
      ok: false,
      message: "Full test must be at least 1 minute — a shorter or zero countdown is not valid.",
    };
  }
  if (timer.scope === "per_question" && n < 1) {
    return {
      ok: false,
      message: "Per-question timer must be at least 1 second.",
    };
  }
  const c =
    timer.scope === "whole_test"
      ? clampQuestionTimerSeconds(n * 60, "whole_test")
      : clampQuestionTimerSeconds(n, "per_question");
  const nextTimer = { ...timer, seconds: c };
  const nonsense = rejectNonsenseTimer(nextTimer);
  if (nonsense) return nonsense;
  const draftDisplay = timer.scope === "whole_test" ? String(c / 60) : String(c);
  return { ok: true, timer: nextTimer, draftDisplay };
}

const TIMER_PRESET_SEC_PER_QUESTION = [5, 10, 15, 30, 45, 60, 90, 120, 180] as const;
/** Full Test: typical exam-style lengths in whole minutes (stored as seconds = min × 60). */
const TIMER_PRESET_MIN_WHOLE_TEST = [15, 20, 30, 45, 60, 90, 120, 150, 180, 240] as const;

const MAX_QUESTIONS = 500;
const MAX_CHOICES_PER_QUESTION = 26;
const MIN_CHOICES_PER_QUESTION = 2;

type PendingBankConfirm =
  | { type: "idle" }
  | { type: "delete-bank" }
  | { type: "delete-question"; id: string }
  | { type: "delete-bulk"; count: number }
  | { type: "remove-library-visual"; orphanKey: string };

type QRow = {
  id: string;
  stem: string;
  choices: string[];
  correct_index: number;
  position: number;
  media_url: string | null;
  assets: QuestionAsset[] | null;
};

type Draft = {
  stem: string;
  choices: string[];
  correct: number;
  /** Images/tables for this draft; manual add uses 0–1 from the saved strip; edit loads existing + allows more. */
  linkedAssets: QuestionAsset[];
};

const emptyDraft = (): Draft => ({
  stem: "",
  choices: ["", "", ""],
  correct: 0,
  linkedAssets: [],
});

function rowLinkedAssets(row: QRow): QuestionAsset[] {
  if (row.assets && row.assets.length > 0) return [...row.assets];
  if (row.media_url) return [{ kind: "image", url: row.media_url }];
  return [];
}

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

function rowToChoices(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const choices = raw.filter((c): c is string => typeof c === "string");
  return choices.length >= 2 ? choices : null;
}

function parseQuestionAssetsJson(raw: unknown): QuestionAsset[] | null {
  if (!Array.isArray(raw)) return null;
  const out: QuestionAsset[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (o.kind === "image" && typeof o.url === "string" && o.url.length > 0) {
      out.push({ kind: "image", url: o.url });
      continue;
    }
    if (o.kind === "table" && typeof o.html === "string") {
      out.push({
        kind: "table",
        html: o.html,
        plainText: typeof o.plainText === "string" ? o.plainText : undefined,
      });
    }
  }
  return out.length > 0 ? out : null;
}

function parseBankOrphanAssets(raw: unknown): QuestionAsset[] {
  return parseQuestionAssetsJson(raw) ?? [];
}

function usedAssetKeysFromQuestions(rows: QRow[]): Set<string> {
  const s = new Set<string>();
  for (const q of rows) {
    const list =
      q.assets && q.assets.length > 0
        ? q.assets
        : q.media_url
          ? [{ kind: "image" as const, url: q.media_url }]
          : [];
    for (const a of list) s.add(storedAssetContentKey(a));
  }
  return s;
}

const MAX_LIBRARY_IMAGE_BYTES = 5 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      if (typeof r.result === "string") resolve(r.result);
      else reject(new Error("Could not read file."));
    };
    r.onerror = () => reject(r.error ?? new Error("Read failed"));
    r.readAsDataURL(file);
  });
}

function storedAssetContentKey(a: QuestionAsset): string {
  return a.kind === "image" ? `i:${a.url}` : `t:${a.html}`;
}

type SavedAssetGroup = {
  key: string;
  asset: QuestionAsset;
  usage: { questionId: string; displayNumber: number; assetIndex: number }[];
};

/** After the inline editor closes, re-anchor the list so the user isn’t lost in the scroll position. */
function scrollBankQuestionRowIntoView(questionId: string) {
  const el = document.getElementById(`bank-q-${questionId}`);
  if (!el) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "center",
    inline: "nearest",
  });
}

function assetsToStoragePayload(list: QuestionAsset[]): {
  media_url: string | null;
  assets: QuestionAsset[] | null;
} {
  if (list.length === 0) return { media_url: null, assets: null };
  const firstImage = list.find((x) => x.kind === "image");
  return { media_url: firstImage?.url ?? null, assets: list };
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

type EditWorkspaceTab = "general" | "questions" | "visuals";

const MY_BANK_EDIT_TAB_STORAGE_KEY = (id: string) => `studydeck:my-bank-edit-tab:${id}`;

function readStoredEditTab(bankId: string | undefined): EditWorkspaceTab {
  if (!bankId || typeof sessionStorage === "undefined") return "general";
  try {
    const raw = sessionStorage.getItem(MY_BANK_EDIT_TAB_STORAGE_KEY(bankId));
    if (raw === "general" || raw === "questions" || raw === "visuals") return raw;
  } catch {
    /* private mode / storage blocked */
  }
  return "general";
}

function writeStoredEditTab(bankId: string | undefined, tab: EditWorkspaceTab) {
  if (!bankId || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(MY_BANK_EDIT_TAB_STORAGE_KEY(bankId), tab);
  } catch {
    /* quota */
  }
}

export default function MyBankEditPage() {
  const { bankId } = useParams<{ bankId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [bankTitle, setBankTitle] = useState("");
  const [questions, setQuestions] = useState<QRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingBankMeta, setSavingBankMeta] = useState(false);
  const [titleEditUnlocked, setTitleEditUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const questionEditorRef = useRef<HTMLLIElement>(null);
  const [newQ, setNewQ] = useState<Draft>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft());
  const uploadFileInputRef = useRef<HTMLInputElement>(null);
  const libraryMediaUploadRef = useRef<HTMLInputElement>(null);
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
  const [expectedChoicesInput, setExpectedChoicesInput] = useState("");
  const [hintModalOpen, setHintModalOpen] = useState(false);
  const [hintTab, setHintTab] = useState<"best" | "styles">("best");
  const [addMode, setAddMode] = useState<"manual" | "import" | "none">("none");
  const [editWorkspaceTab, setEditWorkspaceTab] = useState<EditWorkspaceTab>(() =>
    readStoredEditTab(bankId),
  );
  const setWorkspaceTab = useCallback(
    (tab: EditWorkspaceTab) => {
      setEditWorkspaceTab(tab);
      writeStoredEditTab(bankId, tab);
    },
    [bankId],
  );
  const [savedVisualModal, setSavedVisualModal] = useState<SavedAssetGroup | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(12);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewOnlyNeedsAsset, setPreviewOnlyNeedsAsset] = useState(false);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [questionSearch, setQuestionSearch] = useState("");
  const [orphanAssets, setOrphanAssets] = useState<QuestionAsset[]>([]);
  const [uploadingLibraryMedia, setUploadingLibraryMedia] = useState(false);
  const [questionTimer, setQuestionTimer] = useState<QuestionTimerSettings | null>(null);
  /** Draft string for seconds field so the box can be empty while typing; synced from `questionTimer.seconds` when it changes externally. */
  const [timerSecDraft, setTimerSecDraft] = useState("");
  const timerJustAddedRef = useRef(false);
  /** False only right after "Add a timer" until the user sets seconds via preset, blur, or confirm with a valid value. */
  const [timerDurationCommitted, setTimerDurationCommitted] = useState(true);
  /** Timer validation / save-prep errors shown inside the session timer card only. */
  const [timerCardError, setTimerCardError] = useState<string | null>(null);
  const [savedBankMeta, setSavedBankMeta] = useState<{
    title: string;
    timer: QuestionTimerSettings | null;
  } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingBankConfirm>({ type: "idle" });

  const bankMetaDirty = useMemo(() => {
    if (!savedBankMeta) return false;
    if (bankTitle.trim() !== savedBankMeta.title.trim()) return true;
    return !questionTimersEqual(questionTimer, savedBankMeta.timer);
  }, [savedBankMeta, bankTitle, questionTimer]);

  /** Human-readable list for the leave-without-saving modal (matches `bankMetaDirty`). */
  const unsavedLeaveWarningItems = useMemo((): { key: string; text: string; fixTarget: "title" | "timer" }[] => {
    if (!savedBankMeta) return [];
    const items: { key: string; text: string; fixTarget: "title" | "timer" }[] = [];
    if (bankTitle.trim() !== savedBankMeta.title.trim()) {
      items.push({
        key: "title",
        fixTarget: "title",
        text: "Test name — use Lock name on General to save your new title.",
      });
    }
    if (!questionTimersEqual(questionTimer, savedBankMeta.timer)) {
      const s = savedBankMeta.timer;
      const c = questionTimer;
      if (c === null && s !== null) {
        items.push({
          key: "timer-removed",
          fixTarget: "timer",
          text: "Session timer — removal isn’t saved yet; the timer is still stored for this test until it saves.",
        });
      } else if (c !== null && s === null) {
        items.push({
          key: "timer-new",
          fixTarget: "timer",
          text: "Session timer — new clock isn’t saved yet; use Confirm timer on General.",
        });
      } else {
        items.push({
          key: "timer-changed",
          fixTarget: "timer",
          text: "Session timer — settings differ from what’s saved; use Confirm timer or Cancel on General.",
        });
      }
    }
    return items;
  }, [savedBankMeta, bankTitle, questionTimer]);

  /** Timer differs from last saved snapshot, still drafting, or removed locally — show Cancel to revert. */
  const timerHasUnsavedEdits = useMemo(() => {
    if (!savedBankMeta) return false;
    const sameAsSaved = questionTimersEqual(questionTimer, savedBankMeta.timer);
    if (!sameAsSaved) return true;
    return questionTimer !== null && !timerDurationCommitted;
  }, [savedBankMeta, questionTimer, timerDurationCommitted]);

  /** Cancel only when editing a timer that already exists on the saved bank (discard edits — not removal). */
  const timerShowCancel = useMemo(() => {
    if (!savedBankMeta?.timer || questionTimer === null) return false;
    return timerHasUnsavedEdits;
  }, [savedBankMeta?.timer, questionTimer, timerHasUnsavedEdits]);

  const blocker = useBlocker(bankMetaDirty);

  const goToUnsavedLeaveIssue = useCallback(
    (target: "title" | "timer") => {
      if (blocker.state === "blocked") {
        blocker.reset();
      }
      setWorkspaceTab("general");
      const scrollOpts: ScrollIntoViewOptions = {
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "nearest",
      };
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (target === "title") {
            flushSync(() => {
              setTitleEditUnlocked(true);
            });
            document.getElementById("my-bank-test-name-section")?.scrollIntoView(scrollOpts);
            titleInputRef.current?.focus({ preventScroll: true });
          } else {
            document.getElementById("my-bank-session-timer-section")?.scrollIntoView(scrollOpts);
          }
        });
      });
    },
    [blocker, setWorkspaceTab],
  );

  const onBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      if (!bankMetaDirty) return;
      e.preventDefault();
      e.returnValue = "";
    },
    [bankMetaDirty],
  );

  useBeforeUnload(onBeforeUnload);

  useEffect(() => {
    if (!bankId) return;
    setEditWorkspaceTab(readStoredEditTab(bankId));
  }, [bankId]);

  const timerDurationSyncKey =
    questionTimer == null ? null : `${questionTimer.scope}:${questionTimer.seconds}`;
  useEffect(() => {
    if (questionTimer === null) {
      setTimerDurationCommitted(true);
    }
  }, [questionTimer]);

  useEffect(() => {
    setTimerCardError(null);
  }, [
    questionTimer?.seconds,
    questionTimer?.scope,
    questionTimer?.display,
    questionTimer?.onExpire,
    timerSecDraft,
    timerDurationCommitted,
  ]);

  useEffect(() => {
    if (timerDurationSyncKey === null) {
      setTimerSecDraft("");
      return;
    }
    if (timerJustAddedRef.current) {
      timerJustAddedRef.current = false;
      setTimerSecDraft("");
      return;
    }
    if (!questionTimer) return;
    if (questionTimer.scope === "whole_test") {
      const sec = questionTimer.seconds;
      setTimerSecDraft(sec === 0 ? "0" : String(Math.round(sec / 60)));
    } else {
      setTimerSecDraft(String(questionTimer.seconds));
    }
  }, [timerDurationSyncKey, questionTimer]);

  useEffect(() => {
    if (blocker.state !== "blocked" && pendingConfirm.type === "idle") return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (blocker.state === "blocked") {
        blocker.reset();
      } else {
        setPendingConfirm({ type: "idle" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [blocker, pendingConfirm.type]);

  const load = useCallback(async (options?: { background?: boolean }) => {
    const background = options?.background === true;
    if (!bankId || !isUuid(bankId) || !supabase) {
      setError("Invalid test link.");
      setLoading(false);
      return;
    }
    if (!background) {
      setLoading(true);
    }
    setError(null);
    try {
      const { data: bank, error: bErr } = await supabase
        .from("user_question_banks")
        .select("title, user_id, orphan_assets, question_timer_config, per_question_time_limit_sec")
        .eq("id", bankId)
        .maybeSingle();
      if (bErr || !bank) {
        setBankTitle("");
        setQuestionTimer(null);
        setSavedBankMeta(null);
        setError(bErr?.message ?? "Test not found.");
        setQuestions([]);
        return;
      }
      const ownerId =
        typeof (bank as { user_id?: unknown }).user_id === "string"
          ? (bank as { user_id: string }).user_id
          : null;
      if (!background && ownerId && user?.id && ownerId !== user.id) {
        navigate(`/my-banks/${bankId}/practice`, { replace: true });
        return;
      }
      if (!background) {
        const titleStr = typeof bank.title === "string" ? bank.title : "";
        const parsedTimer = questionTimerFromBankRow(
          bank.question_timer_config,
          bank.per_question_time_limit_sec,
        );
        setBankTitle(titleStr);
        setQuestionTimer(parsedTimer);
        setTimerDurationCommitted(true);
        setSavedBankMeta({ title: titleStr, timer: parsedTimer });
      }
      const { data: qs, error: qErr } = await supabase
        .from("user_questions")
        .select("id, stem, choices, correct_index, position, media_url, assets")
        .eq("bank_id", bankId)
        .order("position", { ascending: true });
      if (qErr) {
        setError(qErr.message);
        setQuestions([]);
        setOrphanAssets(parseBankOrphanAssets(bank.orphan_assets));
      } else {
        const mapped: QRow[] = [];
        for (const r of qs ?? []) {
          const ch = rowToChoices(r.choices);
          const ci = r.correct_index;
          if (
            typeof r.id !== "string" ||
            typeof r.stem !== "string" ||
            !ch ||
            typeof ci !== "number" ||
            ci < 0 ||
            ci >= ch.length
          )
            continue;
          const mediaUrl = typeof r.media_url === "string" ? r.media_url : null;
          let assets = parseQuestionAssetsJson(r.assets);
          if (!assets?.length && mediaUrl) {
            assets = [{ kind: "image", url: mediaUrl }];
          }
          mapped.push({
            id: r.id,
            stem: r.stem,
            choices: ch,
            correct_index: ci,
            position: typeof r.position === "number" ? r.position : 0,
            media_url: mediaUrl,
            assets: assets ?? null,
          });
        }
        setQuestions(mapped);
        let orphans = parseBankOrphanAssets(bank.orphan_assets);
        const usedKeys = usedAssetKeysFromQuestions(mapped);
        const prunedOrphans = orphans.filter((a) => !usedKeys.has(storedAssetContentKey(a)));
        if (prunedOrphans.length !== orphans.length) {
          const { error: oErr } = await supabase
            .from("user_question_banks")
            .update({ orphan_assets: prunedOrphans })
            .eq("id", bankId);
          if (oErr) setError(oErr.message);
          orphans = prunedOrphans;
        }
        setOrphanAssets(orphans);
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, [bankId, navigate, user?.id]);

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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (titleEditUnlocked) titleInputRef.current?.focus();
  }, [titleEditUnlocked]);

  useEffect(() => {
    if (!editingId) return;
    const frame = window.requestAnimationFrame(() => {
      const el = questionEditorRef.current;
      if (!el) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "nearest",
        inline: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingId]);

  useEffect(() => {
    const validIds = new Set(questions.map((q) => q.id));
    setSelectedQuestionIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [questions]);

  /** Revert timer UI to the last loaded / saved snapshot on the server. */
  function cancelTimerEdits() {
    if (!savedBankMeta) return;
    setError(null);
    setTimerCardError(null);
    const savedTimer = savedBankMeta.timer;
    if (savedTimer === null) {
      flushSync(() => {
        setQuestionTimer(null);
        setTimerSecDraft("");
        setTimerDurationCommitted(true);
      });
      return;
    }
    const draftDisplay =
      savedTimer.scope === "whole_test"
        ? String(savedTimer.seconds === 0 ? 0 : Math.round(savedTimer.seconds / 60))
        : String(savedTimer.seconds);
    flushSync(() => {
      setQuestionTimer({ ...savedTimer });
      setTimerSecDraft(draftDisplay);
      setTimerDurationCommitted(true);
    });
  }

  /**
   * Persists test name + question timer; on success updates saved snapshot synchronously (for navigation blocker).
   * Pass `timerForPersist` / `titleForPersist` when state was just updated or after an `await` so reads are not
   * stale (e.g. Remove had the old timer in the handler scope).
   */
  async function persistBankGeneralMeta(opts?: {
    titleForPersist?: string;
    timerForPersist?: QuestionTimerSettings | null;
  }): Promise<boolean> {
    if (!supabase || !bankId) return false;
    const t = (opts?.titleForPersist !== undefined ? opts.titleForPersist : bankTitle).trim();
    if (!t) {
      setError("Title cannot be empty.");
      return false;
    }

    let timerForWrite: QuestionTimerSettings | null;
    if (opts !== undefined && "timerForPersist" in opts) {
      timerForWrite = opts.timerForPersist ?? null;
    } else {
      timerForWrite = questionTimer;
      if (timerForWrite) {
        const result = resolveTimerDraftForMeta(
          timerForWrite,
          timerSecDraft,
          "persist",
          timerDurationCommitted,
        );
        if (!result.ok) {
          setError(null);
          setTimerCardError(result.message);
          return false;
        }
        timerForWrite = result.timer;
        flushSync(() => {
          setQuestionTimer(result.timer);
          setTimerSecDraft(result.draftDisplay);
          setTimerDurationCommitted(true);
        });
      }
    }

    setError(null);
    setTimerCardError(null);

    const { error: e } = await supabase
      .from("user_question_banks")
      .update({
        title: t,
        question_timer_config: timerForWrite ? questionTimerToJson(timerForWrite) : null,
        per_question_time_limit_sec: null,
      })
      .eq("id", bankId);
    if (e) {
      setError(e.message);
      return false;
    }
    const normalizedTimer = timerForWrite
      ? {
          ...timerForWrite,
          seconds: clampQuestionTimerSeconds(timerForWrite.seconds, timerForWrite.scope),
        }
      : null;
    flushSync(() => {
      setBankTitle(t);
      setSavedBankMeta({ title: t, timer: normalizedTimer });
      setQuestionTimer(normalizedTimer);
    });
    return true;
  }

  async function ensureNoBlockingQuestionEdit(actionLabel: string): Promise<boolean> {
    if (editingId === null) return true;
    if (!draftValid(editDraft)) {
      setError(
        `Finish editing this question (fill all fields) or cancel before using ${actionLabel}.`,
      );
      return false;
    }
    const edited = await saveEdit();
    return edited;
  }

  /** Persists the name when locking after an edit; coerces an unconfirmed timer draft if needed. */
  async function lockTitleEditAndPersist() {
    const titleSnapshot = bankTitle.trim();
    if (!titleSnapshot) {
      setError("Title cannot be empty.");
      return;
    }
    if (!savedBankMeta) {
      setTitleEditUnlocked(false);
      return;
    }
    if (titleSnapshot === savedBankMeta.title.trim()) {
      setTitleEditUnlocked(false);
      return;
    }

    let timerForWrite: QuestionTimerSettings | null = questionTimer;
    if (timerForWrite && !timerDurationCommitted) {
      const r = resolveTimerDraftForMeta(
        timerForWrite,
        timerSecDraft,
        "persist",
        timerDurationCommitted,
      );
      if (!r.ok) {
        setError(null);
        setTimerCardError(r.message);
        return;
      }
      timerForWrite = r.timer;
      flushSync(() => {
        setQuestionTimer(r.timer);
        setTimerSecDraft(r.draftDisplay);
        setTimerDurationCommitted(true);
      });
    }

    if (!(await ensureNoBlockingQuestionEdit("saving the test name"))) return;
    setSavingBankMeta(true);
    setError(null);
    try {
      const ok = await persistBankGeneralMeta({
        titleForPersist: titleSnapshot,
        timerForPersist: timerForWrite,
      });
      if (!ok) return;
    } finally {
      setSavingBankMeta(false);
    }
    setTitleEditUnlocked(false);
  }

  /** Writes name + timer after confirm. Snapshots avoid stale closures after `await`. */
  async function runPersistBankGeneralMetaFromTimerAction(
    actionLabel: string,
    timerSnapshot: QuestionTimerSettings | null,
  ): Promise<void> {
    if (!supabase || !bankId) return;
    const titleSnapshot = bankTitle.trim();
    if (!(await ensureNoBlockingQuestionEdit(actionLabel))) return;
    setSavingBankMeta(true);
    setError(null);
    try {
      await persistBankGeneralMeta({
        timerForPersist: timerSnapshot,
        titleForPersist: titleSnapshot,
      });
    } finally {
      setSavingBankMeta(false);
    }
  }

  /** Validates duration, marks the timer confirmed, then persists it to the server. */
  function confirmTimerSetup() {
    if (!questionTimer) return;
    const result = resolveTimerDraftForMeta(
      questionTimer,
      timerSecDraft,
      "confirm",
      timerDurationCommitted,
    );
    if (!result.ok) {
      setError(null);
      setTimerCardError(result.message);
      return;
    }
    flushSync(() => {
      setQuestionTimer(result.timer);
      setTimerSecDraft(result.draftDisplay);
      setTimerDurationCommitted(true);
    });
    void runPersistBankGeneralMetaFromTimerAction("saving the timer", result.timer);
  }

  async function removeQuestionTimerAndPersist() {
    if (!supabase || !bankId) return;
    const titleSnapshot = bankTitle.trim();
    if (!(await ensureNoBlockingQuestionEdit("removing the timer"))) return;
    flushSync(() => {
      setQuestionTimer(null);
      setTimerSecDraft("");
      setTimerDurationCommitted(true);
    });
    setSavingBankMeta(true);
    setError(null);
    try {
      await persistBankGeneralMeta({ timerForPersist: null, titleForPersist: titleSnapshot });
    } finally {
      setSavingBankMeta(false);
    }
  }

  async function addQuestion() {
    if (!supabase || !bankId || !draftValid(newQ)) return;
    if (questions.length >= MAX_QUESTIONS) {
      setError(`You can add at most ${MAX_QUESTIONS} questions per test.`);
      return;
    }
    setBusy(true);
    setError(null);
    const nextPos =
      questions.length === 0
        ? 0
        : Math.max(...questions.map((q) => q.position)) + 10;
    const { media_url, assets } = assetsToStoragePayload(newQ.linkedAssets);
    const { error: e } = await supabase.from("user_questions").insert({
      bank_id: bankId,
      stem: newQ.stem.trim(),
      choices: newQ.choices.map((c) => c.trim()),
      correct_index: newQ.correct,
      position: nextPos,
      media_url,
      assets,
    });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    setNewQ(emptyDraft());
    await load({ background: true });
  }

  function setDraftChoice(
    setter: Dispatch<SetStateAction<Draft>>,
    idx: number,
    value: string,
  ) {
    setter((prev) => {
      const next = [...prev.choices];
      next[idx] = value;
      return { ...prev, choices: next };
    });
  }

  function addDraftChoice(setter: Dispatch<SetStateAction<Draft>>) {
    setter((prev) => {
      if (prev.choices.length >= MAX_CHOICES_PER_QUESTION) return prev;
      return { ...prev, choices: [...prev.choices, ""] };
    });
  }

  function removeDraftChoice(
    setter: Dispatch<SetStateAction<Draft>>,
    idx: number,
  ) {
    setter((prev) => {
      if (prev.choices.length <= 2) return prev;
      const nextChoices = prev.choices.filter((_, i) => i !== idx);
      let nextCorrect = prev.correct;
      if (prev.correct === idx) nextCorrect = 0;
      else if (prev.correct > idx) nextCorrect = prev.correct - 1;
      return { ...prev, choices: nextChoices, correct: nextCorrect };
    });
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
      const sanitized = sanitizeImportedQuestions(parsed);
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
    } catch (e) {
      resetImportUiState();
      setError(e instanceof Error ? e.message : "Could not parse this file.");
    } finally {
      setParsingDocx(false);
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = "";
    }
  }

  async function importDocxIntoBank() {
    if (!supabase || !bankId || !docxQuestions || docxQuestions.length === 0) return;
    const remaining = Math.max(0, MAX_QUESTIONS - questions.length);
    if (remaining <= 0) {
      setError(`This test already has ${MAX_QUESTIONS} questions.`);
      return;
    }

    setError(null);
    setImportingDocx(true);
    const maxPos =
      questions.length === 0 ? 0 : Math.max(...questions.map((q) => q.position));
    const startPos = questions.length === 0 ? 0 : maxPos + 10;
    const sanitized = sanitizeImportedQuestions(docxQuestions).slice(0, remaining);
    if (sanitized.length === 0) {
      setImportingDocx(false);
      setError("No valid questions to insert after validation.");
      return;
    }
    const payload = sanitized.map((q, i) => {
      const { media_url, assets } = importedQuestionToStoragePayload(q);
      return {
        bank_id: bankId,
        stem: q.stem,
        choices: q.choices,
        correct_index: q.correctIndex,
        media_url,
        assets,
        position: startPos + i * 10,
      };
    });
    const { error: qErr } = await supabase.from("user_questions").insert(payload);
    setImportingDocx(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    resetImportUiState();
    await load({ background: true });
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

  function beginEdit(q: QRow) {
    setError(null);
    setEditingId(q.id);
    setEditDraft({
      stem: q.stem,
      choices: [...q.choices],
      correct: q.correct_index,
      linkedAssets: rowLinkedAssets(q),
    });
  }

  async function saveEdit(): Promise<boolean> {
    if (!supabase || !editingId || !draftValid(editDraft)) return false;
    setBusy(true);
    setSavingQuestion(true);
    setError(null);
    const { media_url, assets } = assetsToStoragePayload(editDraft.linkedAssets);
    const { error: e } = await supabase
      .from("user_questions")
      .update({
        stem: editDraft.stem.trim(),
        choices: editDraft.choices.map((c) => c.trim()),
        correct_index: editDraft.correct,
        media_url,
        assets,
      })
      .eq("id", editingId);
    setBusy(false);
    setSavingQuestion(false);
    if (e) {
      setError(e.message);
      return false;
    }
    const savedId = editingId;
    setEditingId(null);
    await load({ background: true });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollBankQuestionRowIntoView(savedId);
      });
    });
    return true;
  }

  function requestDeleteQuestion(id: string) {
    setPendingConfirm({ type: "delete-question", id });
  }

  async function runDeleteQuestion(id: string) {
    if (!supabase) return;
    setPendingConfirm({ type: "idle" });
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.from("user_questions").delete().eq("id", id);
    setBusy(false);
    if (e) setError(e.message);
    else {
      if (editingId === id) setEditingId(null);
      await load({ background: true });
    }
  }

  function requestDeleteSelectedQuestions() {
    if (selectedQuestionIds.length === 0) return;
    setPendingConfirm({ type: "delete-bulk", count: selectedQuestionIds.length });
  }

  async function runDeleteSelectedQuestions() {
    if (!supabase || selectedQuestionIds.length === 0) return;
    const ids = [...selectedQuestionIds];
    setPendingConfirm({ type: "idle" });
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.from("user_questions").delete().in("id", ids);
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    if (editingId && ids.includes(editingId)) setEditingId(null);
    setSelectedQuestionIds([]);
    await load({ background: true });
  }

  async function appendOrphanToBankIfUnused(asset: QuestionAsset) {
    if (!supabase || !bankId) return;
    const key = storedAssetContentKey(asset);
    const { data: rows } = await supabase
      .from("user_questions")
      .select("media_url, assets")
      .eq("bank_id", bankId);
    for (const r of rows ?? []) {
      let list = parseQuestionAssetsJson(r.assets);
      if (!list?.length && typeof r.media_url === "string" && r.media_url.length > 0) {
        list = [{ kind: "image", url: r.media_url }];
      }
      for (const a of list ?? []) {
        if (storedAssetContentKey(a) === key) return;
      }
    }
    const { data: b } = await supabase
      .from("user_question_banks")
      .select("orphan_assets")
      .eq("id", bankId)
      .maybeSingle();
    const cur = parseBankOrphanAssets(b?.orphan_assets);
    if (cur.some((a) => storedAssetContentKey(a) === key)) return;
    const { error: oErr } = await supabase
      .from("user_question_banks")
      .update({ orphan_assets: [...cur, asset] })
      .eq("id", bankId);
    if (oErr) setError(oErr.message);
  }

  async function removeOrphanFromBank(key: string) {
    if (!supabase || !bankId) return;
    const next = orphanAssets.filter((a) => storedAssetContentKey(a) !== key);
    setBusy(true);
    setError(null);
    const { error: e } = await supabase
      .from("user_question_banks")
      .update({ orphan_assets: next })
      .eq("id", bankId);
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    setOrphanAssets(next);
  }

  async function handleLibraryImageUpload(files: FileList | null) {
    if (!supabase || !bankId || !files?.length) return;
    const list = Array.from(files);
    setUploadingLibraryMedia(true);
    setError(null);
    try {
      const used = usedAssetKeysFromQuestions(questions);
      const { data: b, error: fetchErr } = await supabase
        .from("user_question_banks")
        .select("orphan_assets")
        .eq("id", bankId)
        .maybeSingle();
      if (fetchErr) {
        setError(fetchErr.message);
        return;
      }
      let cur = parseBankOrphanAssets(b?.orphan_assets);
      const seen = new Set(cur.map((a) => storedAssetContentKey(a)));
      const newAssets: QuestionAsset[] = [];
      const notes: string[] = [];
      for (const file of list) {
        if (!file.type.startsWith("image/")) {
          notes.push(`“${file.name}” is not an image.`);
          continue;
        }
        if (file.size > MAX_LIBRARY_IMAGE_BYTES) {
          notes.push(`“${file.name}” is larger than ${MAX_LIBRARY_IMAGE_BYTES / (1024 * 1024)} MB.`);
          continue;
        }
        const dataUrl = await readFileAsDataUrl(file);
        const asset: QuestionAsset = { kind: "image", url: dataUrl };
        const key = storedAssetContentKey(asset);
        if (used.has(key)) {
          notes.push(`“${file.name}” matches media already on a question.`);
          continue;
        }
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        newAssets.push(asset);
      }
      if (newAssets.length === 0) {
        setError(
          notes.length > 0
            ? notes.join(" ")
            : list.length > 1
              ? "No new images were added (duplicates skipped)."
              : "Could not add this image.",
        );
        return;
      }
      const { error: upErr } = await supabase
        .from("user_question_banks")
        .update({ orphan_assets: [...cur, ...newAssets] })
        .eq("id", bankId);
      if (upErr) {
        setError(upErr.message);
        return;
      }
      setError(null);
      await load({ background: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploadingLibraryMedia(false);
      if (libraryMediaUploadRef.current) libraryMediaUploadRef.current.value = "";
    }
  }

  async function removeSavedAssetFromQuestion(questionId: string, assetIndex: number) {
    if (!supabase) return;
    const q = questions.find((x) => x.id === questionId);
    if (!q) return;
    const base =
      q.assets && q.assets.length > 0
        ? [...q.assets]
        : q.media_url
          ? [{ kind: "image" as const, url: q.media_url }]
          : [];
    if (assetIndex < 0 || assetIndex >= base.length) return;
    const removedAsset = base[assetIndex]!;
    base.splice(assetIndex, 1);
    const { media_url, assets } = assetsToStoragePayload(base);
    setBusy(true);
    setError(null);
    const { error: e } = await supabase
      .from("user_questions")
      .update({ media_url, assets })
      .eq("id", questionId);
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    await appendOrphanToBankIfUnused(removedAsset);
    await load({ background: true });
  }

  function isQuestionSelected(id: string): boolean {
    return selectedQuestionIds.includes(id);
  }

  function toggleQuestionSelected(id: string) {
    setSelectedQuestionIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  }

  function requestDeleteBank() {
    setPendingConfirm({ type: "delete-bank" });
  }

  async function runDeleteBank() {
    if (!supabase || !bankId) return;
    setPendingConfirm({ type: "idle" });
    setBusy(true);
    const { error: e } = await supabase.from("user_question_banks").delete().eq("id", bankId);
    setBusy(false);
    if (e) setError(e.message);
    else {
      setSavedBankMeta(null);
      navigate("/my-banks", { replace: true });
    }
  }

  function requestRemoveLibraryVisual(orphanKey: string) {
    setSavedVisualModal((prev) => (prev?.key === orphanKey ? null : prev));
    setPendingConfirm({ type: "remove-library-visual", orphanKey });
  }

  async function runRemoveLibraryVisual(orphanKey: string) {
    setPendingConfirm({ type: "idle" });
    await removeOrphanFromBank(orphanKey);
  }

  const filteredQuestions = useMemo(() => {
    const term = questionSearch.trim().toLowerCase();
    if (!term) {
      return questions.map((q, i) => ({ ...q, displayNumber: i + 1 }));
    }
    const numericTerm = term.match(/(?:^|\s)(?:question|q|#)?\s*(\d+)(?:\s|$)/)?.[1] ?? null;
    const out: Array<QRow & { displayNumber: number }> = [];
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i]!;
      const questionNumber = i + 1;
      const haystack =
        `${q.stem} ${q.choices.join(" ")} question ${questionNumber} #${questionNumber}`.toLowerCase();
      const matchesNumber = numericTerm !== null && String(questionNumber) === numericTerm;
      if (haystack.includes(term) || matchesNumber) out.push({ ...q, displayNumber: questionNumber });
    }
    return out;
  }, [questions, questionSearch]);

  const visibleQuestionIds = filteredQuestions.map((q) => q.id);
  const allSelected =
    visibleQuestionIds.length > 0 && visibleQuestionIds.every((id) => selectedQuestionIds.includes(id));

  const savedAssetGroups = useMemo(() => {
    const map = new Map<string, SavedAssetGroup>();
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i]!;
      const displayNumber = i + 1;
      const list =
        q.assets && q.assets.length > 0
          ? q.assets
          : q.media_url
            ? [{ kind: "image" as const, url: q.media_url }]
            : [];
      for (let assetIndex = 0; assetIndex < list.length; assetIndex += 1) {
        const a = list[assetIndex]!;
        const key = storedAssetContentKey(a);
        let g = map.get(key);
        if (!g) {
          g = { key, asset: a, usage: [] };
          map.set(key, g);
        }
        g.usage.push({ questionId: q.id, displayNumber, assetIndex });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => a.usage[0]!.displayNumber - b.usage[0]!.displayNumber,
    );
  }, [questions]);

  const orphanAssetGroups = useMemo(
    (): SavedAssetGroup[] =>
      orphanAssets.map((asset) => ({
        key: storedAssetContentKey(asset),
        asset,
        usage: [],
      })),
    [orphanAssets],
  );

  /** Every unique visual/table on this test: linked to questions and/or only in the orphan library (deduped). */
  const allBankVisualGroups = useMemo(() => {
    const byKey = new Map<string, SavedAssetGroup>();
    for (const g of savedAssetGroups) {
      byKey.set(g.key, g);
    }
    for (const g of orphanAssetGroups) {
      if (!byKey.has(g.key)) {
        byKey.set(g.key, g);
      }
    }
    const merged = Array.from(byKey.values());
    merged.sort((a, b) => {
      const aPri = a.usage.length > 0 ? a.usage[0]!.displayNumber : 10_000;
      const bPri = b.usage.length > 0 ? b.usage[0]!.displayNumber : 10_000;
      if (aPri !== bPri) return aPri - bPri;
      return a.key.localeCompare(b.key);
    });
    return merged;
  }, [savedAssetGroups, orphanAssetGroups]);

  useEffect(() => {
    if (!savedVisualModal) return;
    const next = allBankVisualGroups.find((x) => x.key === savedVisualModal.key) ?? null;
    if (!next) {
      setSavedVisualModal(null);
      return;
    }
    const u0 = savedVisualModal.usage;
    const u1 = next.usage;
    if (
      u0.length === u1.length &&
      u0.every(
        (u, i) =>
          u1[i] &&
          u1[i].questionId === u.questionId &&
          u1[i].assetIndex === u.assetIndex &&
          u1[i].displayNumber === u.displayNumber,
      )
    ) {
      return;
    }
    setSavedVisualModal(next);
  }, [allBankVisualGroups, savedVisualModal]);

  useEffect(() => {
    if (!savedVisualModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSavedVisualModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [savedVisualModal]);

  const visualPickerGroups = allBankVisualGroups;

  const savedQuestionsWithAssetsCount = useMemo(
    () =>
      questions.filter((q) => (q.assets && q.assets.length > 0) || !!q.media_url).length,
    [questions],
  );

  const importChoicesReady = useMemo(() => {
    const n = Number.parseInt(expectedChoicesInput, 10);
    return (
      Number.isFinite(n) &&
      n >= MIN_CHOICES_PER_QUESTION &&
      n <= MAX_CHOICES_PER_QUESTION
    );
  }, [expectedChoicesInput]);

  if (!bankId || !isUuid(bankId)) {
    return (
      <main className="page page--centered">
        <p className="muted">Invalid test link.</p>
        <Link to="/my-banks" className="btn secondary">
          Work Shop
        </Link>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="page page--centered">
        <div className="spinner" aria-hidden />
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (error && !bankTitle && questions.length === 0) {
    return (
      <main className="page page--centered">
        <p className="muted">{error}</p>
        <Link to="/my-banks" className="btn secondary">
          Work Shop
        </Link>
      </main>
    );
  }

  return (
    <main className="page page-my-bank-edit page-custom-tests">
      {error ? <p className="auth-error custom-tests-error">{error}</p> : null}

      <section className="card my-bank-edit-workspace">
        <div
          className="my-bank-meta-save-strip"
          role="region"
          aria-label="Run this test or return to Work Shop"
        >
          <div className="my-bank-meta-save-strip__inner">
            <div
              className="my-bank-meta-save-strip__cluster my-bank-meta-save-strip__cluster--solo"
              role="group"
              aria-label="Practice this test"
            >
              <Link
                to={`/my-banks/${bankId}/practice`}
                state={{ from: location.pathname }}
                className={`btn secondary my-bank-workspace-cta my-bank-workspace-cta--run${questions.length === 0 ? " custom-tests-link-disabled" : ""}`}
                aria-disabled={questions.length === 0}
                tabIndex={questions.length === 0 ? -1 : undefined}
                onClick={(e) => {
                  if (questions.length === 0) e.preventDefault();
                }}
              >
                Run Test
              </Link>
            </div>
            <div
              className="my-bank-meta-save-strip__cluster my-bank-meta-save-strip__cluster--solo my-bank-meta-save-strip__cluster--merged-save"
              role="group"
              aria-label="Work Shop"
            >
              <Link
                to="/my-banks"
                className="btn secondary my-bank-workspace-cta my-bank-workspace-cta--save"
                aria-disabled={savingBankMeta || busy}
                tabIndex={savingBankMeta || busy ? -1 : undefined}
                onClick={(e) => {
                  if (savingBankMeta || busy) e.preventDefault();
                }}
              >
                Return
              </Link>
            </div>
          </div>
        </div>

        <div className="my-bank-edit-workspace-tablist" role="tablist" aria-label="Edit custom test">
          <button
            type="button"
            role="tab"
            id="edit-workspace-tab-general"
            aria-controls="edit-workspace-panel"
            aria-selected={editWorkspaceTab === "general"}
            className="my-bank-edit-workspace-tab"
            onClick={() => setWorkspaceTab("general")}
          >
            General
          </button>
          <button
            type="button"
            role="tab"
            id="edit-workspace-tab-questions"
            aria-controls="edit-workspace-panel"
            aria-selected={editWorkspaceTab === "questions"}
            className="my-bank-edit-workspace-tab"
            onClick={() => setWorkspaceTab("questions")}
          >
            Questions
          </button>
          <button
            type="button"
            role="tab"
            id="edit-workspace-tab-visuals"
            aria-controls="edit-workspace-panel"
            aria-selected={editWorkspaceTab === "visuals"}
            className="my-bank-edit-workspace-tab"
            onClick={() => setWorkspaceTab("visuals")}
          >
            Visuals
          </button>
        </div>

        <div
          key={editWorkspaceTab}
          id="edit-workspace-panel"
          role="tabpanel"
          aria-labelledby={`edit-workspace-tab-${editWorkspaceTab}`}
          className="my-bank-edit-workspace-panel"
        >
        {editWorkspaceTab === "general" ? (
          <div className="my-bank-general-overview">
            <section
              className="card my-bank-general-summary"
              aria-labelledby="custom-test-title-label my-bank-general-details-heading"
            >
              <div className="my-bank-general-summary__hero">
                <p className="eyebrow custom-tests-eyebrow my-bank-general-summary__eyebrow">Work Shop</p>
                <div className="my-bank-general-summary__top">
                  <div className="my-bank-title-block" id="my-bank-test-name-section">
                    <div className="my-bank-title-label-row">
                      <span className="custom-tests-title-label" id="custom-test-title-label">
                        Test name
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact my-bank-title-toggle"
                        disabled={busy || savingBankMeta}
                        onMouseDown={(e) => {
                          if (titleEditUnlocked) e.preventDefault();
                        }}
                        onClick={() => {
                          if (titleEditUnlocked) void lockTitleEditAndPersist();
                          else setTitleEditUnlocked(true);
                        }}
                      >
                        {titleEditUnlocked ? "Lock name" : "Edit name"}
                      </button>
                    </div>
                    {titleEditUnlocked ? (
                      <div className="my-bank-title-row">
                        <input
                          ref={titleInputRef}
                          id="custom-test-title"
                          className="input my-bank-title-input"
                          value={bankTitle}
                          onChange={(e) => setBankTitle(e.target.value)}
                          aria-labelledby="custom-test-title-label"
                        />
                        <span className="muted my-bank-save-hint">
                          <strong>Lock name</strong> saves the title and hides the field. The session timer saves when
                          you <strong>Confirm</strong> or <strong>Remove</strong> it below.
                        </span>
                      </div>
                    ) : (
                      <p
                        className="my-bank-title-display my-bank-general-title-display"
                        aria-labelledby="custom-test-title-label"
                      >
                        {bankTitle.trim() || "Untitled test"}
                      </p>
                    )}
                  </div>
                  <nav className="my-bank-general-quick-nav" aria-label="Edit another section">
                    <button
                      type="button"
                      className="my-bank-general-quick-link"
                      onClick={() => setWorkspaceTab("questions")}
                    >
                      Questions
                    </button>
                    <span className="my-bank-general-quick-nav__sep" aria-hidden />
                    <button
                      type="button"
                      className="my-bank-general-quick-link"
                      onClick={() => setWorkspaceTab("visuals")}
                    >
                      Visual library
                    </button>
                  </nav>
                </div>
              </div>
              <div className="my-bank-general-summary__divider" aria-hidden />
              <div className="my-bank-general-summary__stats">
                <div className="my-bank-general-summary__stats-head">
                  <h2 className="my-bank-section-title my-bank-general-summary__stats-title" id="my-bank-general-details-heading">
                    At a glance
                  </h2>
                  <p className="muted my-bank-section-sub my-bank-general-summary__stats-intro">
                    Pool on <strong>Questions</strong> · media on <strong>Visuals</strong>
                  </p>
                </div>
                <div className="my-bank-general-metrics my-bank-general-summary__metrics">
                  <div className="my-bank-general-metric my-bank-general-metric--cyan">
                    <span className="my-bank-general-metric__label">Questions saved</span>
                    <span className="my-bank-general-metric__value">{questions.length}</span>
                    <span className="my-bank-general-metric__hint">of {MAX_QUESTIONS} maximum</span>
                  </div>
                  <div className="my-bank-general-metric my-bank-general-metric--violet">
                    <span className="my-bank-general-metric__label">With visual or table</span>
                    <span className="my-bank-general-metric__value">{savedQuestionsWithAssetsCount}</span>
                    <span className="my-bank-general-metric__hint">questions include media</span>
                  </div>
                  <div className="my-bank-general-metric my-bank-general-metric--amber">
                    <span className="my-bank-general-metric__label">Visual library</span>
                    <span className="my-bank-general-metric__value">{allBankVisualGroups.length}</span>
                    <span className="my-bank-general-metric__hint">
                      {savedAssetGroups.length > 0 || orphanAssetGroups.length > 0
                        ? `${savedAssetGroups.length} linked${orphanAssetGroups.length > 0 ? ` · ${orphanAssetGroups.length} not linked` : ""}`
                        : "no assets yet"}
                    </span>
                  </div>
                </div>
              </div>
            </section>
            <section
              id="my-bank-session-timer-section"
              className={[
                "card",
                "my-bank-qtimer",
                questionTimer && !timerDurationCommitted ? "my-bank-qtimer--drafting" : "",
                questionTimer && timerDurationCommitted ? "my-bank-qtimer--locked" : "",
                timerCardError ? "my-bank-qtimer--has-error" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-labelledby="my-bank-qtimer-heading"
            >
              <header className="my-bank-qtimer__header">
                <div className="my-bank-qtimer__header-main">
                  <h2 className="my-bank-qtimer__title" id="my-bank-qtimer-heading">
                    Session timer
                  </h2>
                  <p className="my-bank-qtimer__sub">
                    Pace learners during <strong>Run Test</strong>: per-question limits or one <strong>Full Test</strong>{" "}
                    countdown that ends the session. <strong>Confirm</strong> applies and saves your timer;{" "}
                    <strong>Remove timer</strong> saves as well.
                  </p>
                </div>
                <div
                  className={
                    "my-bank-qtimer__status" +
                    (!questionTimer
                      ? " my-bank-qtimer__status--off"
                      : timerDurationCommitted
                        ? " my-bank-qtimer__status--live"
                        : " my-bank-qtimer__status--draft")
                  }
                >
                  <span className="my-bank-qtimer__status-eyebrow">
                    {!questionTimer
                      ? "Timer off"
                      : timerDurationCommitted
                        ? "Ready"
                        : "Draft"}
                  </span>
                  <p className="my-bank-qtimer__status-body">
                    {questionTimer
                      ? timerDurationCommitted
                        ? describeQuestionTimerRecipe(questionTimer)
                        : "Choose scope, duration, and per-question options, then confirm below to save."
                      : "No session clock — learners choose their own pace on each item."}
                  </p>
                </div>
              </header>
              <div className="my-bank-qtimer__body">
                {timerCardError ? (
                  <p className="my-bank-qtimer__inline-error" role="alert">
                    {timerCardError}
                  </p>
                ) : null}
                {!questionTimer ? (
                  <div className="my-bank-qtimer__idle">
                    <p className="my-bank-qtimer__idle-text">
                      Add a timer when you want a visible limit during practice. You can remove it anytime.
                    </p>
                    <button
                      type="button"
                      className="btn secondary my-bank-qtimer__primary-action"
                      disabled={busy || savingBankMeta}
                      onClick={() => {
                        timerJustAddedRef.current = true;
                        setTimerDurationCommitted(false);
                        setQuestionTimer({
                          seconds: 0,
                          display: "countdown",
                          onExpire: "reveal",
                          scope: "per_question",
                        });
                      }}
                    >
                      Add a timer
                    </button>
                  </div>
                ) : (
                  <div className="my-bank-qtimer__form">
                    <div className="my-bank-qtimer__panel my-bank-qtimer__panel--scope">
                      <p className="my-bank-qtimer__label" id="my-bank-qtimer-scope-label">
                        Applies to
                      </p>
                      <div
                        className="my-bank-qtimer__toggle"
                        role="group"
                        aria-labelledby="my-bank-qtimer-scope-label"
                      >
                        <button
                          type="button"
                          className={
                            questionTimer.scope === "per_question"
                              ? "my-bank-qtimer__opt my-bank-qtimer__opt--on"
                              : "my-bank-qtimer__opt"
                          }
                          disabled={busy || savingBankMeta}
                          onClick={() => {
                            setTimerDurationCommitted(false);
                            setQuestionTimer({
                              ...questionTimer,
                              scope: "per_question",
                              seconds: clampQuestionTimerSeconds(
                                questionTimer.seconds,
                                "per_question",
                              ),
                            });
                          }}
                        >
                          Each question
                        </button>
                        <button
                          type="button"
                          className={
                            questionTimer.scope === "whole_test"
                              ? "my-bank-qtimer__opt my-bank-qtimer__opt--on"
                              : "my-bank-qtimer__opt"
                          }
                          disabled={busy || savingBankMeta}
                          onClick={() => {
                            setTimerDurationCommitted(false);
                            const raw = clampQuestionTimerSeconds(questionTimer.seconds, "whole_test");
                            const snapped = clampQuestionTimerSeconds(
                              Math.round(raw / 60) * 60,
                              "whole_test",
                            );
                            setQuestionTimer({
                              ...questionTimer,
                              scope: "whole_test",
                              seconds: snapped,
                              display: "countdown",
                              onExpire: "reveal",
                            });
                          }}
                        >
                          Full Test
                        </button>
                      </div>
                      <p className="my-bank-qtimer__scope-hint">
                        {questionTimer.scope === "whole_test"
                          ? "One shared countdown for the whole run. At zero, the session ends and results open."
                          : "Clock resets whenever a new question appears."}
                      </p>
                    </div>
                    <fieldset className="my-bank-qtimer__fieldset my-bank-qtimer__panel my-bank-qtimer__panel--duration">
                      <legend className="my-bank-qtimer__legend">
                        {questionTimer.scope === "whole_test" ? "Duration (full test)" : "Duration (per question)"}
                      </legend>
                      <div className="my-bank-qtimer__duration-row">
                        <label className="sr-only" htmlFor="my-bank-per-question-timer-sec">
                          {questionTimer.scope === "whole_test" ? "Minutes" : "Seconds"}
                        </label>
                        <input
                          id="my-bank-per-question-timer-sec"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          className="input my-bank-qtimer__num-input"
                          placeholder={questionTimer.scope === "whole_test" ? "15" : "30"}
                          value={timerSecDraft}
                          disabled={busy || savingBankMeta}
                          onChange={(e) => {
                            setTimerSecDraft(e.target.value);
                            setTimerDurationCommitted(false);
                          }}
                          onBlur={() => {
                            if (!questionTimer) return;
                            const t = timerSecDraft.trim();
                            if (t === "") {
                              setQuestionTimer({ ...questionTimer, seconds: 0 });
                              setTimerSecDraft("");
                              setTimerDurationCommitted(false);
                              return;
                            }
                            const n = Number.parseInt(t, 10);
                            if (!Number.isFinite(n)) {
                              setTimerSecDraft(
                                questionTimer.scope === "whole_test"
                                  ? String(
                                      questionTimer.seconds === 0
                                        ? 0
                                        : Math.round(questionTimer.seconds / 60),
                                    )
                                  : String(questionTimer.seconds),
                              );
                              return;
                            }
                            if (questionTimer.scope === "whole_test") {
                              const c = clampQuestionTimerSeconds(n * 60, "whole_test");
                              setQuestionTimer({ ...questionTimer, seconds: c });
                              setTimerSecDraft(String(c / 60));
                            } else {
                              const c = clampQuestionTimerSeconds(n, "per_question");
                              setQuestionTimer({ ...questionTimer, seconds: c });
                              setTimerSecDraft(String(c));
                            }
                            setTimerDurationCommitted(false);
                          }}
                        />
                        <span className="my-bank-qtimer__num-suffix" aria-hidden>
                          {questionTimer.scope === "whole_test" ? "min" : "sec"}
                        </span>
                        <span className="my-bank-qtimer__num-hint">
                          Allowed:{" "}
                          {questionTimer.scope === "whole_test"
                            ? `1–${QUESTION_TIMER_MAX_MIN_WHOLE_TEST} min`
                            : `1–${QUESTION_TIMER_MAX_SEC} sec`}
                        </span>
                      </div>
                      <p className="my-bank-qtimer__presets-label">Quick picks</p>
                      <div
                        className={
                          "my-bank-qtimer__presets" +
                          (questionTimer.scope === "whole_test" ? " my-bank-qtimer__presets--fulltest" : "")
                        }
                        role="group"
                        aria-label={
                          questionTimer.scope === "whole_test"
                            ? "Quick durations in minutes"
                            : "Quick durations in seconds"
                        }
                      >
                        {questionTimer.scope === "whole_test"
                          ? TIMER_PRESET_MIN_WHOLE_TEST.map((min) => {
                              const sec = min * 60;
                              return (
                                <button
                                  key={min}
                                  type="button"
                                  className={
                                    questionTimer.seconds === sec
                                      ? "my-bank-qtimer__preset my-bank-qtimer__preset--active"
                                      : "my-bank-qtimer__preset"
                                  }
                                  disabled={busy || savingBankMeta}
                                  onClick={() => {
                                    setTimerDurationCommitted(false);
                                    setQuestionTimer({ ...questionTimer, seconds: sec });
                                    setTimerSecDraft(String(min));
                                  }}
                                >
                                  {min} min
                                </button>
                              );
                            })
                          : TIMER_PRESET_SEC_PER_QUESTION.map((n) => (
                              <button
                                key={n}
                                type="button"
                                className={
                                  questionTimer.seconds === n
                                    ? "my-bank-qtimer__preset my-bank-qtimer__preset--active"
                                    : "my-bank-qtimer__preset"
                                }
                                disabled={busy || savingBankMeta}
                                onClick={() => {
                                  setTimerDurationCommitted(false);
                                  setQuestionTimer({ ...questionTimer, seconds: n });
                                  setTimerSecDraft(String(n));
                                }}
                              >
                                {n}s
                              </button>
                            ))}
                      </div>
                    </fieldset>
                    {questionTimer.scope === "per_question" ? (
                      <div className="my-bank-qtimer__panel my-bank-qtimer__panel--behavior">
                        <p className="my-bank-qtimer__panel-title">Per-question behavior</p>
                        <div className="my-bank-qtimer__grid">
                          <div className="my-bank-qtimer__block">
                            <p className="my-bank-qtimer__label" id="my-bank-qtimer-dir-label">
                              Direction
                            </p>
                            <div
                              className="my-bank-qtimer__toggle"
                              role="group"
                              aria-labelledby="my-bank-qtimer-dir-label"
                            >
                              <button
                                type="button"
                                className={
                                  questionTimer.display === "countdown"
                                    ? "my-bank-qtimer__opt my-bank-qtimer__opt--on"
                                    : "my-bank-qtimer__opt"
                                }
                                disabled={busy || savingBankMeta}
                                onClick={() => {
                                  setTimerDurationCommitted(false);
                                  setQuestionTimer({ ...questionTimer, display: "countdown" });
                                }}
                              >
                                Count down
                              </button>
                              <button
                                type="button"
                                className={
                                  questionTimer.display === "countup"
                                    ? "my-bank-qtimer__opt my-bank-qtimer__opt--on"
                                    : "my-bank-qtimer__opt"
                                }
                                disabled={busy || savingBankMeta}
                                onClick={() => {
                                  setTimerDurationCommitted(false);
                                  setQuestionTimer({ ...questionTimer, display: "countup" });
                                }}
                              >
                                Count up
                              </button>
                            </div>
                          </div>
                          <div className="my-bank-qtimer__block">
                            <p className="my-bank-qtimer__label" id="my-bank-qtimer-expire-label">
                              When time ends
                            </p>
                            <div
                              className="my-bank-qtimer__toggle"
                              role="group"
                              aria-labelledby="my-bank-qtimer-expire-label"
                            >
                              <button
                                type="button"
                                className={
                                  questionTimer.onExpire === "reveal"
                                    ? "my-bank-qtimer__opt my-bank-qtimer__opt--on"
                                    : "my-bank-qtimer__opt"
                                }
                                disabled={busy || savingBankMeta}
                                onClick={() => {
                                  setTimerDurationCommitted(false);
                                  setQuestionTimer({ ...questionTimer, onExpire: "reveal" });
                                }}
                              >
                                Reveal answer
                              </button>
                              <button
                                type="button"
                                className={
                                  questionTimer.onExpire === "reference"
                                    ? "my-bank-qtimer__opt my-bank-qtimer__opt--on"
                                    : "my-bank-qtimer__opt"
                                }
                                disabled={busy || savingBankMeta}
                                onClick={() => {
                                  setTimerDurationCommitted(false);
                                  setQuestionTimer({ ...questionTimer, onExpire: "reference" });
                                }}
                              >
                                Reference only
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="my-bank-qtimer__footer">
                      <div className="my-bank-qtimer__footer-row">
                        <div className="my-bank-qtimer__footer-row__lead">
                          {questionTimer && !timerDurationCommitted ? (
                            <button
                              type="button"
                              className="btn my-bank-qtimer__confirm-btn"
                              disabled={busy || savingBankMeta}
                              onClick={() => confirmTimerSetup()}
                            >
                              Confirm timer
                            </button>
                          ) : null}
                          {timerShowCancel ? (
                            <button
                              type="button"
                              className="btn secondary my-bank-qtimer__cancel-btn"
                              disabled={busy || savingBankMeta}
                              onClick={() => cancelTimerEdits()}
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost my-bank-qtimer__remove"
                          disabled={busy || savingBankMeta}
                          onClick={() => void removeQuestionTimerAndPersist()}
                        >
                          Remove timer
                        </button>
                      </div>
                      {questionTimer && !timerDurationCommitted ? (
                        <p className="my-bank-qtimer__confirm-hint">
                          <strong>Confirm</strong> checks your duration and saves the timer for this test.
                        </p>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            </section>
            <section
              className="card my-bank-general-danger-zone"
              aria-labelledby="my-bank-general-delete-heading"
            >
              <h2 className="my-bank-general-danger-zone__title" id="my-bank-general-delete-heading">
                Delete test
              </h2>
              <p className="muted my-bank-general-danger-zone__copy">
                Permanently remove this test and every question in it. This cannot be undone.
              </p>
              <button
                type="button"
                className="btn secondary my-bank-general-btn-delete my-bank-general-danger-zone__btn"
                disabled={busy || savingBankMeta}
                onClick={() => requestDeleteBank()}
              >
                Delete Test
              </button>
            </section>
          </div>
        ) : null}

        {editWorkspaceTab === "questions" ? (
          <>
            <div className="my-bank-pool-toolbar card">
              <div className="my-bank-pool-toolbar-row">
                <div className="my-bank-pool-toolbar-heading">
                  <h2 className="my-bank-pool-toolbar-title">Question pool</h2>
                  <span className="my-bank-pool-toolbar-count" aria-live="polite">
                    {questions.length} / {MAX_QUESTIONS}
                  </span>
                </div>
                <div className="my-bank-pool-toolbar-add" role="group" aria-label="Add questions">
                  <span className="my-bank-pool-toolbar-add-label muted">Add</span>
                  <button
                    type="button"
                    className={`btn btn-compact${addMode === "manual" ? "" : " secondary"}`}
                    onClick={() => setAddMode((prev) => (prev === "manual" ? "none" : "manual"))}
                  >
                    Manual
                  </button>
                  <button
                    type="button"
                    className={`btn btn-compact${addMode === "import" ? "" : " secondary"}`}
                    onClick={() => setAddMode((prev) => (prev === "import" ? "none" : "import"))}
                  >
                    <span className="docx-cta-icon" aria-hidden>W</span>
                    Upload
                  </button>
                </div>
              </div>
              {addMode === "none" ? (
                <p className="my-bank-pool-toolbar-hint muted">
                  Choose <strong>Manual</strong> or <strong>Upload</strong> to add questions.
                </p>
              ) : null}
            </div>

        {addMode === "import" ? (
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
                <label htmlFor="expected-choices-inline-edit" className="my-bank-import-custom-label">
                  Custom
                </label>
                <input
                  id="expected-choices-inline-edit"
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
                      disabled={busy || savingBankMeta || parsingDocx || importingDocx}
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
        {hintModalOpen ? (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="docx-hint-title-edit"
            onClick={() => setHintModalOpen(false)}
          >
            <div className="modal-panel modal-panel--guide card" onClick={(e) => e.stopPropagation()}>
              <h2 id="docx-hint-title-edit" className="modal-title">
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
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setHintModalOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {docxQuestions ? (
          <section className="card my-banks-import-review">
            <div className="my-banks-import-review-head">
              <h3 className="my-bank-add-title">Review imported questions</h3>
              <p className="muted my-bank-section-sub">
                {docxQuestions.length} detected from {importFileName ?? "uploaded file"}
              </p>
            </div>
            <p className="muted my-banks-import-review-note">
              Review page {previewPageSafe} of {previewTotalPages}. Adjust visuals and tables before importing.
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
                        <label className="muted" htmlFor={`edit-asset-start-${g.assetId}`}>
                          From #
                        </label>
                        <input
                          id={`edit-asset-start-${g.assetId}`}
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
                        <label className="muted" htmlFor={`edit-asset-end-${g.assetId}`}>
                          To #
                        </label>
                        <input
                          id={`edit-asset-end-${g.assetId}`}
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
                        <label className="muted" htmlFor={`edit-specific-${g.assetId}`}>
                          Question list
                        </label>
                        <input
                          id={`edit-specific-${g.assetId}`}
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
                            key={`edit-attach-chip-${g.assetId}-${i}`}
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
                disabled={importingDocx || busy || savingBankMeta || !mediaMapConfirmed}
                onClick={() => void importDocxIntoBank()}
              >
                {importingDocx ? "Importing…" : "Import into this test"}
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

        {questions.length >= MAX_QUESTIONS ? (
          <p className="muted">This test has reached the maximum number of questions.</p>
        ) : addMode === "manual" ? (
          <div className="my-bank-add my-bank-add--manual my-bank-manual--compact card">
            <h3 className="my-bank-add-title">Add question</h3>
            <div className="field">
              <label htmlFor="new-stem">Question</label>
              <textarea
                id="new-stem"
                className="input my-bank-textarea"
                rows={2}
                value={newQ.stem}
                onChange={(e) => setNewQ((d) => ({ ...d, stem: e.target.value }))}
                placeholder="Enter the question stem…"
              />
            </div>
            <div className="my-bank-manual-attach my-bank-manual-attach--after-stem">
              <p className="my-bank-manual-attach-label">Saved visual or table (optional)</p>
              {visualPickerGroups.length === 0 ? (
                <p className="muted my-bank-manual-attach-empty">
                  None yet. Add reference images or tables via Word import or when editing a question, or move one to
                  the library from the <strong>Visuals</strong> tab by detaching it from every question.
                </p>
              ) : (
                <>
                  <ul
                    className="my-bank-manual-saved-strip"
                    aria-label="Attach a saved visual or table from this test"
                  >
                    <li className="my-bank-manual-saved-strip-item">
                      <button
                        type="button"
                        className={`my-bank-manual-saved-pick${newQ.linkedAssets.length === 0 ? " my-bank-manual-saved-pick--on" : ""}`}
                        onClick={() => setNewQ((d) => ({ ...d, linkedAssets: [] }))}
                      >
                        <span className="my-bank-manual-saved-none-label">None</span>
                      </button>
                    </li>
                    {visualPickerGroups.map((g) => {
                      const pickKey =
                        newQ.linkedAssets.length > 0 ? storedAssetContentKey(newQ.linkedAssets[0]!) : null;
                      const on = pickKey === g.key;
                      const usedOn = g.usage.map((u) => u.displayNumber).join(", ");
                      const attachDescribe =
                        g.usage.length > 0
                          ? g.asset.kind === "image"
                            ? `Attach image also used on question${g.usage.length === 1 ? "" : "s"} ${usedOn}`
                            : `Attach table also used on question${g.usage.length === 1 ? "" : "s"} ${usedOn}`
                          : g.asset.kind === "image"
                            ? "Attach image from library (not on any question yet)"
                            : "Attach table from library (not on any question yet)";
                      return (
                        <li key={g.key} className="my-bank-manual-saved-strip-item">
                          <button
                            type="button"
                            className={`my-bank-manual-saved-pick${on ? " my-bank-manual-saved-pick--on" : ""}`}
                            aria-pressed={on}
                            aria-label={attachDescribe}
                            onClick={() => setNewQ((d) => ({ ...d, linkedAssets: [g.asset] }))}
                          >
                            {g.asset.kind === "image" ? (
                              <img
                                src={g.asset.url}
                                alt=""
                                className="my-bank-manual-saved-thumb"
                                loading="lazy"
                              />
                            ) : (
                              <div
                                className="my-bank-manual-saved-table-tile"
                                dangerouslySetInnerHTML={{ __html: g.asset.html }}
                              />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
            <p className="muted my-bank-manual-hint">
              Optional visual reuses a file already on this test. Tap a letter for the correct answer; keep at least two
              non-empty options.
            </p>
            <div className="my-bank-manual-choices" role="list">
              {newQ.choices.map((choice, i) => {
                const letter = String.fromCharCode(65 + i);
                const isCorrect = newQ.correct === i;
                return (
                  <div
                    key={`new-choice-${i}`}
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
                      onClick={() => setNewQ((d) => ({ ...d, correct: i }))}
                    >
                      {letter}
                    </button>
                    <input
                      id={`new-choice-${i}`}
                      className="input my-bank-manual-choice-input"
                      value={choice}
                      onChange={(e) => setDraftChoice(setNewQ, i, e.target.value)}
                      placeholder={`Option ${letter}`}
                      aria-label={`Choice ${letter} text`}
                    />
                    {newQ.choices.length > 2 ? (
                      <button
                        type="button"
                        className="my-bank-manual-remove"
                        aria-label={`Remove choice ${letter}`}
                        onClick={() => removeDraftChoice(setNewQ, i)}
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
                  onClick={() => addDraftChoice(setNewQ)}
                >
                  + Add option
                </button>
                <span className="muted my-bank-manual-count">
                  {newQ.choices.length} / {MAX_CHOICES_PER_QUESTION} options
                </span>
              </div>
              <button
                type="button"
                className="btn"
                disabled={busy || !draftValid(newQ)}
                onClick={() => void addQuestion()}
              >
                Add question
              </button>
            </div>
          </div>
        ) : null}

        <div className="my-bank-q-browse-row">
          <div className="field my-bank-search-field my-bank-search-field--browse">
            <label htmlFor="question-search">Search questions</label>
            <input
              id="question-search"
              className="input"
              value={questionSearch}
              onChange={(e) => setQuestionSearch(e.target.value)}
              placeholder="Search by text, choice, or question number (e.g. #12)"
            />
          </div>
          {questions.length > 0 ? (
            <div className="my-bank-bulk-actions my-bank-bulk-actions--by-list">
              <label className="my-bank-select-all muted">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedQuestionIds((prev) =>
                        Array.from(new Set([...prev, ...visibleQuestionIds])),
                      );
                      return;
                    }
                    setSelectedQuestionIds((prev) => prev.filter((id) => !visibleQuestionIds.includes(id)));
                  }}
                />
                Select all shown
              </label>
              <button
                type="button"
                className="btn secondary btn-compact my-bank-delete-selected-btn"
                disabled={busy || selectedQuestionIds.length === 0}
                onClick={() => requestDeleteSelectedQuestions()}
              >
                Delete selected ({selectedQuestionIds.length})
              </button>
            </div>
          ) : null}
        </div>
        {questionSearch.trim() ? (
          <p className="muted my-bank-search-meta">
            Showing {filteredQuestions.length} matching question
            {filteredQuestions.length === 1 ? "" : "s"}.
          </p>
        ) : null}

        <ul className="my-bank-q-list">
          {filteredQuestions.map((q) =>
            editingId === q.id ? (
              <li
                key={q.id}
                ref={questionEditorRef}
                className="my-bank-q-editor my-bank-manual--compact card"
              >
                <p className="my-bank-q-number">Question {q.displayNumber}</p>
                <div className="field">
                  <label htmlFor={`stem-${q.id}`}>Question</label>
                  <textarea
                    id={`stem-${q.id}`}
                    className="input my-bank-textarea"
                    rows={2}
                    value={editDraft.stem}
                    onChange={(e) => setEditDraft((d) => ({ ...d, stem: e.target.value }))}
                  />
                </div>
                <div className="my-bank-manual-attach my-bank-manual-attach--editor">
                  <p className="my-bank-manual-attach-label">Linked visuals &amp; tables</p>
                  {editDraft.linkedAssets.length === 0 ? (
                    <p className="muted my-bank-manual-attach-empty">None on this question yet.</p>
                  ) : (
                    <ul className="my-bank-edit-linked-list" aria-label="Media attached to this question">
                      {editDraft.linkedAssets.map((asset, ai) => (
                        <li
                          key={`${q.id}-edit-asset-${storedAssetContentKey(asset)}-${ai}`}
                          className="my-bank-edit-linked-item"
                        >
                          {asset.kind === "image" ? (
                            <img
                              src={asset.url}
                              alt="Attached reference visual"
                              className="my-bank-edit-linked-thumb"
                              loading="lazy"
                            />
                          ) : (
                            <div
                              className="my-bank-edit-linked-table"
                              dangerouslySetInnerHTML={{ __html: asset.html }}
                            />
                          )}
                          <button
                            type="button"
                            className="my-bank-edit-linked-remove"
                            aria-label={`Remove ${asset.kind === "image" ? "image" : "table"} ${ai + 1}`}
                            onClick={() =>
                              setEditDraft((d) => ({
                                ...d,
                                linkedAssets: d.linkedAssets.filter((_, i) => i !== ai),
                              }))
                            }
                          >
                            <span aria-hidden>×</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {visualPickerGroups.length > 0 ? (
                    <>
                      <p className="my-bank-manual-attach-label my-bank-manual-attach-label--sub">
                        Reuse from this test
                      </p>
                      <ul
                        className="my-bank-manual-saved-strip"
                        aria-label="Add another saved visual or table from this test"
                      >
                        {visualPickerGroups.map((g) => {
                          const already = editDraft.linkedAssets.some(
                            (a) => storedAssetContentKey(a) === g.key,
                          );
                          const usedOn = g.usage.map((u) => u.displayNumber).join(", ");
                          const usagePhrase =
                            g.usage.length > 0
                              ? `also used on question${g.usage.length === 1 ? "" : "s"} ${usedOn}`
                              : "from library (not on any question)";
                          const addLabel = already
                            ? `Already attached — ${usagePhrase}`
                            : g.asset.kind === "image"
                              ? `Add image ${usagePhrase}`
                              : `Add table ${usagePhrase}`;
                          return (
                            <li key={g.key} className="my-bank-manual-saved-strip-item">
                              <button
                                type="button"
                                className={`my-bank-manual-saved-pick${already ? " my-bank-manual-saved-pick--added" : ""}`}
                                disabled={already}
                                aria-label={addLabel}
                                onClick={() =>
                                  setEditDraft((d) => ({
                                    ...d,
                                    linkedAssets: [...d.linkedAssets, g.asset],
                                  }))
                                }
                              >
                                {g.asset.kind === "image" ? (
                                  <img
                                    src={g.asset.url}
                                    alt=""
                                    className="my-bank-manual-saved-thumb"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div
                                    className="my-bank-manual-saved-table-tile"
                                    dangerouslySetInnerHTML={{ __html: g.asset.html }}
                                  />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <p className="muted my-bank-manual-attach-empty">
                      No reusable visuals yet—import, attach on another question, or free one into the library from the
                      Visuals tab.
                    </p>
                  )}
                </div>
                <p className="muted my-bank-manual-hint my-bank-manual-hint--tight">
                  Attachments save with the question. Tap a letter for the correct answer; × removes an option (keep at
                  least two).
                </p>
                <div className="my-bank-manual-choices" role="list">
                  {editDraft.choices.map((choice, i) => {
                    const letter = String.fromCharCode(65 + i);
                    const isCorrect = editDraft.correct === i;
                    return (
                      <div
                        key={`${q.id}-choice-${i}`}
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
                          onClick={() => setEditDraft((d) => ({ ...d, correct: i }))}
                        >
                          {letter}
                        </button>
                        <input
                          id={`${q.id}-choice-${i}`}
                          className="input my-bank-manual-choice-input"
                          value={choice}
                          onChange={(e) => setDraftChoice(setEditDraft, i, e.target.value)}
                          placeholder={`Option ${letter}`}
                          aria-label={`Choice ${letter} text`}
                        />
                        {editDraft.choices.length > 2 ? (
                          <button
                            type="button"
                            className="my-bank-manual-remove"
                            aria-label={`Remove choice ${letter}`}
                            onClick={() => removeDraftChoice(setEditDraft, i)}
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
                <div className="my-bank-manual-footer my-bank-manual-footer--solo">
                  <div className="my-bank-manual-footer-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={editDraft.choices.length >= MAX_CHOICES_PER_QUESTION}
                      onClick={() => addDraftChoice(setEditDraft)}
                    >
                      + Add option
                    </button>
                    <span className="muted my-bank-manual-count">
                      {editDraft.choices.length} / {MAX_CHOICES_PER_QUESTION} options
                    </span>
                  </div>
                </div>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || savingQuestion || !draftValid(editDraft)}
                    onClick={() => void saveEdit()}
                  >
                    {savingQuestion ? "Saving…" : "Save question"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy || savingQuestion}
                    onClick={() => {
                      const id = q.id;
                      setEditingId(null);
                      requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                          scrollBankQuestionRowIntoView(id);
                        });
                      });
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </li>
            ) : (
              <li
                key={q.id}
                id={`bank-q-${q.id}`}
                className={`my-bank-q-row card${isQuestionSelected(q.id) ? " my-bank-q-row--selected" : ""}`}
                role="checkbox"
                aria-checked={isQuestionSelected(q.id)}
                tabIndex={0}
                onClick={() => toggleQuestionSelected(q.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleQuestionSelected(q.id);
                  }
                }}
              >
                <div className="my-bank-q-select-rail" onClick={(e) => e.stopPropagation()}>
                  <input
                    id={`select-q-${q.id}`}
                    type="checkbox"
                    className="my-bank-q-select-input"
                    checked={isQuestionSelected(q.id)}
                    aria-label={`Select question ${q.displayNumber} for bulk actions`}
                    onChange={(e) => {
                      e.stopPropagation();
                      setSelectedQuestionIds((prev) => {
                        if (e.target.checked) return Array.from(new Set([...prev, q.id]));
                        return prev.filter((id) => id !== q.id);
                      });
                    }}
                  />
                </div>
                <div className="my-bank-q-preview">
                  <p className="my-bank-q-number">Question {q.displayNumber}</p>
                  <div
                    className={`my-bank-q-preview-main${
                      (q.assets && q.assets.length > 0) || q.media_url
                        ? " my-bank-q-preview-main--with-media"
                        : ""
                    }`}
                  >
                    {(q.assets && q.assets.length > 0) || q.media_url ? (
                      <div className="my-bank-q-media-wrap">
                        {q.assets && q.assets.length > 0 ? (
                          <div className="my-banks-import-multi-assets my-bank-q-media-stack">
                            {q.assets.map((a, ai) =>
                              a.kind === "image" ? (
                                <img
                                  key={`${q.id}-a-${ai}`}
                                  className="my-bank-q-media"
                                  src={a.url}
                                  alt={`Reference visual for question ${q.displayNumber}`}
                                  loading="lazy"
                                />
                              ) : (
                                <div
                                  key={`${q.id}-a-${ai}`}
                                  className="my-banks-import-table-preview"
                                  dangerouslySetInnerHTML={{ __html: a.html }}
                                />
                              ),
                            )}
                          </div>
                        ) : q.media_url ? (
                          <img
                            className="my-bank-q-media"
                            src={q.media_url}
                            alt={`Reference visual for question ${q.displayNumber}`}
                            loading="lazy"
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <div className="my-bank-q-text-wrap">
                      <p className="my-bank-q-stem">{q.stem}</p>
                      <p className="muted my-bank-q-sub">
                        Correct: {String.fromCharCode(65 + q.correct_index)} · {q.choices.length}{" "}
                        choices
                      </p>
                    </div>
                  </div>
                </div>
                <div className="my-bank-q-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={busy}
                    onClick={() => beginEdit(q)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn secondary btn-compact"
                    disabled={busy}
                    onClick={() => requestDeleteQuestion(q.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
        {filteredQuestions.length === 0 && questions.length > 0 ? (
          <p className="muted">No questions match your search.</p>
        ) : null}
          </>
        ) : null}

        {editWorkspaceTab === "visuals" ? (
          <div className="my-bank-saved-visuals">
            <div className="my-bank-section-head">
              <div>
                <h2 id="my-bank-visuals-heading" className="my-bank-section-title">
                  Visual library
                </h2>
                <p className="muted my-bank-section-sub">
                  Every diagram and table for this test lives here — upload, browse, and reuse. Open a card for linked
                  questions and detach actions; items not linked can be removed from the card or reattached from{" "}
                  <strong>Questions</strong>.
                </p>
              </div>
            </div>
            <div
              id="visuals-panel-library"
              role="region"
              aria-labelledby="my-bank-visuals-heading"
              className="my-bank-visuals-panel my-bank-visuals-panel--library"
            >
                <div className="my-bank-library-upload-row">
                  <input
                    ref={libraryMediaUploadRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    aria-label="Upload images to the library"
                    onChange={(e) => void handleLibraryImageUpload(e.target.files)}
                  />
                  <button
                    type="button"
                    className="btn secondary btn-compact"
                    disabled={busy || uploadingLibraryMedia}
                    onClick={() => libraryMediaUploadRef.current?.click()}
                  >
                    {uploadingLibraryMedia ? "Uploading…" : "Upload images"}
                  </button>
                  <span className="muted my-bank-library-upload-hint">
                    PNG, JPG, WebP or GIF · up to 5 MB each · same storage style as Word import
                  </span>
                </div>
                {allBankVisualGroups.length === 0 ? (
                  <p className="muted my-bank-visuals-panel-empty">
                    No visuals yet. Upload images above, use Word import, or attach media when editing a question.
                  </p>
                ) : (
                  <ul className="my-bank-library-studio__grid" aria-label="Visual library for this test">
                    {allBankVisualGroups.map((g) => {
                      const onQuestions = g.usage.length > 0;
                      return (
                        <li
                          key={g.key}
                          className={`my-banks-import-asset-group my-bank-saved-visual-card my-bank-library-studio__tile${onQuestions ? " my-bank-library-studio__tile--linked" : " my-bank-library-studio__tile--orphan"}`}
                        >
                          <div
                            className="my-bank-saved-visual-card__layout my-bank-saved-visual-card__layout--studio my-bank-saved-visual-card--clickable"
                            tabIndex={0}
                            aria-label={`Open ${g.asset.kind === "image" ? "visual" : "table"}${onQuestions ? `, on ${g.usage.length} question${g.usage.length === 1 ? "" : "s"}` : ", not linked"}`}
                            onClick={() => setSavedVisualModal(g)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" && e.key !== " ") return;
                              e.preventDefault();
                              setSavedVisualModal(g);
                            }}
                          >
                            {g.asset.kind === "image" ? (
                              <div className="my-bank-saved-visual-card__preview">
                                <img
                                  src={g.asset.url}
                                  className="my-bank-saved-visual-card__thumb"
                                  alt=""
                                  loading="lazy"
                                />
                              </div>
                            ) : (
                              <div className="my-bank-saved-visual-card__preview my-bank-saved-visual-card__preview--table">
                                <div
                                  className="my-banks-import-table-preview my-bank-saved-visual-card__table-peek"
                                  dangerouslySetInnerHTML={{ __html: g.asset.html }}
                                />
                              </div>
                            )}
                            <div className="my-bank-saved-visual-card__body">
                              <div className="my-bank-saved-visual-card__head">
                                <span
                                  className={`my-bank-saved-visual-card__badge${g.asset.kind === "table" ? " my-bank-saved-visual-card__badge--table" : ""}`}
                                >
                                  {g.asset.kind === "image" ? "Visual" : "Table"}
                                </span>
                                <span
                                  className={`my-bank-library-studio__link-status${onQuestions ? " my-bank-library-studio__link-status--linked" : " my-bank-library-studio__link-status--orphan"}`}
                                >
                                  {onQuestions
                                    ? `On ${g.usage.length} Question${g.usage.length === 1 ? "" : "s"}`
                                    : "Not linked"}
                                </span>
                              </div>
                              {!onQuestions ? (
                                <>
                                  <p className="muted my-bank-saved-visual-library-hint">
                                    Reattach from <strong>Questions</strong> → Manual add or Edit (reuse strip). Remove
                                    from library discards this stored copy if you no longer need it.
                                  </p>
                                  <button
                                    type="button"
                                    className="btn secondary btn-compact my-bank-saved-visual-library-remove"
                                    disabled={busy}
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      requestRemoveLibraryVisual(g.key);
                                    }}
                                  >
                                    Remove from library
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </div>
          </div>
        ) : null}
        </div>
      </section>

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
      {savedVisualModal ? (
        <div
          className="modal-backdrop modal-backdrop--saved-visual-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Visual preview"
          onClick={() => setSavedVisualModal(null)}
        >
          <div
            className="modal-panel card my-bank-saved-visual-lightbox"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="my-bank-saved-visual-lightbox__top">
              <span className="my-bank-saved-visual-lightbox__label">
                {savedVisualModal.asset.kind === "image" ? "Visual" : "Table"}
              </span>
              <button
                type="button"
                className="btn secondary btn-compact my-bank-saved-visual-lightbox__done"
                onClick={() => setSavedVisualModal(null)}
              >
                Done
              </button>
            </div>
            <div className="my-bank-saved-visual-lightbox__scroll">
              {savedVisualModal.asset.kind === "image" ? (
                <img
                  src={savedVisualModal.asset.url}
                  className="my-bank-saved-visual-lightbox__img"
                  alt=""
                />
              ) : (
                <div
                  className="my-banks-import-table-preview my-bank-saved-visual-lightbox__table"
                  dangerouslySetInnerHTML={{ __html: savedVisualModal.asset.html }}
                />
              )}
              <div className="my-bank-saved-visual-modal-meta my-bank-saved-visual-lightbox__meta">
                {savedVisualModal.usage.length > 0 ? (
                  <>
                    <p className="my-bank-saved-visual-modal-meta-title">Linked questions</p>
                    <ul className="my-bank-saved-visual-usage-list my-bank-saved-visual-modal-usage-list">
                      {savedVisualModal.usage.map((u) => (
                        <li
                          key={`${savedVisualModal.key}-${u.questionId}-${u.assetIndex}`}
                          className="my-bank-saved-visual-usage-row"
                        >
                          <span className="my-bank-saved-visual-usage-q">Q{u.displayNumber}</span>
                          <div className="my-bank-saved-visual-usage-actions">
                            <button
                              type="button"
                              className="my-bank-saved-visual-usage-btn"
                              disabled={busy}
                              aria-label={`Find question ${u.displayNumber} on Questions tab`}
                              onClick={() => {
                                setSavedVisualModal(null);
                                setWorkspaceTab("questions");
                                setQuestionSearch(`#${u.displayNumber}`);
                              }}
                            >
                              Find
                            </button>
                            <button
                              type="button"
                              className="my-bank-saved-visual-usage-btn my-bank-saved-visual-usage-btn--danger"
                              disabled={busy}
                              aria-label={`Remove this ${savedVisualModal.asset.kind} from question ${u.displayNumber}`}
                              onClick={() => void removeSavedAssetFromQuestion(u.questionId, u.assetIndex)}
                            >
                              Detach
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    <p className="muted my-bank-saved-visual-library-hint">
                      Not on any question yet. Reattach from <strong>Questions</strong> → Manual add or Edit (reuse
                      strip), or remove from the library if you don’t need this copy.
                    </p>
                    <button
                      type="button"
                      className="btn secondary btn-compact my-bank-saved-visual-library-remove"
                      disabled={busy}
                      onClick={() => {
                        requestRemoveLibraryVisual(savedVisualModal.key);
                      }}
                    >
                      Remove from library
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="my-bank-saved-visual-lightbox__hint muted">
              Click outside the card or press Esc to close
            </p>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={blocker.state === "blocked"}
        titleId="my-bank-leave-unsaved-title"
        title="Leave without saving?"
        description={
          unsavedLeaveWarningItems.length > 0 ? (
            <>
              <p className="my-bank-leave-unsaved-lead">You still have unsaved work:</p>
              <ul className="my-bank-leave-unsaved-list">
                {unsavedLeaveWarningItems.map((item) => (
                  <li key={item.key} className="my-bank-leave-unsaved-item">
                    <span className="my-bank-leave-unsaved-item__text">{item.text}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact my-bank-leave-unsaved-go"
                      onClick={() => goToUnsavedLeaveIssue(item.fixTarget)}
                    >
                      {item.fixTarget === "title" ? "Open test name" : "Open session timer"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>You have unsaved changes. Leave anyway?</p>
          )
        }
        cancelLabel="Stay"
        confirmLabel="Leave without saving"
        confirmVariant="primary"
        onCancel={() => {
          if (blocker.state === "blocked") blocker.reset();
        }}
        onConfirm={() => {
          if (blocker.state === "blocked") {
            setTimeout(() => blocker.proceed(), 0);
          }
        }}
      />

      <ConfirmModal
        open={pendingConfirm.type === "delete-bank"}
        titleId="my-bank-delete-test-title"
        title="Delete this entire test?"
        description={
          <>
            This removes the test and <span className="text-emphasis">all of its questions</span> from your account.
            This cannot be undone.
          </>
        }
        confirmLabel="Delete test"
        confirmVariant="danger"
        onCancel={() => setPendingConfirm({ type: "idle" })}
        onConfirm={() => void runDeleteBank()}
      />

      <ConfirmModal
        open={pendingConfirm.type === "delete-question"}
        titleId="my-bank-delete-question-title"
        title="Delete this question?"
        description="This removes the question from your test. You can’t undo this action."
        confirmLabel="Delete question"
        confirmVariant="danger"
        onCancel={() => setPendingConfirm({ type: "idle" })}
        onConfirm={() =>
          pendingConfirm.type === "delete-question" ? void runDeleteQuestion(pendingConfirm.id) : undefined
        }
      />

      <ConfirmModal
        open={pendingConfirm.type === "delete-bulk"}
        titleId="my-bank-delete-bulk-title"
        title={
          pendingConfirm.type === "delete-bulk"
            ? `Delete ${pendingConfirm.count} question${pendingConfirm.count === 1 ? "" : "s"}?`
            : "Delete questions?"
        }
        description="The selected questions will be removed from this test. You can’t undo this action."
        confirmLabel="Delete selected"
        confirmVariant="danger"
        onCancel={() => setPendingConfirm({ type: "idle" })}
        onConfirm={() => void runDeleteSelectedQuestions()}
      />

      <ConfirmModal
        open={pendingConfirm.type === "remove-library-visual"}
        titleId="my-bank-remove-library-visual-title"
        title="Remove from library?"
        description="This visual will be removed from your library. You won’t be able to reuse it unless you import or upload it again."
        confirmLabel="Remove from library"
        confirmVariant="danger"
        onCancel={() => setPendingConfirm({ type: "idle" })}
        onConfirm={() =>
          pendingConfirm.type === "remove-library-visual"
            ? void runRemoveLibraryVisual(pendingConfirm.orphanKey)
            : undefined
        }
      />
    </main>
  );
}
