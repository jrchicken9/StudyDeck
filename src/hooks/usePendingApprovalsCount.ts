import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

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
        .select("*", { count: "exact", head: true })
        .is("approved_at", null);
      if (cancelled) return;
      if (error || c === null) setCount(0);
      else setCount(c);
    }
    void load();
    const interval = window.setInterval(() => void load(), 45_000);
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
      void db.removeChannel(channel);
    };
  }, [enabled, userId]);

  return count;
}
