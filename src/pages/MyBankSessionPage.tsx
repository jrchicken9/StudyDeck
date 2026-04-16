import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { describeQuestionTimerRecipe, questionTimerFromBankRow } from "../lib/questionTimer";
import { supabase } from "../lib/supabaseClient";
import type { QuestionTimerSettings } from "../types";

const PRESETS = [20, 40, 60, 100] as const;

export default function MyBankSessionPage() {
  const { bankId } = useParams<{ bankId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [custom, setCustom] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  const [poolSize, setPoolSize] = useState(0);
  const [questionTimer, setQuestionTimer] = useState<QuestionTimerSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    if (!bankId || !supabase) {
      setLoadError(!supabase ? "Supabase is not configured." : "Missing test.");
      return;
    }
    setLoadError(null);
    const { data: bank, error: bErr } = await supabase
      .from("user_question_banks")
      .select("title, question_timer_config, per_question_time_limit_sec")
      .eq("id", bankId)
      .maybeSingle();
    if (bErr || !bank) {
      setLoadError(bErr?.message ?? "Test not found.");
      setTitle(null);
      setPoolSize(0);
      setQuestionTimer(null);
      return;
    }
    setTitle(typeof bank.title === "string" ? bank.title : "Untitled test");
    setQuestionTimer(questionTimerFromBankRow(bank.question_timer_config, bank.per_question_time_limit_sec));
    const { count, error: cErr } = await supabase
      .from("user_questions")
      .select("*", { count: "exact", head: true })
      .eq("bank_id", bankId);
    if (cErr || count === null) setPoolSize(0);
    else setPoolSize(count);
  }, [bankId]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const parsedCustom = useMemo(() => {
    const n = Number.parseInt(custom.trim(), 10);
    if (!Number.isFinite(n)) return null;
    const cap = Math.max(1, Math.min(500, poolSize || 500));
    return Math.max(1, Math.min(cap, n));
  }, [custom, poolSize]);

  function start(count: number) {
    if (!bankId || poolSize === 0) return;
    const n = Math.min(count, poolSize);
    const sp = new URLSearchParams();
    sp.set("n", String(n));
    navigate(`/quiz/${bankId}?${sp.toString()}`, {
      state: { from: location.pathname },
    });
  }

  if (loadError || !bankId) {
    return (
      <main className="page page--centered">
        <p className="muted">{loadError ?? "Something went wrong."}</p>
        <Link to="/my-banks" className="btn secondary">
          Work Shop
        </Link>
      </main>
    );
  }

  if (title === null) {
    return (
      <main className="page page--centered">
        <div className="spinner" aria-hidden />
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const cap = poolSize > 0 ? Math.min(500, poolSize) : 1;
  const presetCounts =
    poolSize > 0
      ? Array.from(
          new Set(PRESETS.map((n) => Math.min(n, cap)).filter((n) => n > 0)),
        ).sort((a, b) => a - b)
      : [];

  return (
    <main className="page page-home page-custom-tests">
      <header className="custom-tests-session-intro card">
        <p className="eyebrow custom-tests-eyebrow">Work Shop</p>
        <div className="custom-tests-session-title-row">
          <h1 className="page-title custom-tests-session-title">{title}</h1>
          <Link
            to={`/my-banks/${bankId}`}
            className="btn btn-ghost btn-compact custom-tests-session-edit"
          >
            Edit
          </Link>
        </div>
        <p className="muted custom-tests-session-meta">
          {poolSize === 0
            ? "Add questions in the editor before you can run this test."
            : `${poolSize} question${poolSize === 1 ? "" : "s"} in your pool — we’ll randomize which ones appear.`}
          {questionTimer !== null ? (
            <>
              {" "}
              <span className="custom-tests-session-timer">
                {describeQuestionTimerRecipe(questionTimer)}
              </span>
            </>
          ) : null}
        </p>
      </header>

      <div className="card custom-tests-session-card">
        <h2 className="custom-tests-card-heading">Quick start</h2>
        <div className="preset-grid">
          {presetCounts.map((n) => (
            <button
              key={n}
              type="button"
              className="btn btn-preset"
              disabled={poolSize === 0}
              onClick={() => start(n)}
            >
              {n} questions
            </button>
          ))}
          <button
            type="button"
            className="btn btn-preset btn-preset-ghost"
            disabled={poolSize === 0}
            onClick={() => start(9999)}
          >
            Full bank
          </button>
        </div>
      </div>

      <div className="card custom-tests-session-card">
        <h2 className="custom-tests-card-heading">Custom length</h2>
        <div className="field">
          <label htmlFor="custom-n-my">Questions (1–{cap})</label>
          <input
            id="custom-n-my"
            className="input"
            inputMode="numeric"
            placeholder={`1–${cap}`}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            disabled={poolSize === 0}
          />
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            disabled={poolSize === 0 || parsedCustom === null}
            onClick={() => parsedCustom !== null && start(parsedCustom)}
          >
            {parsedCustom !== null
              ? `Start ${parsedCustom} questions`
              : "Enter number of questions"}
          </button>
        </div>
      </div>

    </main>
  );
}
