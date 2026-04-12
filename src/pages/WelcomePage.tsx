import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import { getGuestSession } from "../lib/session";
import { StudyDeckLogo } from "../components/StudyDeckLogo";

export default function WelcomePage() {
  const navigate = useNavigate();
  const { loading, user, isGuest, continueAsGuest } = useAuth();
  const authReady = isSupabaseConfigured();
  const [guestName, setGuestName] = useState("");

  useEffect(() => {
    if (loading) return;
    if (user || isGuest) navigate("/dashboard", { replace: true });
  }, [loading, user, isGuest, navigate]);

  /** If they already have a saved guest name, pre-fill when returning before nav redirect. */
  useEffect(() => {
    const g = getGuestSession();
    if (g?.label) setGuestName(g.label);
  }, []);

  const trimmedName = guestName.trim();
  const canContinueGuest = trimmedName.length > 0;

  function onGuest() {
    if (!canContinueGuest) return;
    continueAsGuest(trimmedName);
    navigate("/dashboard");
  }

  if (loading) {
    return (
      <div className="welcome-shell">
        <div className="welcome-card">
          <div className="spinner" aria-hidden />
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (user || isGuest) {
    return (
      <div className="welcome-shell">
        <div className="welcome-card">
          <div className="spinner" aria-hidden />
          <p className="muted">Opening dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="welcome-shell">
      <div className="welcome-card">
        <div className="welcome-brand">
          <StudyDeckLogo className="welcome-logo" title="StudyDeck" />
          <h1 className="welcome-title">StudyDeck</h1>
          <p className="welcome-tagline">Exam practice, one session at a time.</p>
        </div>

        <div className="welcome-guest-block">
          <label className="welcome-label" htmlFor="guest-name">
            Your name (guests)
          </label>
          <input
            id="guest-name"
            className="input welcome-input"
            type="text"
            autoComplete="nickname"
            placeholder="e.g. Alex"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            maxLength={80}
          />
          <p className="welcome-guest-hint muted">
            Shown in the header while you practice. Not a full account.
          </p>
        </div>

        <div className="welcome-actions">
          <button
            type="button"
            className="btn btn-welcome-primary"
            onClick={onGuest}
            disabled={!canContinueGuest}
          >
            Continue as guest
          </button>
          {authReady ? (
            <>
              <Link
                to="/auth/login"
                className="btn btn-welcome-secondary"
              >
                Log in
              </Link>
              <Link
                to="/auth/signup"
                className="btn btn-welcome-secondary"
              >
                Create account
              </Link>
            </>
          ) : (
            <p className="welcome-auth-hint muted">
              Log in and sign up will appear here once Supabase environment variables
              are set on this deployment.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
