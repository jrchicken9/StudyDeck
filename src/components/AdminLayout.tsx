import { NavLink, Outlet } from "react-router-dom";
import { usePendingApprovalsFromLayout } from "../context/PendingApprovalsContext";
import ApprovalsBellIcon from "./ApprovalsBellIcon";

export default function AdminLayout() {
  const pendingApprovals = usePendingApprovalsFromLayout();

  return (
    <div className="admin-shell">
      <div className="admin-shell__intro">
        <p className="admin-shell__kicker">Administration</p>
        <div className="admin-subnav-wrap">
          <nav className="admin-subnav" aria-label="Admin sections">
            <NavLink
              to="/admin/approvals"
              end
              className={({ isActive }) =>
                `admin-subnav-link${isActive ? " admin-subnav-link--active" : ""}${pendingApprovals > 0 ? " admin-subnav-link--notify" : ""}`
              }
              aria-label={
                pendingApprovals > 0
                  ? `Approvals, ${pendingApprovals} pending`
                  : "Approvals"
              }
            >
              {pendingApprovals > 0 ? (
                <ApprovalsBellIcon className="admin-subnav-bell" />
              ) : null}
              <span>Approvals</span>
              {pendingApprovals > 0 ? (
                <span className="admin-subnav-badge" title={`${pendingApprovals} pending`}>
                  {pendingApprovals > 99 ? "99+" : pendingApprovals}
                </span>
              ) : null}
            </NavLink>
            <NavLink
              to="/admin/users"
              className={({ isActive }) =>
                `admin-subnav-link${isActive ? " admin-subnav-link--active" : ""}`
              }
            >
              Users
            </NavLink>
          </nav>
        </div>
      </div>
      <Outlet />
    </div>
  );
}
