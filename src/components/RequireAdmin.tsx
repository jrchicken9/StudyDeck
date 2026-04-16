import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RequireAdmin() {
  const { user, accessLoading, isAdmin } = useAuth();

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (accessLoading) {
    return (
      <main className="page page--centered">
        <div className="spinner" aria-hidden />
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/community" replace />;
  }

  return <Outlet />;
}
