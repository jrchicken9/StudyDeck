import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ConfirmModal from "../components/ConfirmModal";
import PublishTestModal, { type PublishTestModalBank } from "../components/PublishTestModal";
import ReturnNavButton from "../components/ReturnNavButton";
import { formatEditedAt } from "../lib/formatEditedAt";
import {
  parsePublicationAudience,
  parsePublicationPricing,
  type PublicationAudience,
  type PublicationPricing,
} from "../lib/publication";
import { supabase } from "../lib/supabaseClient";

type BankRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  question_count: number;
  published_at: string | null;
  publication_audience: PublicationAudience;
  publication_pricing: PublicationPricing;
};

type SortKey = "updated" | "title" | "questions";

function monogramFromTitle(title: string): string {
  const s = title.trim();
  if (!s) return "?";
  return s.charAt(0).toUpperCase();
}

function parseQuestionCountFromRow(r: Record<string, unknown>): number {
  const nested = r.user_questions;
  if (Array.isArray(nested) && nested[0] && typeof nested[0] === "object") {
    const c = (nested[0] as { count?: number }).count;
    return typeof c === "number" ? c : 0;
  }
  return 0;
}

export default function MyBanksPage() {
  const location = useLocation();
  const [rows, setRows] = useState<BankRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<BankRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteInFlightRef = useRef(false);
  const [publishBank, setPublishBank] = useState<PublishTestModalBank | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");

  const load = useCallback(async () => {
    const sb = supabase;
    if (!sb) {
      setError("Supabase is not configured.");
      setRows([]);
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    const { data: bankRows, error: bErr } = await sb
      .from("user_question_banks")
      .select(
        "id, title, created_at, updated_at, published_at, publication_audience, publication_pricing, user_questions(count)",
      )
      .order("updated_at", { ascending: false });
    if (bErr) {
      setError(bErr.message);
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(
      (bankRows ?? []).map((b) => ({
        id: String(b.id),
        title: typeof b.title === "string" ? b.title : "Untitled test",
        created_at: String(b.created_at ?? ""),
        updated_at:
          typeof b.updated_at === "string" ? b.updated_at : String(b.created_at ?? ""),
        question_count: parseQuestionCountFromRow(b as Record<string, unknown>),
        published_at:
          b.published_at !== null && b.published_at !== undefined
            ? String(b.published_at)
            : null,
        publication_audience: parsePublicationAudience(
          (b as { publication_audience?: unknown }).publication_audience,
        ),
        publication_pricing: parsePublicationPricing(
          (b as { publication_pricing?: unknown }).publication_pricing,
        ),
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const total = rows.length;
    const published = rows.filter((r) => r.published_at).length;
    const ready = rows.filter((r) => r.question_count > 0).length;
    return { total, published, ready };
  }, [rows]);

  const displayedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = q
      ? rows.filter((r) => r.title.toLowerCase().includes(q))
      : [...rows];
    list.sort((a, b) => {
      if (sortKey === "title") {
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      }
      if (sortKey === "questions") {
        return b.question_count - a.question_count || a.title.localeCompare(b.title);
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return list;
  }, [rows, searchQuery, sortKey]);

  async function confirmDeleteBankFromList() {
    const sb = supabase;
    if (!deleteTarget || !sb || deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    setDeleting(true);
    setError(null);
    const { error: delErr } = await sb.from("user_question_banks").delete().eq("id", deleteTarget.id);
    setDeleting(false);
    deleteInFlightRef.current = false;
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setDeleteTarget(null);
    await load();
  }

  return (
    <main className="page page-my-banks page-custom-tests">
      <ReturnNavButton fallbackTo="/community" className="custom-tests-page-nav" />

      <header className="custom-tests-hero card">
        <p className="eyebrow custom-tests-eyebrow">Work Shop</p>
        <h1 className="page-title custom-tests-page-title">Your tests</h1>
        <p className="lead lead--compact custom-tests-lead">
          Build multiple-choice banks, run timed or untimed practice, then{" "}
          <strong>Publish</strong> from a card to share on{" "}
          <Link to="/community" state={{ from: location.pathname }}>
            Community
          </Link>
          .
        </p>
        <div className="my-banks-toolbar my-banks-toolbar--hero">
          <Link to="/my-banks/new" className="btn my-banks-create-primary">
            + Create new test
          </Link>
          <Link
            to="/community"
            state={{ from: location.pathname }}
            className="btn btn-ghost btn-compact my-banks-toolbar-secondary"
          >
            Browse Community
          </Link>
        </div>
      </header>

      {error ? <p className="auth-error custom-tests-error">{error}</p> : null}

      {loading ? (
        <div className="my-banks-skeleton-wrap" aria-busy="true" aria-label="Loading your tests">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="my-banks-skeleton-row card">
              <div className="my-banks-skeleton-accent" />
              <div className="my-banks-skeleton-body">
                <div className="my-banks-skeleton-circle" />
                <div className="my-banks-skeleton-lines">
                  <div className="my-banks-skeleton-line my-banks-skeleton-line--title" />
                  <div className="my-banks-skeleton-line my-banks-skeleton-line--meta" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="custom-tests-empty card my-banks-empty-enhanced">
          <div className="custom-tests-empty-icon" aria-hidden />
          <p className="custom-tests-empty-title">Start your first test</p>
          <p className="custom-tests-empty-desc muted">
            You will name the test, add A–B–C questions in the editor, then use <strong>Run test</strong> for
            instant feedback—same flow as official exams.
          </p>
          <div className="my-banks-empty-actions">
            <Link to="/my-banks/new" className="btn">
              Create new test
            </Link>
            <Link
              to="/community"
              state={{ from: location.pathname }}
              className="btn secondary"
            >
              See what others published
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className="card my-banks-control-bar" aria-label="Find and sort tests">
            <div className="my-banks-control-stats" role="status">
              <span className="my-banks-stat">
                <strong>{stats.total}</strong> test{stats.total === 1 ? "" : "s"}
              </span>
              <span className="my-banks-stat my-banks-stat--muted">
                {stats.ready} ready to run
              </span>
              <span className="my-banks-stat my-banks-stat--muted">
                {stats.published} on Community
              </span>
            </div>
            <div className="my-banks-control-fields">
              <label className="my-banks-field my-banks-field--grow">
                <span className="my-banks-field-label">Search</span>
                <input
                  type="search"
                  className="input my-banks-search-input"
                  placeholder="Filter by test name…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="my-banks-field">
                <span className="my-banks-field-label">Sort</span>
                <select
                  className="input my-banks-sort-select"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                >
                  <option value="updated">Last edited</option>
                  <option value="title">Title A–Z</option>
                  <option value="questions">Most questions</option>
                </select>
              </label>
            </div>
          </section>

          {displayedRows.length === 0 ? (
            <div className="card my-banks-no-match">
              <p className="my-banks-no-match-title">No matches</p>
              <p className="muted my-banks-no-match-desc">
                Nothing named &ldquo;{searchQuery.trim()}&rdquo;. Try another search or{" "}
                <button type="button" className="btn-link-inline" onClick={() => setSearchQuery("")}>
                  clear the filter
                </button>
                .
              </p>
            </div>
          ) : (
            <ul className="my-banks-list">
              {displayedRows.map((r) => {
                const ready = r.question_count > 0;
                return (
                  <li key={r.id} className="my-banks-row card">
                    <div className="my-banks-row-accent" aria-hidden />
                    <div className="my-banks-row-inner">
                      <div className="my-banks-row-body">
                        <div className="my-banks-avatar" aria-hidden title={r.title}>
                          {monogramFromTitle(r.title)}
                        </div>
                        <div className="my-banks-row-main">
                          <span className="my-banks-title">{r.title}</span>
                          <span className="muted my-banks-meta">
                            Edited {formatEditedAt(r.updated_at)}
                            {r.published_at ? (
                              <>
                                {" "}
                                <span
                                  className="my-banks-published-pill"
                                  title="Listed on Community (subject to audience)"
                                >
                                  Published
                                  {r.publication_audience === "friends" ? " · Friends" : ""}
                                  {r.publication_pricing === "paid" ? " · Paid" : ""}
                                </span>
                              </>
                            ) : null}
                          </span>
                          <p
                            className={
                              "my-banks-status-hint" +
                              (ready ? " my-banks-status-hint--ready" : " my-banks-status-hint--draft")
                            }
                          >
                            {ready
                              ? `${r.question_count} question${r.question_count === 1 ? "" : "s"} in the pool — run or publish anytime.`
                              : "Add questions in the editor before you can run or publish this test."}
                          </p>
                        </div>
                        <span
                          className={
                            "my-banks-count-pill" +
                            (ready ? "" : " my-banks-count-pill--empty")
                          }
                          title="Questions in pool"
                        >
                          {r.question_count} Q
                        </span>
                      </div>
                      <div className="my-banks-row-actions">
                        {ready ? (
                          <Link
                            to={`/my-banks/${r.id}/practice`}
                            state={{ from: location.pathname }}
                            className="btn btn-accent-cool my-banks-run-btn"
                          >
                            Run test
                          </Link>
                        ) : (
                          <span
                            className="btn btn-accent-cool my-banks-run-btn my-banks-run-btn--disabled"
                            title="Add questions in the editor first"
                          >
                            Run test
                          </span>
                        )}
                        <Link
                          to={`/my-banks/${r.id}`}
                          state={{ from: location.pathname }}
                          className="btn secondary btn-compact"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact"
                          onClick={() =>
                            setPublishBank({
                              id: r.id,
                              title: r.title,
                              question_count: r.question_count,
                              published_at: r.published_at,
                              publication_audience: r.publication_audience,
                              publication_pricing: r.publication_pricing,
                            })
                          }
                        >
                          {r.published_at ? "Publication…" : "Publish"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact my-banks-row-delete"
                          disabled={deleting}
                          aria-label={`Delete ${r.title}`}
                          onClick={() => setDeleteTarget(r)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <PublishTestModal
        open={publishBank !== null}
        bank={publishBank}
        onClose={() => setPublishBank(null)}
        onSaved={() => void load()}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        titleId="my-banks-delete-test-title"
        title="Delete this test?"
        description={
          deleteTarget ? (
            <>
              <span className="text-emphasis">{deleteTarget.title}</span> and all of its questions will be removed.
              This cannot be undone.
            </>
          ) : null
        }
        cancelLabel="Cancel"
        confirmLabel={deleting ? "Deleting…" : "Delete test"}
        confirmVariant="danger"
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDeleteBankFromList()}
      />
    </main>
  );
}
