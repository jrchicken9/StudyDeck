import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getGuestSession } from "../lib/session";
import { supabaseStatusMessage } from "../lib/supabase";
import { StudyDeckLogo } from "./StudyDeckLogo";

export default function AppLayout() {
  const { user, isGuest, signOutUser, leaveGuestSession } = useAuth();
  const navigate = useNavigate();
  const guestProfile = isGuest ? getGuestSession() : null;

  async function handleSignOut() {
    await signOutUser();
    navigate("/", { replace: true });
  }

  function handleLeaveGuest() {
    leaveGuestSession();
    navigate("/", { replace: true });
  }

  return (
    <div className="layout layout--app">
      <header className="topbar">
        <Link to="/dashboard" className="brand">
          <StudyDeckLogo className="brand-icon" />
          <span className="brand-wordmark">StudyDeck</span>
        </Link>
        <div className="topbar-actions">
          {user ? (
            <>
              <span className="pill pill-email" title={user.email ?? ""}>
                {user.email ?? "Account"}
              </span>
              <button type="button" className="btn btn-ghost" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          ) : isGuest ? (
            <>
              <span className="pill" title="Guest session">
                {guestProfile?.label ?? "Guest"}
              </span>
              <button type="button" className="btn btn-ghost" onClick={handleLeaveGuest}>
                Leave
              </button>
            </>
          ) : null}
        </div>
      </header>
      <Outlet />
      <footer className="app-footer">
        <p className="footer-note">{supabaseStatusMessage()}</p>
      </footer>
    </div>
  );
}
