import { Link } from "react-router-dom";

export default function ComingSoonPage({ area }: { area: string }) {
  return (
    <main className="page page--centered page-coming-soon">
      <div className="card coming-soon-card">
        <p className="eyebrow">Coming soon</p>
        <h1 className="page-title">{area}</h1>
        <p className="lead">
          {area === "Workshop"
            ? "Workshop is where you will upload any multiple-choice test, with the answers, and share it on Community. Other people can practice it. If they find it useful, you can earn from the upload."
            : "Community is where people share exams they made. A multiple-choice test with the answers can be practiced by anyone. A useful upload can earn money for the person who shared it."}
        </p>
        <p className="muted">StudyDeck exams are on Home.</p>
        <div className="btn-row coming-soon-actions">
          <Link to="/home" className="btn">
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
