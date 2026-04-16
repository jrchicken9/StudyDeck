import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import { StudyDeckBrand } from "../components/StudyDeckLogo";

export default function WelcomePage() {
  const navigate = useNavigate();
  const { loading, user, signedInHomePath } = useAuth();
  const authReady = isSupabaseConfigured();

  useEffect(() => {
    if (loading) return;
    if (user) {
      navigate(signedInHomePath, { replace: true });
    }
  }, [loading, user, signedInHomePath, navigate]);

  if (loading) {
    return (
      <div className="welcome-shell">
        <div className="welcome-card auth-surface">
          <div className="spinner" aria-hidden />
          <p className="muted welcome-loading-text">Loading…</p>
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="welcome-shell">
        <div className="welcome-card auth-surface">
          <div className="spinner" aria-hidden />
          <p className="muted welcome-loading-text">Opening StudyDeck…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="welcome-shell">
      <div className="welcome-card auth-surface">
        <div className="welcome-brand">
          <StudyDeckBrand
            layout="stack"
            logoClassName="welcome-logo"
            wordmarkClassName="welcome-eyebrow studydeck-wordmark studydeck-wordmark--hero studydeck-wordmark--serious"
          />
          <h1 className="welcome-title">Exam practice, refined.</h1>
          <p className="welcome-tagline">
            Timed quizzes, clear results, and a calm place to prepare—built for serious
            learners.
          </p>
          <ul className="welcome-points" aria-label="Key benefits">
            <li>Timed sessions</li>
            <li>Instant feedback</li>
            <li>Focused revision</li>
          </ul>
        </div>

        <div className="welcome-actions">
          {authReady ? (
            <>
              <Link
                to="/auth/signup"
                className="btn btn-welcome-primary"
              >
                Join For Free
              </Link>
              <Link
                to="/auth/login"
                className="btn btn-welcome-secondary"
              >
                Log in
              </Link>
            </>
          ) : (
            <p className="welcome-auth-hint muted">
              The Log in and Join For Free buttons will appear here once Supabase environment
              variables are set on this deployment.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
