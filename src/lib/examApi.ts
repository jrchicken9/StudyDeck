import type { Exam, Question } from "../types";

function asQuestion(raw: unknown): Question | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.text !== "string") return null;
  if (!Array.isArray(o.choices) || o.choices.length !== 3) return null;
  const [a, b, c] = o.choices;
  if (typeof a !== "string" || typeof b !== "string" || typeof c !== "string")
    return null;
  const ci = o.correctIndex;
  const correctIndex =
    typeof ci === "number" && ci >= 0 && ci <= 2
      ? ci
      : ci === null
        ? null
        : null;
  return {
    id: o.id,
    text: o.text,
    choices: [a, b, c],
    correctIndex,
  };
}

export async function loadExam(examId: string): Promise<Exam> {
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
