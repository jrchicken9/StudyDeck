import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getRememberedLoginEmail,
  setRememberedLoginEmail,
} from "../lib/loginRemembrance";
import { mapLoginAuthError } from "../lib/mapLoginAuthError";
import {
  isSupabaseConfigured,
  setAuthSessionTabOnlyForNextSignIn,
} from "../lib/supabaseClient";
import { StudyDeckBrand } from "../components/StudyDeckLogo";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, loading, signedInHomePath, signInWithPassword } = useAuth();
  const [email, setEmail] = useState(() => getRememberedLoginEmail() ?? "");
  const [password, setPassword] = useState("");
  const [rememberEmail, setRememberEmail] = useState(
    () => Boolean(getRememberedLoginEmail()),
  );
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ready = isSupabaseConfigured();

  useEffect(() => {
    if (loading || !user) return;
    navigate(signedInHomePath, { replace: true });
  }, [loading, user, signedInHomePath, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ready) return;

    const em = email.trim();
    if (!em && !password) {
      setError("Enter your email and password to sign in.");
      return;
    }
    if (!em) {
      setError("Enter the email for your account.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setAuthSessionTabOnlyForNextSignIn(!staySignedIn);
    setPending(true);
    const { error: err, errorCode, errorStatus } = await signInWithPassword(
      em,
      password,
    );
    setPending(false);
    if (err) {
      setError(mapLoginAuthError(err, errorCode, errorStatus));
      return;
    }
    if (rememberEmail) setRememberedLoginEmail(em);
    else setRememberedLoginEmail(null);
    /* Session + profile load in context; useEffect navigates when ready. */
  }

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card--login card auth-surface">
        <header className="auth-card-header">
          <StudyDeckBrand
            layout="stack"
            logoClassName="auth-brand-logo"
            wordmarkClassName="eyebrow studydeck-wordmark studydeck-wordmark--compact studydeck-wordmark--serious"
          />
          <h1 className="page-title auth-page-title">Log in</h1>
          {ready ? (
            <p className="auth-subtitle">
              Welcome back. Sign in to pick up where you left off.
            </p>
          ) : null}
        </header>
        {!ready ? (
          <>
            <p className="muted auth-unconfigured-copy">
              Supabase is not configured. Add{" "}
              <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>{" "}
              to enable email login.
            </p>
            <div className="auth-cta-stack">
              <Link
                to="/auth/signup"
                className="btn btn-welcome-secondary auth-cta-secondary"
              >
                Join Us
              </Link>
            </div>
          </>
        ) : (
          <form onSubmit={onSubmit} className="auth-form" noValidate>
            <div className="field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
              />
            </div>
            <div className="auth-options" role="group" aria-label="Sign-in options">
              <label className="auth-option">
                <input
                  type="checkbox"
                  checked={rememberEmail}
                  onChange={(e) => {
                    setRememberEmail(e.target.checked);
                    setError(null);
                  }}
                />
                <span>Remember email on this device</span>
              </label>
              <label className="auth-option">
                <input
                  type="checkbox"
                  checked={staySignedIn}
                  onChange={(e) => {
                    setStaySignedIn(e.target.checked);
                    setError(null);
                  }}
                />
                <span>Stay signed in after closing the browser</span>
              </label>
            </div>
            {error ? (
              <p className="auth-error" role="alert" aria-live="polite">
                {error}
              </p>
            ) : null}
            <div className="auth-cta-stack">
              <button
                type="submit"
                className="btn btn-signup-primary"
                disabled={pending}
              >
                {pending ? "Signing in…" : "Log in"}
              </button>
              <Link
                to="/auth/signup"
                className="btn btn-welcome-secondary auth-cta-secondary"
              >
                Join Us
              </Link>
            </div>
          </form>
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
