import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { loadExam } from "../lib/examApi";
import { pickCount, shuffle } from "../lib/shuffle";
import type { Exam, Question } from "../types";

export type Attempt = {
  questionId: string;
  /** Index into canonical `choices` array (0–2), after undoing display shuffle */
  selectedChoiceIndex: number | null;
};

type QuestionUi = {
  /** Display index 0–2 (matches shuffled choice buttons) */
  sel: number | null;
  rev: boolean;
};

const TIMER_CAP_SEC = 60;
const TIMER_BAR_HIDDEN_KEY = "studydeck_quiz_timer_bar_hidden";

function readTimerBarHidden(): boolean {
  try {
    return localStorage.getItem(TIMER_BAR_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function formatMmSs(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

type ProgressSegment = "pending" | "current" | "correct" | "incorrect" | "neutral";

function progressSegmentKind(
  i: number,
  deck: Question[],
  attempts: Attempt[],
  currentIndex: number,
  scoringEnabled: boolean,
  choicePerm: [number, number, number],
  currentSel: number | null,
  currentRevealed: boolean,
): ProgressSegment {
  const question = deck[i];
  if (!question) return "pending";

  const recorded = attempts[i]?.selectedChoiceIndex ?? null;

  if (recorded !== null) {
    if (!scoringEnabled || question.correctIndex === null) return "neutral";
    return recorded === question.correctIndex ? "correct" : "incorrect";
  }

  if (i === currentIndex) {
    if (
      currentRevealed &&
      currentSel !== null &&
      scoringEnabled &&
      question.correctIndex !== null
    ) {
      const canon = choicePerm[currentSel]!;
      return canon === question.correctIndex ? "correct" : "incorrect";
    }
    return "current";
  }

  return "pending";
}

function FeedbackLine({
  scoringEnabled,
  correctIndex,
  selectedCanonical,
  displayIndexOfCanonical,
}: {
  scoringEnabled: boolean;
  correctIndex: number | null;
  selectedCanonical: number;
  displayIndexOfCanonical: number | null;
}) {
  if (!scoringEnabled || correctIndex === null) {
    return (
      <p className="feedback neutral">
        Answer recorded. No answer key is available for this question in the
        data file, so correctness cannot be shown.
      </p>
    );
  }
  const ok = selectedCanonical === correctIndex;
  const letter =
    displayIndexOfCanonical !== null
      ? String.fromCharCode(65 + displayIndexOfCanonical)
      : "?";
  if (ok) {
    return <p className="feedback ok">Correct.</p>;
  }
  return (
    <p className="feedback bad">
      Incorrect. The correct answer is {letter}.
    </p>
  );
}

export default function QuizPage() {
  const { examId } = useParams<{ examId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const requested = useMemo(() => {
    const raw = searchParams.get("n");
    const n = raw ? Number.parseInt(raw, 10) : 20;
    return Number.isFinite(n) ? Math.max(1, n) : 20;
  }, [searchParams]);

  const [exam, setExam] = useState<Exam | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deck, setDeck] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  /** Per-question selection + revealed state so we can go back/forward in the deck */
  const [perQ, setPerQ] = useState<QuestionUi[]>([]);
  /** Cumulative seconds spent on each deck question (persists when using Previous) */
  const [secondsOnQuestion, setSecondsOnQuestion] = useState<number[]>([]);
  /** Hide pace bar only; time stays visible. Persisted in localStorage. */
  const [hideTimerBar, setHideTimerBar] = useState(readTimerBarHidden);
  const [exitModalOpen, setExitModalOpen] = useState(false);

  useEffect(() => {
    if (!exitModalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExitModalOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [exitModalOpen]);

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    (async () => {
      try {
        const ex = await loadExam(examId);
        if (cancelled) return;
        setExam(ex);
        const n = Math.min(requested, ex.questions.length);
        const picked = pickCount(ex.questions, n);
        setDeck(picked);
        setAttempts(
          picked.map((q) => ({ questionId: q.id, selectedChoiceIndex: null })),
        );
        setPerQ(picked.map(() => ({ sel: null, rev: false })));
        setSecondsOnQuestion(picked.map(() => 0));
        setIndex(0);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Load failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, requested]);

  const q = deck[index];
  const row = perQ[index] ?? { sel: null, rev: false };
  const selected = row.sel;
  const revealed = row.rev;

  useEffect(() => {
    if (!q || secondsOnQuestion.length === 0) return;
    const id = window.setInterval(() => {
      setSecondsOnQuestion((arr) => {
        if (index >= arr.length) return arr;
        const next = [...arr];
        next[index] = (next[index] ?? 0) + 1;
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [index, q?.id, secondsOnQuestion.length]);

  const scoringEnabled = useMemo(
    () => deck.length > 0 && deck.every((x) => x.correctIndex !== null),
    [deck],
  );

  const choicePerm = useMemo<[number, number, number]>(() => {
    const s = shuffle([0, 1, 2]);
    return [s[0]!, s[1]!, s[2]!];
  }, [q?.id]);

  const displayChoices = useMemo(() => {
    if (!q) return [];
    return choicePerm.map((orig) => q.choices[orig]);
  }, [q, choicePerm]);

  const displayIndexOfCanonical = useMemo(() => {
    if (!q || q.correctIndex === null) return null;
    const ci = q.correctIndex;
    const pos = choicePerm.findIndex((orig) => orig === ci);
    return pos >= 0 ? pos : null;
  }, [q, choicePerm]);

  const segmentKinds = useMemo(() => {
    if (!deck.length) return [];
    return deck.map((_, i) =>
      progressSegmentKind(
        i,
        deck,
        attempts,
        index,
        scoringEnabled,
        choicePerm,
        selected,
        revealed,
      ),
    );
  }, [deck, attempts, index, scoringEnabled, choicePerm, selected, revealed]);

  const recordAndAdvance = useCallback(() => {
    if (!q || !revealed || selected === null) return;
    const selectedChoiceIndex = choicePerm[selected]!;
    const nextAttempts = attempts.map((a) =>
      a.questionId === q.id ? { ...a, selectedChoiceIndex } : a,
    );
    setAttempts(nextAttempts);
    if (index + 1 >= deck.length) {
      navigate(`/results/${examId}`, {
        state: {
          attempts: nextAttempts,
          scoringEnabled,
          title: exam?.title,
        },
      });
      return;
    }
    setIndex((x) => x + 1);
  }, [
    attempts,
    deck.length,
    exam?.title,
    examId,
    index,
    navigate,
    q,
    choicePerm,
    revealed,
    scoringEnabled,
    selected,
  ]);

  function patchCurrent(patch: Partial<QuestionUi>) {
    setPerQ((pq) => pq.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function onPickChoice(displayIdx: number) {
    if (revealed) return;
    if (selected === displayIdx) {
      patchCurrent({ sel: null });
      return;
    }
    patchCurrent({ sel: displayIdx });
  }

  function confirmAnswer() {
    if (revealed || selected === null) return;
    patchCurrent({ rev: true });
  }

  function goToPreviousQuestion() {
    if (index <= 0) return;
    setIndex((i) => i - 1);
  }

  function openExitModal() {
    setExitModalOpen(true);
  }

  function confirmLeaveQuiz() {
    setExitModalOpen(false);
    navigate("/dashboard");
  }

  function toggleTimerBar() {
    setHideTimerBar((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TIMER_BAR_HIDDEN_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  if (loadError) {
    return (
      <main className="page page--centered">
        <p className="muted">{loadError}</p>
        <button type="button" className="btn secondary" onClick={() => navigate("/dashboard")}>
          Dashboard
        </button>
      </main>
    );
  }

  if (!exam || !q) {
    return (
      <main className="page page--centered">
        <div className="spinner" aria-hidden />
        <p className="muted">Loading session…</p>
      </main>
    );
  }

  const elapsedThisQuestion = secondsOnQuestion[index] ?? 0;
  const timerBarPct = Math.min((elapsedThisQuestion / TIMER_CAP_SEC) * 100, 100);

  return (
    <>
    <main className="page page-quiz">
      <div className="quiz-progress">
        <div className="progress-meta">
          <span>
            Question <strong>{index + 1}</strong> of {deck.length}
          </span>
          <span>{exam.title}</span>
        </div>
        <div
          className="progress-track progress-track--segments"
          role="list"
          aria-label="Per-question results: green correct, red incorrect, dim not yet answered."
        >
          {deck.map((qi, i) => {
            const kind = segmentKinds[i] ?? "pending";
            const labels: Record<ProgressSegment, string> = {
              pending: "Not yet answered",
              current: "Current question",
              correct: "Correct",
              incorrect: "Incorrect",
              neutral: "Answered (no score)",
            };
            return (
              <div
                key={qi.id}
                className={`progress-segment progress-segment--${kind}`}
                role="listitem"
                title={`Question ${i + 1}: ${labels[kind]}`}
              />
            );
          })}
        </div>
      </div>
      <div
        className="quiz-timer"
        aria-label={`Time on this question: ${formatMmSs(elapsedThisQuestion)}. One-minute pace guide; you can still answer after.`}
      >
        <div className="quiz-timer-row">
          <span className="quiz-timer-label">Time on this question</span>
          <div className="quiz-timer-right">
            <span className="quiz-timer-value" aria-live="polite">
              {formatMmSs(elapsedThisQuestion)}
            </span>
            <button
              type="button"
              className="quiz-timer-toggle"
              onClick={toggleTimerBar}
              aria-pressed={hideTimerBar ? "true" : "false"}
            >
              {hideTimerBar ? "Show bar" : "Hide bar"}
            </button>
          </div>
        </div>
        {!hideTimerBar ? (
          <div className="quiz-timer-track">
            <div
              className={
                elapsedThisQuestion >= TIMER_CAP_SEC
                  ? "quiz-timer-fill quiz-timer-fill--over"
                  : "quiz-timer-fill"
              }
              style={{ width: `${timerBarPct}%` }}
            />
          </div>
        ) : null}
      </div>
      <div className="card">
        <div className="qtext">{q.text}</div>
        {displayChoices.map((label, i) => {
          const isSel = selected === i;
          const orig = choicePerm[i]!;
          const correctIdx = q.correctIndex;
          let cls = "choice";
          if (isSel && !revealed) cls += " selected";
          if (revealed && scoringEnabled && correctIdx !== null) {
            if (orig === correctIdx) cls += " correct";
            else if (isSel) cls += " wrong";
            else cls += " dim";
          } else if (revealed && isSel) cls += " selected";
          return (
            <button
              key={`${q.id}-${choicePerm[i]}`}
              type="button"
              className={cls}
              disabled={revealed}
              onClick={() => onPickChoice(i)}
            >
              <span className="choice-letter">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="choice-body">{label}</span>
            </button>
          );
        })}
        {!revealed ? (
          <p className="hint-line">
            Tap an option to select it; tap again on your choice to deselect. Then
            confirm below.
          </p>
        ) : null}
        {revealed && selected !== null && scoringEnabled && q.correctIndex !== null ? (
          choicePerm[selected] === q.correctIndex ? (
            <p className="prank-banner prank-banner--ok" role="status" aria-live="polite">
              Goodjob Khan!
            </p>
          ) : (
            <p className="prank-banner prank-banner--bad" role="status" aria-live="polite">
              Dumb Ass Idiot Khan
            </p>
          )
        ) : null}
        {revealed && selected !== null ? (
          <FeedbackLine
            scoringEnabled={scoringEnabled}
            correctIndex={q.correctIndex}
            selectedCanonical={choicePerm[selected]!}
            displayIndexOfCanonical={displayIndexOfCanonical}
          />
        ) : null}
        <div className="btn-row btn-row--quiz">
          <div className="btn-row-primary">
            {!revealed ? (
              <button
                type="button"
                className="btn"
                disabled={selected === null}
                onClick={confirmAnswer}
              >
                Confirm answer
              </button>
            ) : (
              <button type="button" className="btn" onClick={recordAndAdvance}>
                {index + 1 >= deck.length ? "Finish" : "Next question"}
              </button>
            )}
          </div>
          <div className="btn-row-end">
            {index > 0 ? (
              <button
                type="button"
                className="btn secondary"
                onClick={goToPreviousQuestion}
              >
                Previous question
              </button>
            ) : null}
            <button type="button" className="btn secondary" onClick={openExitModal}>
              Exit
            </button>
          </div>
        </div>
      </div>
    </main>
    {exitModalOpen ? (
      <div
        className="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-quiz-title"
        onClick={() => setExitModalOpen(false)}
      >
        <div className="modal-panel card" onClick={(e) => e.stopPropagation()}>
          <p className="eyebrow">StudyDeck</p>
          <h2 id="exit-quiz-title" className="modal-title">
            Leave this quiz?
          </h2>
          <p className="lead lead--compact">
            You will return to the dashboard and{" "}
            <span className="text-emphasis">lose your progress</span> in this
            session.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => setExitModalOpen(false)}
            >
              Stay
            </button>
            <button type="button" className="btn" onClick={confirmLeaveQuiz}>
              Leave quiz
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
