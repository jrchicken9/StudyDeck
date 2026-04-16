export type QuestionAsset =
  | { kind: "image"; url: string }
  | { kind: "table"; html: string; plainText?: string };

export type Question = {
  id: string;
  text: string;
  choices: string[];
  correctIndex: number | null;
  /** @deprecated Prefer `assets`; kept for static exams and legacy rows */
  mediaUrl?: string | null;
  assets?: QuestionAsset[];
};

export type QuestionTimerDisplay = "countdown" | "countup";

/** reveal: auto-show answer when time hits the target; reference: timer is informational only */
export type QuestionTimerOnExpire = "reveal" | "reference";

/** per_question: limit resets each item; whole_test (Full Test in UI): one budget for the full run */
export type QuestionTimerScope = "per_question" | "whole_test";

export type QuestionTimerSettings = {
  seconds: number;
  display: QuestionTimerDisplay;
  onExpire: QuestionTimerOnExpire;
  scope: QuestionTimerScope;
};

export type Exam = {
  examId: string;
  title: string;
  version: number;
  sourceNote?: string;
  /** Custom tests: optional session timer (per question or full test); null/undefined = default pace strip only */
  questionTimer?: QuestionTimerSettings | null;
  questions: Question[];
};
