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

  const progressPct = ((index + 1) / deck.length) * 100;

  return (
    <main className="page page-quiz">
      <div className="quiz-progress">
        <div className="progress-meta">
          <span>
            Question <strong>{index + 1}</strong> of {deck.length}
          </span>
          <span>{exam.title}</span>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>
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
        {!revealed && selected !== null ? (
          <p className="hint-line">
            Tap another option to change your mind, or confirm below.
          </p>
        ) : null}
        {revealed && selected !== null ? (
          <FeedbackLine
            scoringEnabled={scoringEnabled}
            correctIndex={q.correctIndex}
            selectedCanonical={choicePerm[selected]!}
            displayIndexOfCanonical={displayIndexOfCanonical}
          />
        ) : null}
        <div className="btn-row">
          {index > 0 ? (
            <button
              type="button"
              className="btn secondary"
              onClick={goToPreviousQuestion}
            >
              Previous question
            </button>
          ) : null}
          {!revealed ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={selected === null}
                onClick={confirmAnswer}
              >
                Confirm answer
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={selected === null}
                onClick={() => patchCurrent({ sel: null })}
              >
                Clear selection
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={recordAndAdvance}>
              {index + 1 >= deck.length ? "Finish" : "Next question"}
            </button>
          )}
          <button type="button" className="btn secondary" onClick={() => navigate("/dashboard")}>
            Exit
          </button>
        </div>
      </div>
    </main>
  );
}
