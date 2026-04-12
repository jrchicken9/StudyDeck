import { Link } from "react-router-dom";
import { EXAMS } from "../data/exams";

export default function DashboardPage() {
  return (
    <main className="page page-dashboard">
      <header className="page-header">
        <p className="eyebrow">Your exams</p>
        <h1 className="page-title">Choose an exam</h1>
        <p className="lead">Open a bank to set up a practice session.</p>
      </header>

      <ul className="exam-grid">
        {EXAMS.map((exam) => (
          <li key={exam.id}>
            <Link to={`/exams/${exam.id}`} className="exam-card">
              <span className="exam-card-kicker">{exam.subtitle}</span>
              <span className="exam-card-title">{exam.title}</span>
              <span className="exam-card-desc">{exam.description}</span>
              <span className="exam-card-cta">{exam.dashboardCta}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
