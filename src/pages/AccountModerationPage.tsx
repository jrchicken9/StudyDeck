import { Link, Navigate } from "react-router-dom";
import ReturnNavButton from "../components/ReturnNavButton";
import { useReturnNavigation } from "../hooks/useReturnNavigation";
import { useAuth } from "../context/AuthContext";
import {
  accountStatusDescription,
  accountStatusLabel,
  isBannedStatus,
  type AccountStatus,
} from "../lib/accountStatus";

function copyFor(status: AccountStatus): { title: string; body: string } {
  switch (status) {
    case "banned":
      return {
        title: "Account blocked",
        body:
          "Your account has been banned. You cannot use StudyDeck until an administrator restores access. You can sign out below.",
      };
    case "suspended":
      return {
        title: "Access suspended",
        body:
          "An administrator has suspended your access to practice banks. Your profile is still available. Contact your administrator if this is a mistake.",
      };
    case "restricted":
      return {
        title: "Access restricted",
        body:
          "An administrator has restricted your access to practice banks. Other parts of the app may still be available.",
      };
    default:
      return {
        title: "Account notice",
        body: "There is nothing to show for your account status.",
      };
  }
}

export default function AccountModerationPage() {
  const {
    accountStatus,
    signOutUser,
    examAccessApproved,
    profileApproved,
    accessLoading,
  } = useAuth();
  const { title, body } = copyFor(accountStatus);
  const { handleReturn, returnLabel } = useReturnNavigation("/community");

  if (accessLoading) {
    return (
      <main className="page page--centered page-moderation">
        <div className="spinner" aria-hidden />
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (accountStatus === "active" && !profileApproved) {
    return <Navigate to="/pending-approval" replace />;
  }

  if (accountStatus === "active" && examAccessApproved) {
    return (
      <main className="page page--centered page-moderation">
        <div className="card pending-card">
          <p className="eyebrow">Account</p>
          <h1 className="page-title">All clear</h1>
          <p className="lead">Your account is active. You can return to the community home.</p>
          <ReturnNavButton fallbackTo="/community" />
        </div>
      </main>
    );
  }

  return (
    <main className="page page--centered page-moderation">
      <div className="card pending-card">
        <p className="eyebrow">{accountStatusLabel(accountStatus)}</p>
        <h1 className="page-title">{title}</h1>
        <p className="lead">{body}</p>
        <p className="muted">{accountStatusDescription(accountStatus)}</p>
        {!isBannedStatus(accountStatus) ? (
          <div className="page-return-nav" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="btn secondary btn-compact"
              onClick={handleReturn}
            >
              ← {returnLabel}
            </button>
            <Link to="/profile" className="btn secondary btn-compact">
              Profile
            </Link>
          </div>
        ) : null}
        <div className="btn-row pending-actions" style={{ marginTop: "1.25rem" }}>
          <button type="button" className="btn" onClick={() => void signOutUser()}>
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
