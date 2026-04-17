import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { StudyDeckBrand } from "../components/StudyDeckLogo";
import { useAuth } from "../context/AuthContext";
import { loadExam } from "../lib/examApi";
import { isUuid } from "../lib/isUuid";
import { supabase } from "../lib/supabaseClient";
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
  const { user } = useAuth();

  const [resolved, setResolved] = useState<{
    correct: number;
    total: number;
    answered: number;
  } | null>(null);

  const [bankOwnerId, setBankOwnerId] = useState<string | null>(null);
  const [bankPublishedAt, setBankPublishedAt] = useState<string | null>(null);
  const [myTestRating, setMyTestRating] = useState<number | null>(null);
  const [testRatingBusy, setTestRatingBusy] = useState(false);
  const [testRatingErr, setTestRatingErr] = useState<string | null>(null);

  const attempts = state.attempts ?? [];
  const scoringEnabled = Boolean(state.scoringEnabled);
  const totalSecondsOnQuiz = state.totalSecondsOnQuiz;
  const sessionQuestionCount = state.sessionQuestionCount;

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

  useEffect(() => {
    if (!examId || !isUuid(examId) || !supabase) {
      setBankOwnerId(null);
      setBankPublishedAt(null);
      setMyTestRating(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: bank, error: bErr } = await supabase
        .from("user_question_banks")
        .select("user_id, published_at")
        .eq("id", examId)
        .maybeSingle();
      if (cancelled) return;
      if (bErr || !bank) {
        setBankOwnerId(null);
        setBankPublishedAt(null);
        setMyTestRating(null);
        return;
      }
      const uid = typeof bank.user_id === "string" ? bank.user_id : null;
      const pub =
        bank.published_at !== null && bank.published_at !== undefined
          ? String(bank.published_at)
          : null;
      setBankOwnerId(uid);
      setBankPublishedAt(pub);
      if (user?.id && uid && pub && uid !== user.id) {
        const { data: existing } = await supabase
          .from("community_test_ratings")
          .select("rating")
          .eq("rater_user_id", user.id)
          .eq("bank_id", examId)
          .maybeSingle();
        if (!cancelled) {
          const r = (existing as { rating?: number } | null)?.rating;
          setMyTestRating(typeof r === "number" ? r : null);
        }
      } else if (!cancelled) {
        setMyTestRating(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, user?.id]);

  const showCommunityTestRating = Boolean(
    examId &&
      isUuid(examId) &&
      user?.id &&
      bankPublishedAt &&
      bankOwnerId &&
      bankOwnerId !== user.id,
  );

  async function submitTestRating(rating: number) {
    if (!supabase || !user?.id || !examId || !isUuid(examId)) return;
    setTestRatingBusy(true);
    setTestRatingErr(null);
    const { error: upErr } = await supabase.from("community_test_ratings").upsert(
      {
        rater_user_id: user.id,
        bank_id: examId,
        rating,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "rater_user_id,bank_id" },
    );
    setTestRatingBusy(false);
    if (upErr) {
      setTestRatingErr(upErr.message);
      return;
    }
    setMyTestRating(rating);
  }

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
        <div className="results-empty-brand">
          <StudyDeckBrand
            layout="stack"
            logoClassName="results-empty-logo"
            wordmarkClassName="studydeck-wordmark studydeck-wordmark--compact"
          />
        </div>
        <h1 className="page-title">No results</h1>
        <p className="lead lead--compact">
          Open a quiz from{" "}
          <Link to="/my-tests">My Tests</Link> or <Link to="/my-banks">Work Shop</Link>, finish the
          session, and you will land here with a summary.
        </p>
        <Link to="/my-tests" className="btn">
          Go to My Tests
        </Link>
      </main>
    );
  }

  return (
    <main className="page page-results">
      <div className="results-hero card">
        <div className="results-hero-brand">
          <StudyDeckBrand
            layout="stack"
            logoClassName="results-brand-mark"
            wordmarkClassName="studydeck-wordmark studydeck-wordmark--compact"
          />
        </div>
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

      {showCommunityTestRating ? (
        <section className="card results-community-test-rating" aria-labelledby="results-test-rating-heading">
          <h2 id="results-test-rating-heading" className="results-test-rating-title">
            Rate this test
          </h2>
          <p className="muted results-test-rating-lead">
            This session was a published Community test. Your rating helps other learners choose
            quality material. You can update your stars anytime after another session.
          </p>
          {bankOwnerId ? (
            <p className="muted results-test-rating-publisher">
              Publisher:{" "}
              <Link to={`/community/publisher/${encodeURIComponent(bankOwnerId)}`}>
                View profile
              </Link>
            </p>
          ) : null}
          {testRatingErr ? <p className="auth-error">{testRatingErr}</p> : null}
          <div className="results-test-rating-controls">
            <span className="muted results-test-rating-label">
              {myTestRating ? "Your rating" : "Tap a star"}
            </span>
            <div className="community-thread-rate-stars" role="group" aria-label="Test rating 1 to 5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={
                    "community-thread-rate-btn" +
                    (myTestRating && n <= myTestRating ? " community-thread-rate-btn--on" : "")
                  }
                  disabled={testRatingBusy}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  onClick={() => void submitTestRating(n)}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {examId ? (
        <div className="btn-row results-actions">
          {typeof sessionQuestionCount === "number" && sessionQuestionCount > 0 ? (
            <Link
              to={`/quiz/${examId}?n=${encodeURIComponent(String(sessionQuestionCount))}`}
              className="btn"
            >
              Practice this exam again
            </Link>
          ) : (
            <Link
              to={`/exams/${examId}`}
              className="btn"
            >
              Practice this exam again
            </Link>
          )}
          <Link
            to={examId && isUuid(examId) ? "/community" : "/my-tests"}
            className="btn secondary"
          >
            {examId && isUuid(examId) ? "Community" : "My Tests"}
          </Link>
        </div>
      ) : (
        <div className="btn-row results-actions">
          <Link to="/community" className="btn">
            Community
          </Link>
        </div>
      )}
    </main>
  );
}
