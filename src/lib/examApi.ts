import { questionTimerFromBankRow } from "./questionTimer";
import type { Exam, Question, QuestionAsset, QuestionTimerSettings } from "../types";
import { isUuid } from "./isUuid";
import { supabase } from "./supabaseClient";

function parseAssetsColumn(raw: unknown): QuestionAsset[] | undefined {
  if (!Array.isArray(raw)) return undefined;
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
  return out.length > 0 ? out : undefined;
}

function asQuestion(raw: unknown): Question | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.text !== "string") return null;
  if (!Array.isArray(o.choices) || o.choices.length < 2) return null;
  const choices = o.choices.filter((x): x is string => typeof x === "string");
  if (choices.length < 2) return null;
  const ci = o.correctIndex;
  const correctIndex =
    typeof ci === "number" && ci >= 0 && ci < choices.length
      ? ci
      : ci === null
        ? null
        : null;
  const mediaUrl = typeof o.mediaUrl === "string" ? o.mediaUrl : null;
  const assets = parseAssetsColumn(o.assets);
  return {
    id: o.id,
    text: o.text,
    choices,
    correctIndex,
    mediaUrl,
    assets,
  };
}

async function loadStaticExam(examId: string): Promise<Exam> {
  const path =
    import.meta.env.BASE_URL === "/"
      ? `/data/${examId}.json`
      : `${import.meta.env.BASE_URL}data/${examId}.json`;
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load exam (${res.status})`);
  const data = (await res.json()) as Record<string, unknown>;
  const rawQs = data.questions;
  if (!Array.isArray(rawQs)) throw new Error("Invalid exam file");
  const questions: Question[] = [];
  for (const rq of rawQs) {
    const q = asQuestion(rq);
    if (q) questions.push(q);
  }
  return {
    examId: String(data.examId ?? examId),
    title: String(data.title ?? examId),
    version: Number(data.version ?? 1),
    sourceNote:
      typeof data.sourceNote === "string" ? data.sourceNote : undefined,
    questions,
  };
}

function choicesFromJson(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const choices = raw.filter((x): x is string => typeof x === "string");
  return choices.length >= 2 ? choices : null;
}

async function loadUserBankExam(bankId: string): Promise<Exam> {
  if (!supabase) {
    throw new Error("Work Shop requires Supabase to be configured.");
  }
  const { data: bank, error: bankErr } = await supabase
    .from("user_question_banks")
    .select("id, title, question_timer_config, per_question_time_limit_sec")
    .eq("id", bankId)
    .maybeSingle();

  if (bankErr) throw new Error(bankErr.message);
  if (!bank || typeof bank.title !== "string") {
    throw new Error("Test not found or you do not have access.");
  }

  const questionTimer: QuestionTimerSettings | null = questionTimerFromBankRow(
    bank.question_timer_config,
    bank.per_question_time_limit_sec,
  );

  const { data: rows, error: qErr } = await supabase
    .from("user_questions")
    .select("id, stem, choices, correct_index, media_url, assets")
    .eq("bank_id", bankId)
    .order("position", { ascending: true });

  if (qErr) throw new Error(qErr.message);

  const questions: Question[] = [];
  for (const row of rows ?? []) {
    const id = typeof row.id === "string" ? row.id : null;
    const stem = typeof row.stem === "string" ? row.stem : null;
    const choices = choicesFromJson(row.choices);
    const ci = row.correct_index;
    const correctIndex =
      typeof ci === "number" && choices && ci >= 0 && ci < choices.length ? ci : null;
    if (!id || !stem || !choices || correctIndex === null) continue;
    const mediaUrl = typeof row.media_url === "string" ? row.media_url : null;
    let assets = parseAssetsColumn(row.assets);
    if (!assets?.length && mediaUrl) {
      assets = [{ kind: "image", url: mediaUrl }];
    }
    questions.push({
      id,
      text: stem,
      choices,
      correctIndex,
      mediaUrl,
      assets,
    });
  }

  return {
    examId: bankId,
    title: bank.title,
    version: 1,
    sourceNote: "Custom test — choices are shuffled during the quiz.",
    questionTimer,
    questions,
  };
}

/**
 * Load a built-in exam from `/public/data/{examId}.json`, or a user-owned bank when
 * `examId` is a UUID (same id used in `/quiz/:examId`).
 */
export async function loadExam(examId: string): Promise<Exam> {
  if (isUuid(examId)) {
    return loadUserBankExam(examId);
  }
  return loadStaticExam(examId);
}
