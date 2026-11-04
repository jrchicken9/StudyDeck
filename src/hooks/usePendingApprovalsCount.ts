import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const PENDING_COUNT_EVENT = "studydeck-pending-count";

/** Tell the top bar the queue length the approvals page just loaded. */
export function publishPendingApprovalsCount(count: number) {
  window.dispatchEvent(new CustomEvent(PENDING_COUNT_EVENT, { detail: count }));
}

/** Count of profiles awaiting approval (null approved_at). Admin-only. */
export function usePendingApprovalsCount(enabled: boolean, userId: string | undefined) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled || !userId) {
      setCount(0);
      return;
    }
    const db = supabase;
    if (!db) {
      setCount(0);
      return;
    }
    let cancelled = false;
    async function load() {
      const client = supabase;
      if (!client) return;
      const { count: c, error } = await client
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .is("approved_at", null);
      if (cancelled) return;
      if (error || c === null) setCount(0);
      else setCount(c);
    }
    void load();
    const onFocus = () => void load();
    const onCount = (event: Event) => {
      const next = (event as CustomEvent<number>).detail;
      if (typeof next === "number") setCount(next);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener(PENDING_COUNT_EVENT, onCount);
    const interval = window.setInterval(() => void load(), 15_000);
    const channel = db
      .channel(`admin-pending-approvals-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => {
          void load();
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener(PENDING_COUNT_EVENT, onCount);
      void db.removeChannel(channel);
    };
  }, [enabled, userId]);

  return count;
}
