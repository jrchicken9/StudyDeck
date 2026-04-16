import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getExamSummary } from "../data/exams";

const PRESETS = [20, 40, 60, 100] as const;

export default function SessionPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [custom, setCustom] = useState("");
  const exam = examId ? getExamSummary(examId) : undefined;

  const parsedCustom = useMemo(() => {
    const n = Number.parseInt(custom.trim(), 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(1, Math.min(500, n));
  }, [custom]);

  function start(count: number) {
    if (!examId) return;
    const sp = new URLSearchParams();
    sp.set("n", String(count));
    navigate(`/quiz/${examId}?${sp.toString()}`, {
      state: { from: location.pathname },
    });
  }

  if (!examId || !exam) {
    return (
      <main className="page page--centered">
        <p className="muted">That exam was not found.</p>
      </main>
    );
  }

  return (
    <main className="page page-home">
      <header className="page-header">
        <p className="eyebrow">{exam.subtitle}</p>
        <h1 className="page-title">{exam.title}</h1>
      </header>

      <div className="card">
        <h2>Quick start</h2>
        <div className="preset-grid">
          {PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              className="btn btn-preset"
              onClick={() => start(n)}
            >
              {n} questions
            </button>
          ))}
          <button
            type="button"
            className="btn btn-preset btn-preset-ghost"
            onClick={() => start(9999)}
          >
            Full bank
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Custom length</h2>
        <div className="field">
          <label htmlFor="custom-n">Questions (1–500)</label>
          <input
            id="custom-n"
            className="input"
            inputMode="numeric"
            placeholder="1–500"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            disabled={parsedCustom === null}
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
