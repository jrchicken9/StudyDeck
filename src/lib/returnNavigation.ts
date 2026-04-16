import type { Location, NavigateFunction } from "react-router-dom";

/** Location state key for “return to this path” (set on forward navigations). */
export type LocationStateWithFrom = { from?: string };

export function goReturn(
  navigate: NavigateFunction,
  location: Pick<Location, "state">,
  fallbackTo: string,
) {
  const st = location.state as LocationStateWithFrom | null | undefined;
  const from = st?.from;
  if (from && typeof from === "string" && from.length > 0) {
    navigate(from);
    return;
  }
  if (typeof window !== "undefined" && window.history.length > 1) {
    navigate(-1);
    return;
  }
  navigate(fallbackTo);
}

/**
 * Short label for the return button (no arrow).
 * `practiceBankId` refines the label when returning from that bank’s practice screen.
 */
export function humanizeReturnLabel(
  fromPath: string | undefined,
  opts?: { practiceBankId?: string },
): string {
  if (!fromPath) return "Back";
  if (fromPath === "/dashboard") return "Community";
  if (fromPath === "/community") return "Community";
  if (fromPath === "/my-tests") return "My Tests";
  if (fromPath === "/my-banks") return "Work Shop";
  if (fromPath === "/profile") return "Profile";
  if (fromPath.startsWith("/admin")) return "Admin";
  if (fromPath.startsWith("/account/moderation")) return "Account notice";
  if (fromPath.startsWith("/pending-approval")) return "Pending access";
  if (opts?.practiceBankId && fromPath === `/my-banks/${opts.practiceBankId}`) {
    return "Edit";
  }
  if (fromPath.startsWith("/my-banks/") && !fromPath.includes("/practice")) {
    return "Work Shop";
  }
  if (fromPath.startsWith("/exams/")) return "Session setup";
  if (fromPath.startsWith("/quiz/")) return "Quiz";
  if (fromPath.startsWith("/results/")) return "Results";
  return "Back";
}
