import { Link } from "react-router-dom";

export default function ComingSoonPage({ area }: { area: string }) {
  return (
    <main className="page page--centered page-coming-soon">
      <section className="home-soon coming-soon-card" aria-labelledby="coming-soon-title">
        <div className="home-soon-aurora" aria-hidden />
        <div className="home-soon-grid" aria-hidden />
        <div className="home-soon-body">
          <p className="home-soon-kicker">
            <span className="home-soon-live" aria-hidden />
            Coming soon
          </p>
          <h1 id="coming-soon-title" className="home-soon-title">
            {area}
          </h1>
          <p className="home-soon-copy">
            {area === "Workshop"
              ? "Upload any multiple-choice test, with the answers, and share it here. Other people can practice it, and if they find it useful, you can earn from the upload."
              : "People will share exams they made. A multiple-choice test with the answers can be practiced by anyone, and a useful upload can earn money for the person who shared it."}
          </p>
          <div className="btn-row coming-soon-actions">
            <Link to="/home" className="btn">
              Back to Home
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
