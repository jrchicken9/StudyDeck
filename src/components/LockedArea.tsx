import { Outlet, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isUuid } from "../lib/isUuid";
import ComingSoonPage from "../pages/ComingSoonPage";

function AccessHold() {
  return (
    <main className="page page--centered">
      <div className="spinner" aria-hidden />
      <p className="muted">Loading…</p>
    </main>
  );
}

/** Community and Work Shop stay available to admins. Everyone else sees coming soon. */
export function LockedArea({ area }: { area: string }) {
  const { isAdmin, accessLoading } = useAuth();
  if (accessLoading) return <AccessHold />;
  if (!isAdmin) return <ComingSoonPage area={area} />;
  return <Outlet />;
}

/** Custom-bank sessions belong to Work Shop. Official exams stay open. */
export function LockedCustomExam({ children }: { children: React.ReactNode }) {
  const { examId } = useParams<{ examId: string }>();
  const { isAdmin, accessLoading } = useAuth();
  if (examId && isUuid(examId)) {
    if (accessLoading) return <AccessHold />;
    if (!isAdmin) return <ComingSoonPage area="Workshop" />;
  }
  return children;
}
