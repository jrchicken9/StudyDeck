import { Link } from "react-router-dom";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import { StudyDeckBrand } from "../components/StudyDeckLogo";
import { useAuth } from "../context/AuthContext";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function SignupPage() {
  const navigate = useNavigate();
  const { user, loading, signedInHomePath } = useAuth();
  const ready = isSupabaseConfigured();

  useEffect(() => {
    if (loading || !user) return;
    navigate(signedInHomePath, { replace: true });
  }, [loading, user, signedInHomePath, navigate]);

  return (
    <div className="auth-shell">
      <div className="auth-card card auth-card--signup auth-surface">
        <header className="signup-header">
          <StudyDeckBrand
            layout="stack"
            logoClassName="auth-brand-logo"
            wordmarkClassName="eyebrow studydeck-wordmark studydeck-wordmark--compact studydeck-wordmark--serious"
          />
          <h1 className="page-title signup-title auth-page-title">Create account</h1>
          {ready ? (
            <p className="auth-subtitle">
              Create your account with email. Phone sign-up is not available yet.
            </p>
          ) : null}
        </header>

        {!ready ? (
          <>
            <p className="muted signup-unconfigured">
              Sign-up is not available until this app is connected to our account
              service.
            </p>
            <div className="auth-cta-stack">
              <Link
                to="/auth/login"
                className="btn btn-welcome-secondary auth-cta-secondary"
              >
                Log in
              </Link>
            </div>
          </>
        ) : (
          <div className="auth-form signup-form">
            <div className="auth-cta-stack">
              <Link to="/auth/signup/email" className="btn btn-signup-primary">
                Use email
              </Link>
              <button
                type="button"
                className="btn btn-welcome-secondary auth-cta-secondary"
                disabled
                aria-disabled="true"
              >
                Use phone number
                <span className="signup-locked-note">Not available yet</span>
              </button>
              <Link
                to="/auth/login"
                className="btn btn-welcome-secondary auth-cta-secondary"
              >
                Log in
              </Link>
            </div>
          </div>
        )}
        <footer className="auth-footer">
          <Link to="/" className="auth-footer-link">
            ← Back to home
          </Link>
        </footer>
      </div>
    </div>
  );
}
