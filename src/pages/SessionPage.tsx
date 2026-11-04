import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getExamSummary } from "../data/exams";

const PRESETS = [20, 40, 60, 100] as const;
const ROTATE_MS = 3200;

type LengthOption = {
  id: string;
  count: number;
  figure: string;
  unit: string;
  note: string;
  share: number;
};

export default function SessionPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [custom, setCustom] = useState("");
  const [bankSize, setBankSize] = useState<number | null>(null);
  const [spot, setSpot] = useState(0);
  const [held, setHeld] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const exam = examId ? getExamSummary(examId) : undefined;

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/data/${examId}.json`);
        if (!res.ok) return;
        const data = (await res.json()) as { questions?: unknown };
        const n = Array.isArray(data.questions) ? data.questions.length : 0;
        if (!cancelled && n > 0) setBankSize(n);
      } catch {
        /* Length buttons still work without the count. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId]);

  const options = useMemo<LengthOption[]>(() => {
    const full = bankSize ?? 241;
    return [
      {
        id: "20",
        count: 20,
        figure: "20",
        unit: "questions",
        note: "A short drill. Enough to warm up without settling in.",
        share: 20 / full,
      },
      {
        id: "40",
        count: 40,
        figure: "40",
        unit: "questions",
        note: "A steady set. Room to miss a few and still see a pattern.",
        share: 40 / full,
      },
      {
        id: "60",
        count: 60,
        figure: "60",
        unit: "questions",
        note: "A longer sit. Closer to the pace of a real paper.",
        share: 60 / full,
      },
      {
        id: "100",
        count: 100,
        figure: "100",
        unit: "questions",
        note: "A full practice block. Leave time to review what you missed.",
        share: Math.min(1, 100 / full),
      },
      {
        id: "full",
        count: 9999,
        figure: "Full",
        unit: "bank",
        note: bankSize
          ? `Every one of the ${bankSize} questions, drawn in a new order.`
          : "Every question in the bank, drawn in a new order.",
        share: 1,
      },
    ];
  }, [bankSize]);

  const parsedCustom = useMemo(() => {
    const n = Number.parseInt(custom.trim(), 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(1, Math.min(500, n));
  }, [custom]);

  const customShare = parsedCustom
    ? Math.min(1, parsedCustom / (bankSize ?? 241))
    : null;
  const selectedIndex = options.findIndex((option) => option.id === selectedId);
  const selected =
    selectedId === "custom" && parsedCustom
      ? {
          count: parsedCustom,
          note: `${parsedCustom} questions from the bank, in a new order.`,
          share: customShare ?? 0,
          label: `${parsedCustom} questions`,
        }
      : selectedIndex >= 0
        ? {
            count: options[selectedIndex].count,
            note: options[selectedIndex].note,
            share: options[selectedIndex].share,
            label:
              options[selectedIndex].id === "full"
                ? "the full bank"
                : `${options[selectedIndex].figure} questions`,
          }
        : null;
  const activeIndex =
    selectedId === "custom" ? -1 : selectedIndex >= 0 ? selectedIndex : (held ?? spot);
  const active = options[activeIndex] ?? options[0];

  useEffect(() => {
    if (held !== null || selectedId !== null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setSpot((current) => (current + 1) % options.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [held, selectedId, options.length]);

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

  const previewNote = selected
    ? selected.note
    : custom.trim().length > 0 && parsedCustom === null
      ? "Enter a number from 1 to 500."
      : active.note;
  const previewShare = selected
    ? selected.share
    : custom.trim().length > 0 && parsedCustom === null
      ? 0
      : active.share;

  return (
    <main className="page page-exam-setup">
      <header className="exam-setup-header">
        <p className="eyebrow">{exam.subtitle}</p>
        <h1 className="page-title">{exam.title}</h1>
        <p className="lead">Choose a length, then start. Questions are drawn at random.</p>
      </header>

      <section className="card exam-setup" aria-labelledby="exam-setup-heading">
        <div className="exam-setup-preview" aria-live="polite">
          <p key={selected ? `chosen-${selected.label}` : active.id} className="exam-setup-preview-line">
            {previewNote}
          </p>
          <div
            className="exam-setup-meter"
            aria-hidden
          >
            <span style={{ width: `${Math.max(6, previewShare * 100)}%` }} />
          </div>
        </div>

        <h2 id="exam-setup-heading">Quick start</h2>
        <div className="exam-setup-grid">
          {PRESETS.map((n, optionIndex) => (
            <button
              key={n}
              type="button"
              className={`btn btn-preset${selectedId === String(n) ? " is-chosen" : ""}${activeIndex === optionIndex && selectedId !== String(n) ? " is-lit" : ""}`}
              aria-pressed={selectedId === String(n)}
              onMouseEnter={() => setHeld(optionIndex)}
              onMouseLeave={() => setHeld(null)}
              onFocus={() => setHeld(optionIndex)}
              onBlur={() => setHeld(null)}
              onClick={() => {
                setSelectedId(String(n));
                setCustom("");
              }}
            >
              {n}
              <span className="exam-setup-unit">questions</span>
            </button>
          ))}
          <button
            type="button"
            className={`btn btn-preset btn-preset-ghost${selectedId === "full" ? " is-chosen" : ""}${activeIndex === options.length - 1 && selectedId !== "full" ? " is-lit" : ""}`}
            aria-pressed={selectedId === "full"}
            onMouseEnter={() => setHeld(options.length - 1)}
            onMouseLeave={() => setHeld(null)}
            onFocus={() => setHeld(options.length - 1)}
            onBlur={() => setHeld(null)}
            onClick={() => {
              setSelectedId("full");
              setCustom("");
            }}
          >
            Full
            <span className="exam-setup-unit">bank</span>
          </button>
        </div>

        <div className="exam-setup-custom">
          <label htmlFor="custom-n">Custom length</label>
          <div className="exam-setup-custom-row">
            <input
              id="custom-n"
              className="input"
              inputMode="numeric"
              placeholder="1–500"
              value={custom}
              onChange={(e) => {
                const next = e.target.value;
                setCustom(next);
                const n = Number.parseInt(next.trim(), 10);
                if (Number.isFinite(n) && n >= 1) setSelectedId("custom");
                else if (selectedId === "custom") setSelectedId(null);
              }}
              onFocus={() => setHeld(null)}
            />
          </div>
        </div>

        <div className="exam-setup-confirm">
          <button
            type="button"
            className="btn exam-setup-confirm-btn"
            disabled={!selected}
            onClick={() => selected && start(selected.count)}
          >
            {selected ? `Start ${selected.label}` : "Choose a length to start"}
          </button>
        </div>
      </section>
    </main>
  );
}
