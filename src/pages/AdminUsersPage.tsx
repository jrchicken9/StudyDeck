import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  ACCOUNT_STATUSES,
  accountStatusLabel,
  parseAccountStatus,
  type AccountStatus,
} from "../lib/accountStatus";
import { profileMatchesAdminSearch } from "../lib/adminTableSearch";
import { supabase } from "../lib/supabaseClient";

type ProfileRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  approved_at: string | null;
  account_status: string | null;
  moderation_note: string | null;
  moderation_updated_at: string | null;
  created_at: string;
};

const ACTIONS: { status: AccountStatus; label: string; variant: "danger" | "default" }[] = [
  { status: "active", label: "Restore active", variant: "default" },
  { status: "suspended", label: "Suspend access", variant: "default" },
  { status: "restricted", label: "Restrict access", variant: "default" },
  { status: "banned", label: "Ban account", variant: "danger" },
];

export default function AdminUsersPage() {
  const { user, refetchAccess } = useAuth();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  const selfId = user?.id ?? "";

  const load = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from("profiles")
      .select(
        "id, email, first_name, last_name, approved_at, account_status, moderation_note, moderation_updated_at, created_at",
      )
      .order("created_at", { ascending: false });
    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      setRows(
        (data ?? []).map((p) => ({
          id: String(p.id),
          email: typeof p.email === "string" ? p.email : null,
          first_name: typeof p.first_name === "string" ? p.first_name : null,
          last_name: typeof p.last_name === "string" ? p.last_name : null,
          approved_at: typeof p.approved_at === "string" ? p.approved_at : null,
          account_status: typeof p.account_status === "string" ? p.account_status : null,
          moderation_note: typeof p.moderation_note === "string" ? p.moderation_note : null,
          moderation_updated_at:
            typeof p.moderation_updated_at === "string" ? p.moderation_updated_at : null,
          created_at: String(p.created_at ?? ""),
        })),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of ACCOUNT_STATUSES) c[s] = 0;
    for (const r of rows) {
      const st = parseAccountStatus(r.account_status);
      c[st] = (c[st] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  const filteredRows = useMemo(
    () => rows.filter((r) => profileMatchesAdminSearch(r, search)),
    [rows, search],
  );

  async function setStatus(targetId: string, newStatus: AccountStatus, note?: string | null) {
    if (!supabase) return;
    setBusyId(targetId);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("admin_set_account_status", {
      target_id: targetId,
      new_status: newStatus,
      note: note?.trim() || null,
    });
    setBusyId(null);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    if (targetId === selfId) await refetchAccess();
    await load();
  }

  return (
    <main className="page page-admin page-admin-users">
      <header className="page-header admin-page-header">
        <p className="eyebrow admin-page-eyebrow">Directory</p>
        <h1 className="page-title">All users</h1>
        <p className="lead lead--compact">
          Change account status: <strong>Active</strong> (default), <strong>Suspend</strong> or{" "}
          <strong>Restrict</strong> (no practice banks), or <strong>Ban</strong> (sign-in only to
          the account notice screen). Optional notes are stored on the profile.
        </p>
        {!loading && rows.length > 0 ? (
          <div className="admin-search">
            <label className="admin-search-label" htmlFor="admin-users-search">
              Search users
            </label>
            <input
              id="admin-users-search"
              className="input admin-search-input"
              type="search"
              name="admin-users-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, user ID, or admin note"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
      </header>

      {error ? <p className="auth-error admin-inline-error">{error}</p> : null}

      {!loading && rows.length > 0 ? (
        <div className="admin-stat-strip" role="list" aria-label="Users by account status">
          {ACCOUNT_STATUSES.map((s) => (
            <div key={s} className="admin-stat-chip" role="listitem">
              <span className="admin-stat-chip-label">{accountStatusLabel(s)}</span>
              <span className="admin-stat-chip-value">{statusCounts[s] ?? 0}</span>
            </div>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="admin-state admin-state--loading">
          <div className="spinner" aria-hidden />
          <p className="muted">Loading profiles…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="admin-empty card">
          <p className="admin-empty-title">No profiles</p>
          <p className="admin-empty-desc muted">No rows were returned from the database.</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="admin-empty card">
          <p className="admin-empty-title">No matches</p>
          <p className="admin-empty-desc muted">
            No users match &quot;{search.trim()}&quot;. Try another name, email, ID, or note
            keyword.
          </p>
        </div>
      ) : (
        <ul className="admin-users-list">
          {filteredRows.map((r) => {
            const st = parseAccountStatus(r.account_status);
            const name =
              [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "—";
            const noteKey = r.id;
            const draft = noteDrafts[noteKey] ?? "";
            const isSelf = r.id === selfId;
            return (
              <li key={r.id} className="admin-users-row card">
                <div className="admin-users-main">
                  <div className="admin-users-topline">
                    <span className="admin-users-name">{name}</span>
                    <span className={`admin-users-status admin-users-status--${st}`}>
                      {accountStatusLabel(st)}
                    </span>
                  </div>
                  <span className="admin-users-email">{r.email ?? "—"}</span>
                  <div className="admin-users-meta-secondary">
                    <span className="muted admin-users-id" title={r.id}>
                      {r.id}
                    </span>
                    <span className="muted">
                      Joined {new Date(r.created_at).toLocaleDateString()}
                      {r.approved_at
                        ? ` · Approved ${new Date(r.approved_at).toLocaleDateString()}`
                        : " · Not approved"}
                    </span>
                  </div>
                  {r.moderation_note ? (
                    <p className="admin-users-note">Admin note: {r.moderation_note}</p>
                  ) : null}
                </div>
                <div className="admin-users-panel">
                  <p className="admin-users-panel-label">Moderation</p>
                  <label className="admin-users-note-label">
                    <span className="admin-users-field-label">Note (optional)</span>
                    <input
                      className="input admin-users-note-input"
                      type="text"
                      placeholder="Shown to the user on profile / notice"
                      value={draft}
                      onChange={(e) =>
                        setNoteDrafts((m) => ({ ...m, [noteKey]: e.target.value }))
                      }
                      disabled={busyId === r.id}
                    />
                  </label>
                  <div className="admin-users-btn-grid">
                    {ACTIONS.map((a) => (
                      <button
                        key={a.status}
                        type="button"
                        className={
                          a.variant === "danger"
                            ? "btn btn-secondary btn-compact"
                            : "btn btn-ghost btn-compact"
                        }
                        disabled={
                          busyId === r.id || (a.status === "banned" && isSelf) || st === a.status
                        }
                        title={
                          a.status === "banned" && isSelf
                            ? "You cannot ban your own account"
                            : undefined
                        }
                        onClick={() =>
                          void setStatus(r.id, a.status, draft || r.moderation_note)
                        }
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
