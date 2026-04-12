import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, loading, signInWithPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ready = isSupabaseConfigured();

  useEffect(() => {
    if (!loading && user) navigate("/dashboard", { replace: true });
  }, [loading, user, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ready) return;
    setPending(true);
    const { error: err } = await signInWithPassword(email.trim(), password);
    setPending(false);
    if (err) {
      setError(err);
      return;
    }
    navigate("/dashboard", { replace: true });
  }

  return (
    <div className="auth-shell">
      <div className="auth-card card">
        <p className="eyebrow">StudyDeck</p>
        <h1 className="page-title">Log in</h1>
        {!ready ? (
          <p className="muted">
            Supabase is not configured. Add{" "}
            <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>{" "}
            to enable email login.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="auth-form">
            <div className="field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
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
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? <p className="auth-error">{error}</p> : null}
            <div className="btn-row">
              <button type="submit" className="btn" disabled={pending}>
                {pending ? "Signing in…" : "Log in"}
              </button>
            </div>
          </form>
        )}
        <p className="muted auth-footer-links">
          <Link to="/">← Welcome</Link>
          {" · "}
          <Link to="/auth/signup">Create account</Link>
        </p>
      </div>
    </div>
  );
}
