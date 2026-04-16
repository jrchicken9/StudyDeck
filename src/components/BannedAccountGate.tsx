import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isBannedStatus } from "../lib/accountStatus";

const MODERATION_PATH = "/account/moderation";

/**
 * Banned accounts may only open the moderation screen (and sign out).
 */
export default function BannedAccountGate() {
  const { user, accountStatus } = useAuth();
  const { pathname } = useLocation();

  if (!user) return <Outlet />;

  if (isBannedStatus(accountStatus) && pathname !== MODERATION_PATH) {
    return <Navigate to={MODERATION_PATH} replace />;
  }

  return <Outlet />;
}
