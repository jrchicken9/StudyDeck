import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RequireSession() {
  const { loading, hasSession } = useAuth();

  if (loading) {
    return (
      <main className="page page--centered">
        <div className="spinner" aria-hidden />
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (!hasSession) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
