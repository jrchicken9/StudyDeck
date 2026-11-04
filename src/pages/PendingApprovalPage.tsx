import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { StudyDeckBrand } from "../components/StudyDeckLogo";
import { useAuth } from "../context/AuthContext";

export default function PendingApprovalPage() {
  const navigate = useNavigate();
  const {
    user,
    accessLoading,
    signedInHomePath,
    refetchAccess,
    signOutUser,
  } = useAuth();

  useEffect(() => {
    const id = window.setInterval(() => {
      void refetchAccess();
    }, 20000);
    return () => window.clearInterval(id);
  }, [refetchAccess]);

  useEffect(() => {
    if (accessLoading) return;
    if (!user) {
      navigate("/", { replace: true });
      return;
    }
    if (signedInHomePath !== "/pending-approval") {
      navigate(signedInHomePath, { replace: true });
    }
  }, [accessLoading, signedInHomePath, navigate, user]);

  async function onSignOut() {
    await signOutUser();
    navigate("/", { replace: true });
  }

  if (accessLoading || !user) {
    return (
      <main className="page page--centered">
        <div className="spinner" aria-hidden />
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="page page--centered page-pending">
      <div className="card pending-card">
        <StudyDeckBrand
          layout="stack"
          logoClassName="auth-brand-logo"
          wordmarkClassName="eyebrow studydeck-wordmark studydeck-wordmark--compact"
        />
        <h1 className="page-title">Awaiting access</h1>
        <p className="lead">
          Your account is ready, but an administrator still needs to approve it.
          After that, Home is where you start the Sergeant exam.
        </p>
        {user.email ? (
          <p className="muted">
            Signed in as <strong className="pending-email">{user.email}</strong>
          </p>
        ) : null}
        <div className="btn-row pending-actions">
          <button type="button" className="btn" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
