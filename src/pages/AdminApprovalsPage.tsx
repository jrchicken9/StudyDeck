import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { profileMatchesAdminSearch } from "../lib/adminTableSearch";
import { publishPendingApprovalsCount } from "../hooks/usePendingApprovalsCount";
import { supabase } from "../lib/supabaseClient";

type PendingRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
};

export default function AdminApprovalsPage() {
  const { refetchAccess } = useAuth();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyId, setDenyId] = useState<string | null>(null);
  const [denyNote, setDenyNote] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from("profiles")
      .select("id, email, first_name, last_name, created_at")
      .is("approved_at", null)
      .is("access_denied_at", null)
      .order("created_at", { ascending: true });
    if (qErr) {
      setError(qErr.message);
      setRows([]);
      publishPendingApprovalsCount(0);
    } else {
      const next = (data ?? []).map((p) => ({
        id: String(p.id),
        email: typeof p.email === "string" ? p.email : null,
        first_name: typeof p.first_name === "string" ? p.first_name : null,
        last_name: typeof p.last_name === "string" ? p.last_name : null,
        created_at: String(p.created_at ?? ""),
      }));
      setRows(next);
      publishPendingApprovalsCount(next.length);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approveUser(targetId: string) {
    if (!supabase) return;
    setBusyId(targetId);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("admin_approve_profile", {
      target_id: targetId,
    });
    setBusyId(null);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    await refetchAccess();
    await load();
  }

  async function denyUser(targetId: string) {
    if (!supabase) return;
    setBusyId(targetId);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("admin_deny_profile", {
      target_id: targetId,
      note: denyNote.trim() || null,
    });
    setBusyId(null);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setDenyId(null);
    setDenyNote("");
    await load();
  }

  const filteredRows = useMemo(
    () => rows.filter((r) => profileMatchesAdminSearch(r, search)),
    [rows, search],
  );

  return (
    <main className="page page-admin">
      <header className="page-header admin-page-header">
        <p className="eyebrow admin-page-eyebrow">Pending queue</p>
        <h1 className="page-title">Accounts awaiting approval</h1>
        <p className="lead lead--compact">
          Approve access, or deny it and leave a reason or the steps to try again.
        </p>
        {!loading && rows.length > 0 ? (
          <div className="admin-search">
            <label className="admin-search-label" htmlFor="admin-approvals-search">
              Search pending accounts
            </label>
            <input
              id="admin-approvals-search"
              className="input admin-search-input"
              type="search"
              name="admin-approvals-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, or user ID"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
      </header>

      {error ? <p className="auth-error admin-inline-error">{error}</p> : null}

      {loading ? (
        <div className="admin-state admin-state--loading">
          <div className="spinner" aria-hidden />
          <p className="muted">Loading pending accounts…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="admin-empty card">
          <p className="admin-empty-title">Queue is clear</p>
          <p className="admin-empty-desc muted">
            No profiles are waiting for approval. New sign-ups will appear here automatically.
          </p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="admin-empty card">
          <p className="admin-empty-title">No matches</p>
          <p className="admin-empty-desc muted">
            Nothing in the queue matches &quot;{search.trim()}&quot;. Try another name, email, or
            ID.
          </p>
        </div>
      ) : (
        <ul className="admin-pending-list">
          {filteredRows.map((r) => (
            <li key={r.id} className="admin-pending-row card">
              <div className="admin-pending-meta">
                <span className="admin-pending-name">
                  {[r.first_name, r.last_name].filter(Boolean).join(" ").trim() ||
                    "Name not on file"}
                </span>
                <span className="admin-pending-email">
                  {r.email ?? "Email not on file"}
                </span>
                <div className="admin-pending-meta-secondary">
                  <span className="muted admin-pending-id" title={r.id}>
                    {r.id}
                  </span>
                  <span className="muted admin-pending-when">
                    Requested {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="admin-pending-action">
                {denyId === r.id ? (
                  <>
                    <label className="admin-deny-label">
                      <span className="admin-users-field-label">
                        Reason or steps to gain access
                      </span>
                      <textarea
                        className="input admin-deny-note"
                        rows={3}
                        value={denyNote}
                        placeholder="Optional. The person sees this on the access screen."
                        onChange={(e) => setDenyNote(e.target.value)}
                        disabled={busyId === r.id}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-secondary admin-pending-btn"
                      disabled={busyId === r.id}
                      onClick={() => void denyUser(r.id)}
                    >
                      {busyId === r.id ? "Denying…" : "Confirm deny"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={busyId === r.id}
                      onClick={() => {
                        setDenyId(null);
                        setDenyNote("");
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn admin-pending-btn"
                      disabled={busyId === r.id}
                      onClick={() => void approveUser(r.id)}
                    >
                      {busyId === r.id ? "Working…" : "Approve access"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary admin-pending-btn"
                      disabled={busyId === r.id}
                      onClick={() => {
                        setDenyId(r.id);
                        setDenyNote("");
                      }}
                    >
                      Deny access
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
