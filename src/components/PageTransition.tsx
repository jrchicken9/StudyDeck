import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useLocation } from "react-router-dom";

type PageTransitionProps = {
  children: ReactNode;
  /**
   * `full` — welcome / auth (slightly more movement).
   * `subtle` — in-app content under the main header.
   */
  tone?: "full" | "subtle";
};

type Snapshot = {
  key: string;
  children: ReactNode;
};

type DocumentWithViewTransition = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Keeps the previous page on screen until the next one is ready, then
 * crossfades them. The top bar stays put, so a click feels like moving
 * inside the app.
 */
export default function PageTransition({
  children,
  tone = "full",
}: PageTransitionProps) {
  const location = useLocation();
  const transitionKey = `${location.pathname}${location.search}${location.hash}`;
  const pendingChildren = useRef(children);
  pendingChildren.current = children;

  const [snapshot, setSnapshot] = useState<Snapshot>({
    key: transitionKey,
    children,
  });

  useLayoutEffect(() => {
    if (snapshot.key === transitionKey) return;
    const nextKey = transitionKey;
    const commit = () => {
      setSnapshot({ key: nextKey, children: pendingChildren.current });
    };
    const start = (document as DocumentWithViewTransition).startViewTransition;
    if (prefersReducedMotion() || typeof start !== "function") {
      commit();
      return;
    }
    start.call(document, () => {
      flushSync(commit);
    });
  }, [snapshot.key, transitionKey]);

  return (
    <div
      className={
        tone === "subtle"
          ? "page-transition page-transition--subtle"
          : "page-transition page-transition--full"
      }
    >
      {snapshot.children}
    </div>
  );
}
