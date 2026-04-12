import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { loadExam } from "../lib/examApi";
import type { Attempt } from "./QuizPage";

type LocationState = {
  attempts?: Attempt[];
  scoringEnabled?: boolean;
  title?: string;
};

export default function ResultsPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [resolved, setResolved] = useState<{
    correct: number;
    total: number;
    answered: number;
  } | null>(null);

  const attempts = state.attempts ?? [];
  const scoringEnabled = Boolean(state.scoringEnabled);

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
          if (
            q &&
            q.correctIndex !== null &&
            pick === q.correctIndex
          ) {
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

  const summary = useMemo(() => {
    if (!resolved) return null;
    if (!scoringEnabled) {
      return (
        <>
          You finished{" "}
          <span className="text-emphasis">{resolved.total}</span> questions (
          {resolved.answered} answered).
        </>
      );
    }
    return (
      <>
        <span className="accent">{resolved.correct}</span> correct out of{" "}
        <span className="text-emphasis">{resolved.total}</span>
        {resolved.answered < resolved.total ? (
          <> · {resolved.answered} answered</>
        ) : null}
      </>
    );
  }, [resolved, scoringEnabled]);

  if (!attempts.length) {
    return (
      <main className="page page--centered">
        <p className="muted">No results to show.</p>
        <Link to="/dashboard" className="btn secondary">
          Dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="page page-results">
      <header className="page-header">
        <p className="eyebrow">Session</p>
        <h1 className="page-title">Complete</h1>
        {state.title ? <p className="lead">{state.title}</p> : null}
      </header>
      <div className="card">
        <h2>Summary</h2>
        <p className="score-display">{summary ?? "Calculating…"}</p>
        {!scoringEnabled ? (
          <p className="muted" style={{ marginTop: "1rem" }}>
            This bank did not include a key for every item, so only completion is
            shown.
          </p>
        ) : null}
      </div>
      <div className="btn-row">
        <Link to="/dashboard" className="btn">
          New session
        </Link>
        <button
          type="button"
          className="btn secondary"
          onClick={() => navigate(-1)}
        >
          Back
        </button>
      </div>
    </main>
  );
}
