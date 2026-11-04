import { Link } from "react-router-dom";

export default function ComingSoonPage({ area }: { area: string }) {
  return (
    <main className="page page--centered page-coming-soon">
      <div className="card coming-soon-card">
        <p className="eyebrow">In progress</p>
        <h1 className="page-title">{area}</h1>
        <p className="lead">
          This part of StudyDeck is coming soon. The Sergeant exam is ready on Home.
        </p>
        <div className="btn-row coming-soon-actions">
          <Link to="/home" className="btn">
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
