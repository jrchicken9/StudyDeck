import type { QuestionTimerScope, QuestionTimerSettings } from "../types";

/** Minimum seconds (countdown target / count-up cap). */
export const QUESTION_TIMER_MIN_SEC = 0;
export const QUESTION_TIMER_MAX_SEC = 600;
/** Full-test (whole_test scope) timers — up to four hours (typical proctored / bar-style sessions). */
export const QUESTION_TIMER_MAX_SEC_WHOLE_TEST = 14400;
/** Whole-minute upper bound for Full Test in the editor (matches max seconds). */
export const QUESTION_TIMER_MAX_MIN_WHOLE_TEST = QUESTION_TIMER_MAX_SEC_WHOLE_TEST / 60;

export function maxSecondsForTimerScope(scope: QuestionTimerScope): number {
  return scope === "whole_test" ? QUESTION_TIMER_MAX_SEC_WHOLE_TEST : QUESTION_TIMER_MAX_SEC;
}

export function clampQuestionTimerSeconds(n: number, scope: QuestionTimerScope = "per_question"): number {
  const max = maxSecondsForTimerScope(scope);
  return Math.min(max, Math.max(QUESTION_TIMER_MIN_SEC, Math.floor(n)));
}

function isDisplay(x: unknown): x is QuestionTimerSettings["display"] {
  return x === "countdown" || x === "countup";
}

function isOnExpire(x: unknown): x is QuestionTimerSettings["onExpire"] {
  return x === "reveal" || x === "reference";
}

function isScope(x: unknown): x is QuestionTimerScope {
  return x === "per_question" || x === "whole_test";
}

/** Normalize JSON from DB; invalid shapes return null. */
export function normalizeQuestionTimerSettings(raw: unknown): QuestionTimerSettings | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const secRaw = o.seconds;
  if (typeof secRaw !== "number" || !Number.isFinite(secRaw)) return null;
  const scope: QuestionTimerScope = isScope(o.scope) ? o.scope : "per_question";
  const seconds = clampQuestionTimerSeconds(secRaw, scope);
  if (!isDisplay(o.display)) return null;
  if (!isOnExpire(o.onExpire)) return null;
  if (scope === "whole_test") {
    return { seconds, display: "countdown", onExpire: "reveal", scope };
  }
  return { seconds, display: o.display, onExpire: o.onExpire, scope };
}

/** Prefer JSON config; fall back to legacy per_question_time_limit_sec. */
export function questionTimerFromBankRow(
  configJson: unknown,
  legacySec: unknown,
): QuestionTimerSettings | null {
  const parsed = normalizeQuestionTimerSettings(configJson);
  if (parsed) return parsed;
  if (typeof legacySec === "number" && Number.isFinite(legacySec)) {
    const n = Math.floor(legacySec);
    if (n >= QUESTION_TIMER_MIN_SEC && n <= QUESTION_TIMER_MAX_SEC) {
      return {
        seconds: n,
        display: "countdown",
        onExpire: "reveal",
        scope: "per_question",
      };
    }
  }
  return null;
}

export function questionTimersEqual(
  a: QuestionTimerSettings | null,
  b: QuestionTimerSettings | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.seconds === b.seconds &&
    a.display === b.display &&
    a.onExpire === b.onExpire &&
    a.scope === b.scope
  );
}

export function questionTimerToJson(settings: QuestionTimerSettings | null): Record<
  string,
  string | number
> | null {
  if (!settings) return null;
  const scope = settings.scope;
  const seconds = clampQuestionTimerSeconds(settings.seconds, scope);
  if (scope === "whole_test") {
    return { seconds, display: "countdown", onExpire: "reveal", scope };
  }
  return {
    seconds,
    display: settings.display,
    onExpire: settings.onExpire,
    scope,
  };
}

export function describeQuestionTimerRecipe(t: QuestionTimerSettings): string {
  if (t.scope === "whole_test") {
    const durLabel =
      t.seconds % 60 === 0 ? `${t.seconds / 60} min` : `${t.seconds}s`;
    return `Full Test — ${durLabel} countdown; session ends when time reaches zero.`;
  }
  const durLabel = `${t.seconds}s`;
  const timing =
    t.display === "countdown"
      ? `count down from ${durLabel} to 0`
      : `count up from 0 to ${durLabel}`;
  const end =
    t.onExpire === "reveal"
      ? "reveals answer at the bell"
      : "reference only — you stay in control";
  return `Each question — ${timing} · ${end}`;
}
