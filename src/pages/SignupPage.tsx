import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

export default function SignupPage() {
  const navigate = useNavigate();
  const { user, loading, signUpWithPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ready = isSupabaseConfigured();

  useEffect(() => {
    if (!loading && user) navigate("/dashboard", { replace: true });
  }, [loading, user, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!ready) return;
    setPending(true);
    const res = await signUpWithPassword(email.trim(), password);
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.needsEmailConfirm) {
      setInfo("Check your email to confirm your account, then log in.");
      return;
    }
    navigate("/dashboard", { replace: true });
  }

  return (
    <div className="auth-shell">
      <div className="auth-card card">
        <p className="eyebrow">StudyDeck</p>
        <h1 className="page-title">Create account</h1>
        {!ready ? (
          <p className="muted">
            Supabase is not configured. Add environment variables to enable sign
            up.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="auth-form">
            <div className="field">
              <label htmlFor="signup-email">Email</label>
              <input
                id="signup-email"
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            {error ? <p className="auth-error">{error}</p> : null}
            {info ? <p className="auth-info">{info}</p> : null}
            <div className="btn-row">
              <button type="submit" className="btn" disabled={pending}>
                {pending ? "Creating…" : "Create account"}
              </button>
            </div>
          </form>
        )}
        <p className="muted auth-footer-links">
          <Link to="/">← Welcome</Link>
          {" · "}
          <Link to="/auth/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
