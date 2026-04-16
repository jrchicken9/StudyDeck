import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * Signed-in users need an admin-approved profile and account_status active
 * before reaching exam routes.
 */
export default function RequireExamAccess() {
  const { user, accessLoading, examAccessApproved, profileApproved } = useAuth();

  if (accessLoading) {
    return (
      <main className="page page--centered">
        <div className="spinner" aria-hidden />
        <p className="muted">Loading access…</p>
      </main>
    );
  }

  if (user && !examAccessApproved) {
    if (!profileApproved) {
      return <Navigate to="/pending-approval" replace />;
    }
    return <Navigate to="/account/moderation" replace />;
  }

  return <Outlet />;
}
