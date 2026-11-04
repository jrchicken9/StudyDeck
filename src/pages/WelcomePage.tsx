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
      <div className="welcome-stage">
        <div className="welcome-copy">
          <StudyDeckBrand layout="inline" logoClassName="welcome-logo" />
          <h1 className="welcome-title">
            Practice for
            <br />
            your exam.
          </h1>
          <p className="welcome-tagline">
            Timed multiple-choice sessions. Answer a question, then see if you were right.
          </p>
          <div className="welcome-actions">
            {authReady ? (
              <>
                <Link to="/auth/signup" className="btn btn-welcome-primary">
                  Create account
                </Link>
                <Link to="/auth/login" className="btn btn-welcome-secondary">
                  Log in
                </Link>
              </>
            ) : (
              <p className="welcome-auth-hint muted">
                Create account and Log in appear once this deployment is connected to accounts.
              </p>
            )}
          </div>
        </div>

        <ul className="welcome-points" aria-label="What you can practice">
          <li>
            <span>StudyDeck exams</span>
            <p>Exams published by the team behind the app.</p>
          </li>
          <li>
            <span>Community</span>
            <p>Multiple-choice tests people upload, with the answers included.</p>
          </li>
          <li>
            <span>The session</span>
            <p>A timer on each question, and the key as soon as you commit.</p>
          </li>
        </ul>
      </div>
    </div>
  );
}
