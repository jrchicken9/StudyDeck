import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isBannedStatus } from "../lib/accountStatus";
import { PendingApprovalsProvider } from "../context/PendingApprovalsContext";
import { usePendingApprovalsCount } from "../hooks/usePendingApprovalsCount";
import PageTransition from "./PageTransition";
import ApprovalsBellIcon from "./ApprovalsBellIcon";
import { StudyDeckBrand } from "./StudyDeckLogo";

export default function AppLayout() {
  const { user, isAdmin, signOutUser, accountStatus } = useAuth();
  const banned = isBannedStatus(accountStatus);
  const navigate = useNavigate();
  const location = useLocation();
  const pendingApprovals = usePendingApprovalsCount(Boolean(isAdmin && user), user?.id);

  async function handleSignOut() {
    await signOutUser();
    navigate("/", { replace: true });
  }

  return (
    <div className="layout layout--app">
      <header className="topbar">
        <Link to={banned ? "/account/moderation" : "/community"} className="brand">
          <StudyDeckBrand
            layout="inline"
            logoClassName="brand-icon"
            wordmarkClassName="brand-wordmark studydeck-wordmark"
          />
        </Link>
        <div className="topbar-actions">
          {user ? (
            <>
              {!banned ? (
                <>
                  <NavLink
                    to="/community"
                    end
                    state={{ from: location.pathname }}
                    className={({ isActive }) =>
                      `btn btn-ghost btn-compact topbar-tab${isActive ? " topbar-tab--active" : ""}`
                    }
                  >
                    Community
                  </NavLink>
                  <NavLink
                    to="/my-tests"
                    end
                    state={{ from: location.pathname }}
                    className={({ isActive }) =>
                      `btn btn-ghost btn-compact topbar-tab${isActive ? " topbar-tab--active" : ""}`
                    }
                  >
                    My Tests
                  </NavLink>
                  <NavLink
                    to="/my-banks"
                    state={{ from: location.pathname }}
                    className={({ isActive }) =>
                      `btn btn-ghost btn-compact topbar-tab${isActive ? " topbar-tab--active" : ""}`
                    }
                  >
                    Work Shop
                  </NavLink>
                  <NavLink
                    to="/profile"
                    state={{ from: location.pathname }}
                    className={({ isActive }) =>
                      `btn btn-ghost btn-compact topbar-tab${isActive ? " topbar-tab--active" : ""}`
                    }
                  >
                    Profile
                  </NavLink>
                  {isAdmin ? (
                    <NavLink
                      to="/admin"
                      state={{ from: location.pathname }}
                      className={({ isActive }) =>
                        `btn btn-ghost btn-compact topbar-admin topbar-tab${pendingApprovals > 0 ? " topbar-admin--notify" : ""}${isActive ? " topbar-tab--active" : ""}`
                      }
                      aria-label={
                        pendingApprovals > 0
                          ? `Admin, ${pendingApprovals} approval requests pending`
                          : "Admin"
                      }
                    >
                      {pendingApprovals > 0 ? (
                        <ApprovalsBellIcon className="topbar-admin-bell" />
                      ) : null}
                      <span>Admin</span>
                      {pendingApprovals > 0 ? (
                        <span className="topbar-admin-badge" title={`${pendingApprovals} pending`}>
                          {pendingApprovals > 99 ? "99+" : pendingApprovals}
                        </span>
                      ) : null}
                    </NavLink>
                  ) : null}
                </>
              ) : null}
              <button type="button" className="btn btn-ghost" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          ) : null}
        </div>
      </header>
      <PendingApprovalsProvider count={pendingApprovals}>
        <PageTransition tone="subtle">
          <Outlet />
        </PageTransition>
      </PendingApprovalsProvider>
    </div>
  );
}
