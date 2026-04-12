import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { StudyDeckLogo } from "../components/StudyDeckLogo";
import { loadExam } from "../lib/examApi";
import type { Attempt } from "./QuizPage";

type LocationState = {
  attempts?: Attempt[];
  scoringEnabled?: boolean;
  title?: string;
  /** Sum of per-question timers from the quiz session */
  totalSecondsOnQuiz?: number;
  /** Deck size for this run — used to start a new quiz with the same count */
  sessionQuestionCount?: number;
};

function formatAvgSecondsPerQuestion(totalSec: number, questionCount: number): string {
  if (questionCount <= 0 || totalSec < 0) return "—";
  const avg = Math.round(totalSec / questionCount);
  if (avg <= 0) return "<1s";
  if (avg < 60) return `${avg}s`;
  const m = Math.floor(avg / 60);
  const s = avg % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function headlineForScore(pct: number | null, scoringEnabled: boolean): string {
  if (!scoringEnabled || pct === null) return "You're all done";
  if (pct >= 90) return "Outstanding";
  if (pct >= 75) return "Strong finish";
  if (pct >= 60) return "Nice work";
  if (pct >= 45) return "Good effort";
  return "Session complete";
}

export default function ResultsPage() {
  const { examId } = useParams<{ examId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [resolved, setResolved] = useState<{
    correct: number;
    total: number;
    answered: number;
  } | null>(null);

  const attempts = state.attempts ?? [];
  const scoringEnabled = Boolean(state.scoringEnabled);
  const totalSecondsOnQuiz = state.totalSecondsOnQuiz;
  const sessionQuestionCount = state.sessionQuestionCount;

  const practiceAgainTo = useMemo(() => {
    if (!examId) return "/dashboard";
    const n = sessionQuestionCount;
    if (typeof n === "number" && n > 0) {
      return `/quiz/${examId}?n=${encodeURIComponent(String(n))}`;
    }
    return `/exams/${examId}`;
  }, [examId, sessionQuestionCount]);

  useEffect(() => {
    if (!examId || !attempts.length) return;
    let cancelled = false;
    (async () => {
      try {
        const ex = await loadExam(examId);
        const byId = new Map(ex.questions.map((q) => [q.id, q]));
        let correct = 0;
        let answered = 0;
        for (const a of attempts) {
          const pick =
            a.selectedChoiceIndex ??
            (a as { selectedIndex?: number | null }).selectedIndex;
          if (pick === null || pick === undefined) continue;
          answered += 1;
          const q = byId.get(a.questionId);
          if (q && q.correctIndex !== null && pick === q.correctIndex) {
            correct += 1;
          }
        }
        if (!cancelled) {
          setResolved({
            correct,
            total: attempts.length,
            answered,
          });
        }
      } catch {
        if (!cancelled) setResolved(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempts, examId]);

  const incorrectCount = useMemo(() => {
    if (!resolved || !scoringEnabled) return 0;
    return Math.max(0, resolved.answered - resolved.correct);
  }, [resolved, scoringEnabled]);

  const pct = useMemo(() => {
    if (!resolved || !scoringEnabled) return null;
    const denom = resolved.answered || resolved.total;
    if (denom <= 0) return null;
    return Math.round((resolved.correct / denom) * 100);
  }, [resolved, scoringEnabled]);

  const headline = useMemo(
    () => headlineForScore(pct, scoringEnabled),
    [pct, scoringEnabled],
  );

  const avgTimeLabel = useMemo(() => {
    if (
      totalSecondsOnQuiz === undefined ||
      totalSecondsOnQuiz === null ||
      !resolved
    ) {
      return null;
    }
    return formatAvgSecondsPerQuestion(totalSecondsOnQuiz, resolved.total);
  }, [totalSecondsOnQuiz, resolved]);

  const summaryLine = useMemo(() => {
    if (!resolved) return null;
    if (!scoringEnabled) {
      return (
        <>
          You completed{" "}
          <span className="text-emphasis">{resolved.total}</span> questions
          {resolved.answered < resolved.total ? (
            <>
              {" "}
              ({resolved.answered} with an answer recorded)
            </>
          ) : null}
          . This set does not include a full answer key, so scores are not shown.
        </>
      );
    }
    return (
      <>
        You answered{" "}
        <span className="text-emphasis">{resolved.correct}</span> of{" "}
        <span className="text-emphasis">{resolved.answered}</span> graded items
        correctly
        {resolved.answered < resolved.total ? (
          <>
            {" "}
            ({resolved.total} in this session)
          </>
        ) : null}
        .
      </>
    );
  }, [resolved, scoringEnabled]);

  if (!attempts.length) {
    return (
      <main className="page page--centered page-results-empty">
        <StudyDeckLogo className="results-empty-logo" title="StudyDeck" />
        <h1 className="page-title">No results</h1>
        <p className="lead lead--compact">
          Open a quiz from the dashboard, finish the session, and you will land
          here with a summary.
        </p>
        <Link to="/dashboard" className="btn">
          Go to dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="page page-results">
      <div className="results-hero card">
        <StudyDeckLogo className="results-brand-mark" title="StudyDeck" />
        <p className="eyebrow">Session complete</p>
        <h1 className="results-headline">{headline}</h1>
        {state.title ? <p className="results-exam-title">{state.title}</p> : null}

        {scoringEnabled && pct !== null && resolved ? (
          <div
            className="results-donut"
            style={{ "--pct": String(pct) } as React.CSSProperties}
            role="img"
            aria-label={`${pct} percent correct`}
          >
            <div className="results-donut-inner">
              <span className="results-donut-value">{pct}%</span>
              <span className="results-donut-caption">score</span>
            </div>
          </div>
        ) : resolved ? (
          <div className="results-badge" aria-hidden>
            <span className="results-badge-icon">✓</span>
          </div>
        ) : (
          <div className="results-calculating" aria-live="polite">
            <div className="spinner" aria-hidden />
            <span className="muted">Summarizing…</span>
          </div>
        )}

        {resolved ? (
          <div className="results-stat-chips">
            <div className="results-chip results-chip--ok">
              <span className="results-chip-value">{resolved.correct}</span>
              <span className="results-chip-label">Correct</span>
            </div>
            {scoringEnabled ? (
              <div
                className="results-chip results-chip--bad"
                aria-label={`${incorrectCount} incorrect`}
              >
                <span className="results-chip-value">{incorrectCount}</span>
                <span className="results-chip-label">Incorrect</span>
              </div>
            ) : null}
            <div className="results-chip results-chip--neutral">
              <span className="results-chip-value">{resolved.total}</span>
              <span className="results-chip-label">In session</span>
            </div>
            {avgTimeLabel ? (
              <div className="results-chip results-chip--time">
                <span className="results-chip-value">{avgTimeLabel}</span>
                <span className="results-chip-label">Avg / question</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="results-summary">{summaryLine ?? "…"}</p>
      </div>

      {examId ? (
        <div className="btn-row results-actions">
          <Link to={practiceAgainTo} className="btn">
            Practice this exam again
          </Link>
          <Link to="/dashboard" className="btn secondary">
            Dashboard
          </Link>
        </div>
      ) : (
        <div className="btn-row results-actions">
          <Link to="/dashboard" className="btn">
            Dashboard
          </Link>
        </div>
      )}
    </main>
  );
}
