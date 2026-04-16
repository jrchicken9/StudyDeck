import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StudyDeckBrand } from "../components/StudyDeckLogo";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { loadExam } from "../lib/examApi";
import { isUuid } from "../lib/isUuid";
import { pickCount, shuffle } from "../lib/shuffle";
import type { Exam, Question, QuestionAsset } from "../types";

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

function quizDisplayAssets(q: Question): QuestionAsset[] {
  if (q.assets && q.assets.length > 0) return q.assets;
  if (q.mediaUrl) return [{ kind: "image", url: q.mediaUrl }];
  return [];
}

function alphaLabel(index: number): string {
  let n = index;
  let out = "";
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

function progressSegmentKind(
  i: number,
  deck: Question[],
  attempts: Attempt[],
  currentIndex: number,
  scoringEnabled: boolean,
  choicePerm: number[],
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
    if (currentRevealed && scoringEnabled && question.correctIndex !== null) {
      if (currentSel === null) return "incorrect";
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
      ? alphaLabel(displayIndexOfCanonical)
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
  /** Single clock for full-test timer scope (runs across all questions). */
  const [fullTestSeconds, setFullTestSeconds] = useState(0);
  /** Hide pace bar only; time stays visible. Persisted in localStorage. */
  const [hideTimerBar, setHideTimerBar] = useState(readTimerBarHidden);
  const [exitModalOpen, setExitModalOpen] = useState(false);

  const navigatedForFullTestEndRef = useRef(false);
  const quizSessionRef = useRef({
    attempts: [] as Attempt[],
    index: 0,
    selected: null as number | null,
    choicePerm: [] as number[],
    q: null as Question | null,
    deck: [] as Question[],
    scoringEnabled: false,
    secondsOnQuestion: [] as number[],
  });

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
        setFullTestSeconds(0);
        navigatedForFullTestEndRef.current = false;
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

  const examRef = useRef(exam);
  examRef.current = exam;

  useEffect(() => {
    if (!q || secondsOnQuestion.length === 0) return;
    /* Stop the clock after confirm so review time (and last-question feedback) is not counted */
    if (revealed) return;
    const id = window.setInterval(() => {
      setSecondsOnQuestion((arr) => {
        if (index >= arr.length) return arr;
        const el = arr[index] ?? 0;
        const timer = examRef.current?.questionTimer;
        if (timer?.scope === "whole_test") return arr;
        if (timer && timer.onExpire === "reference" && el >= timer.seconds) {
          return arr;
        }
        const next = [...arr];
        next[index] = el + 1;
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [index, q?.id, secondsOnQuestion.length, revealed]);

  useEffect(() => {
    if (!examId || !exam?.questionTimer || exam.questionTimer.scope !== "whole_test") return;
    const id = window.setInterval(() => {
      setFullTestSeconds((s) => {
        const timer = examRef.current?.questionTimer;
        if (!timer || timer.scope !== "whole_test") return s;
        if (s >= timer.seconds) return s;
        return s + 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [examId, exam?.questionTimer?.scope, exam?.questionTimer?.seconds, exam?.questionTimer?.onExpire]);

  const scoringEnabled = useMemo(
    () => deck.length > 0 && deck.every((x) => x.correctIndex !== null),
    [deck],
  );

  const choicePerm = useMemo<number[]>(() => {
    if (!q) return [];
    return shuffle(Array.from({ length: q.choices.length }, (_, i) => i));
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

  const displayAssets = useMemo(() => (q ? quizDisplayAssets(q) : []), [q]);

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
    if (!q || !revealed) return;
    const selectedChoiceIndex = selected === null ? null : choicePerm[selected]!;
    const nextAttempts = attempts.map((a) =>
      a.questionId === q.id ? { ...a, selectedChoiceIndex } : a,
    );
    setAttempts(nextAttempts);
    if (index + 1 >= deck.length) {
      const totalSecondsOnQuiz = secondsOnQuestion.reduce((a, b) => a + b, 0);
      navigate(`/results/${examId}`, {
        state: {
          attempts: nextAttempts,
          scoringEnabled,
          title: exam?.title,
          totalSecondsOnQuiz,
          sessionQuestionCount: deck.length,
        },
      });
      return;
    }
    setIndex((x) => x + 1);
  }, [
    attempts,
    deck,
    exam?.title,
    examId,
    index,
    navigate,
    q,
    choicePerm,
    revealed,
    scoringEnabled,
    secondsOnQuestion,
    selected,
  ]);

  const questionTimer = exam?.questionTimer ?? null;
  const elapsedThisQuestion = secondsOnQuestion[index] ?? 0;
  const isFullTestTimer = questionTimer?.scope === "whole_test";
  const elapsedForTimer = isFullTestTimer ? fullTestSeconds : elapsedThisQuestion;

  useEffect(() => {
    quizSessionRef.current = {
      attempts,
      index,
      selected,
      choicePerm,
      q: q ?? null,
      deck,
      scoringEnabled,
      secondsOnQuestion,
    };
  }, [attempts, index, selected, choicePerm, q, deck, scoringEnabled, secondsOnQuestion]);

  useEffect(() => {
    if (!questionTimer || questionTimer.scope !== "whole_test") return;
    if (!examId || !exam) return;
    if (questionTimer.seconds <= 0) return;
    if (fullTestSeconds < questionTimer.seconds) return;
    if (navigatedForFullTestEndRef.current) return;
    navigatedForFullTestEndRef.current = true;
    const snap = quizSessionRef.current;
    const {
      attempts: att,
      index: idx,
      selected: sel,
      choicePerm: perm,
      q: curQ,
      deck: d,
      scoringEnabled: se,
      secondsOnQuestion: soq,
    } = snap;
    if (!curQ || d.length === 0) {
      navigatedForFullTestEndRef.current = false;
      return;
    }
    const nextAttempts = att.map((a, i) => {
      if (i !== idx) return a;
      if (sel === null) return { ...a, selectedChoiceIndex: null };
      const canon = perm[sel];
      return { ...a, selectedChoiceIndex: typeof canon === "number" ? canon : null };
    });
    const totalSecondsOnQuiz = soq.reduce((a, b) => a + b, 0);
    navigate(`/results/${examId}`, {
      state: {
        attempts: nextAttempts,
        scoringEnabled: se,
        title: exam.title,
        totalSecondsOnQuiz,
        sessionQuestionCount: d.length,
      },
    });
  }, [fullTestSeconds, questionTimer, examId, exam, navigate]);

  useEffect(() => {
    if (!questionTimer || questionTimer.onExpire !== "reveal" || !q || revealed) return;
    if (questionTimer.scope === "whole_test") return;
    const elapsed = secondsOnQuestion[index] ?? 0;
    if (elapsed < questionTimer.seconds) return;
    setPerQ((pq) => pq.map((r, i) => (i === index ? { ...r, rev: true } : r)));
  }, [questionTimer, q?.id, index, revealed, secondsOnQuestion]);

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
    if (examId && isUuid(examId)) {
      navigate("/my-tests");
      return;
    }
    navigate("/my-tests");
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
        <button
          type="button"
          className="btn secondary"
          onClick={() => navigate("/my-tests")}
        >
          My Tests
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

  const timerCap =
    questionTimer && questionTimer.seconds > 0 ? questionTimer.seconds : TIMER_CAP_SEC;
  const timerProgress = Math.min(elapsedForTimer / timerCap, 1);
  const timerBarPct = timerProgress * 100;
  const referenceAtTarget =
    !isFullTestTimer &&
    questionTimer?.onExpire === "reference" &&
    elapsedForTimer >= questionTimer.seconds;
  const timerHue = referenceAtTarget
    ? 200
    : Math.round((1 - timerProgress) * 120);
  const timerFillStyle = referenceAtTarget
    ? {
        width: `${timerBarPct}%`,
        background: "linear-gradient(90deg, hsl(215 16% 42%), hsl(215 14% 36%))",
        boxShadow: "none",
      }
    : {
        width: `${timerBarPct}%`,
        background: `linear-gradient(90deg, hsl(${timerHue} 82% 48%), hsl(${Math.max(
          timerHue - 16,
          0,
        )} 84% 42%))`,
        boxShadow: `0 0 10px hsl(${timerHue} 82% 52% / 0.34)`,
      };
  const displayMainSeconds = questionTimer
    ? isFullTestTimer || questionTimer.display === "countdown"
      ? Math.max(0, questionTimer.seconds - elapsedForTimer)
      : elapsedForTimer
    : elapsedThisQuestion;
  const timerUiIsCountup =
    questionTimer !== null && !isFullTestTimer && questionTimer.display === "countup";
  const timerLabel = questionTimer
    ? isFullTestTimer
      ? "Time left (full test)"
      : questionTimer.display === "countdown"
        ? "Time remaining"
        : "Count up from 0"
    : "Time on this question";
  const timerAria = questionTimer
    ? isFullTestTimer
      ? `Full test countdown: ${questionTimer.seconds} seconds total. ${displayMainSeconds} seconds left. When the clock hits zero, this session ends and results open.`
      : questionTimer.display === "countdown"
        ? `Countdown: ${questionTimer.seconds} seconds per question. ${displayMainSeconds} seconds left. ${
            questionTimer.onExpire === "reveal"
              ? "Answer reveals when the timer hits zero."
              : "Timer is for reference only; you choose when to confirm."
          }`
        : `Count up from zero to ${questionTimer.seconds} seconds. ${displayMainSeconds} seconds elapsed so far. ${
            questionTimer.onExpire === "reveal"
              ? "Answer reveals when elapsed time reaches the target."
              : "Timer is for reference only; you choose when to confirm."
          }`
    : `Time on this question: ${formatMmSs(elapsedThisQuestion)}. One-minute pace guide; you can still answer after.`;

  return (
    <>
    <main className="page page-quiz">
      <div className="quiz-top-rail">
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
        <div className="quiz-timer" aria-label={timerAria}>
          <div className="quiz-timer-row">
            <span className="quiz-timer-label">
              {timerLabel}
              {referenceAtTarget ? (
                <span className="quiz-timer-target-badge" aria-hidden>
                  Target
                </span>
              ) : null}
            </span>
            <div className="quiz-timer-right">
              <span
                className={
                  timerUiIsCountup
                    ? "quiz-timer-value quiz-timer-value--countup"
                    : "quiz-timer-value"
                }
                aria-live="polite"
              >
                {timerUiIsCountup ? (
                  <>
                    <span>{formatMmSs(displayMainSeconds)}</span>
                    <span className="quiz-timer-value__sep" aria-hidden>
                      /
                    </span>
                    <span className="quiz-timer-value__cap">{formatMmSs(questionTimer.seconds)}</span>
                  </>
                ) : (
                  formatMmSs(displayMainSeconds)
                )}
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
                className="quiz-timer-fill"
                style={timerFillStyle}
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="card quiz-question-card">
        {displayAssets.length > 0 ? (
          <div className="quiz-question-assets">
            {displayAssets.map((a, ai) =>
              a.kind === "image" ? (
                <img
                  key={`${q.id}-asset-${ai}`}
                  className="quiz-question-media"
                  src={a.url}
                  alt={`Reference visual ${ai + 1} for question ${index + 1}`}
                  loading="lazy"
                />
              ) : (
                <div
                  key={`${q.id}-asset-${ai}`}
                  className="quiz-question-table-wrap"
                  dangerouslySetInnerHTML={{ __html: a.html }}
                />
              ),
            )}
          </div>
        ) : null}
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
            <div
              key={`${q.id}-${choicePerm[i]}`}
              className="choice-wrap"
            >
              <button
                type="button"
                className={cls}
                disabled={revealed}
                onClick={() => onPickChoice(i)}
              >
                <span className="choice-letter">
                {alphaLabel(i)}
                </span>
                <span className="choice-body">{label}</span>
              </button>
            </div>
          );
        })}
        {!revealed ? (
          <p className="hint-line">
            Tap an option to select it; tap again on your choice to deselect. Then
            confirm below.
            {questionTimer?.onExpire === "reference" && !isFullTestTimer ? (
              <>
                {" "}
                <span className="hint-line-timer-note">
                  The timer is for your reference — you can answer before or after it reaches the target.
                </span>
              </>
            ) : null}
          </p>
        ) : null}
        {revealed && selected !== null ? (
          <div className="quiz-feedback-card" role="status" aria-live="polite">
            <FeedbackLine
              scoringEnabled={scoringEnabled}
              correctIndex={q.correctIndex}
              selectedCanonical={choicePerm[selected]!}
              displayIndexOfCanonical={displayIndexOfCanonical}
            />
          </div>
        ) : null}
        {revealed && selected === null && questionTimer?.onExpire === "reveal" ? (
          <div className="quiz-feedback-card" role="status" aria-live="polite">
            <p className="feedback bad">Time&apos;s up — no answer was selected.</p>
          </div>
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
          <div className="quiz-modal-brand">
            <StudyDeckBrand
              layout="inline"
              logoClassName="auth-brand-logo"
              wordmarkClassName="eyebrow studydeck-wordmark studydeck-wordmark--compact"
            />
          </div>
          <h2 id="exit-quiz-title" className="modal-title">
            Leave this quiz?
          </h2>
          <p className="lead lead--compact">
            You will return to My Tests and{" "}
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
