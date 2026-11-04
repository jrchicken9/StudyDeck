import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getExamSummary } from "../data/exams";

const SGT_EXAM_ID = "sgt-march-2026";
const SLIDE_MS = 5600;

type Slide = {
  id: string;
  kicker: string;
  title: string;
  copy: string;
};

export default function HomePage() {
  const location = useLocation();
  const exam = getExamSummary(SGT_EXAM_ID);
  const [bankSize, setBankSize] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/data/${SGT_EXAM_ID}.json`);
        if (!res.ok) return;
        const data = (await res.json()) as { questions?: unknown };
        const n = Array.isArray(data.questions) ? data.questions.length : 0;
        if (!cancelled && n > 0) setBankSize(n);
      } catch {
        /* The card still links through if the count cannot be loaded. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const slides = useMemo<Slide[]>(() => {
    const count = bankSize ? `${bankSize} questions` : "A full question bank";
    return [
      {
        id: "exam",
        kicker: `${exam?.subtitle ?? "March 2026"} · Official exam`,
        title: exam?.title ?? "Sergeant exam",
        copy: "Practice for the Sergeant exam. On the next screen you choose how many questions, then confirm to begin.",
      },
      {
        id: "bank",
        kicker: "The bank",
        title: count,
        copy: "Draw a short set or sit the full bank. Choices are shuffled, so the letter you remember is not the answer.",
      },
      {
        id: "session",
        kicker: "How a session feels",
        title: "Timed, then the key.",
        copy: "A clock stays with each question. The moment you commit, you see whether you were right.",
      },
    ];
  }, [bankSize, exam?.subtitle, exam?.title]);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, SLIDE_MS);
    return () => window.clearInterval(id);
  }, [paused, slides.length]);

  if (!exam) {
    return (
      <main className="page page--centered">
        <p className="muted">The Sergeant exam is not available.</p>
      </main>
    );
  }

  return (
    <main className="page page-dashboard page-signed-home">
      <p className="eyebrow">Home</p>
      <section
        className="home-feature home-stage"
        data-slide={slides[index]?.id}
        aria-roledescription="carousel"
        aria-label="Sergeant exam"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <div className="home-feature-glow" aria-hidden />
        <div className="home-stage-viewport">
          <div
            className="home-stage-track"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {slides.map((slide, slideIndex) => (
              <article
                key={slide.id}
                className="home-stage-slide"
                aria-hidden={slideIndex !== index}
              >
                <p className="home-feature-kicker">{slide.kicker}</p>
                <h1 className="home-feature-title">{slide.title}</h1>
                <p className="home-feature-copy">{slide.copy}</p>
              </article>
            ))}
          </div>
        </div>
        <div className="home-stage-footer">
          <div className="home-stage-dots" role="tablist" aria-label="Card versions">
            {slides.map((slide, slideIndex) => (
              <button
                key={slide.id}
                type="button"
                role="tab"
                className={`home-stage-dot${slideIndex === index ? " is-active" : ""}`}
                aria-selected={slideIndex === index}
                aria-label={slide.kicker}
                onClick={() => setIndex(slideIndex)}
              />
            ))}
          </div>
          <Link
            to={`/exams/${SGT_EXAM_ID}`}
            state={{ from: location.pathname }}
            className="home-feature-cta"
          >
            Start the exam
          </Link>
        </div>
      </section>
    </main>
  );
}
