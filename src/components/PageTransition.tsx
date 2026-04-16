import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";

type PageTransitionProps = {
  children: ReactNode;
  /**
   * `full` — welcome / auth (slightly more movement).
   * `subtle` — in-app content under the main header.
   */
  tone?: "full" | "subtle";
};

/**
 * Re-mounts a keyed wrapper on route changes so enter animations run on navigation.
 */
export default function PageTransition({
  children,
  tone = "full",
}: PageTransitionProps) {
  const { pathname, search, hash } = useLocation();
  const transitionKey = `${pathname}${search}${hash}`;

  return (
    <div
      key={transitionKey}
      className={
        tone === "subtle"
          ? "page-transition page-transition--subtle"
          : "page-transition page-transition--full"
      }
    >
      {children}
    </div>
  );
}
