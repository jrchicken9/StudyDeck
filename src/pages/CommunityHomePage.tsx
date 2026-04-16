import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ReturnNavButton from "../components/ReturnNavButton";
import { useAuth } from "../context/AuthContext";
import {
  parsePublicationAudience,
  parsePublicationPricing,
  type PublicationAudience,
  type PublicationPricing,
} from "../lib/publication";
import { supabase } from "../lib/supabaseClient";

type PostRow = {
  id: string;
  title: string;
  published_at: string;
  user_id: string;
  question_count: number;
  publication_audience: PublicationAudience;
  publication_pricing: PublicationPricing;
};

function authorLabel(first: string | null, last: string | null): string {
  const n = [first, last].filter(Boolean).join(" ").trim();
  return n || "Member";
}

export default function CommunityHomePage() {
  const location = useLocation();
  const { user } = useAuth();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [authors, setAuthors] = useState<Map<string, string>>(new Map());
  const [libraryIds, setLibraryIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabase;
    if (!sb) {
      setError("Supabase is not configured.");
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data: rows, error: pErr } = await sb
      .from("user_question_banks")
      .select("id, title, published_at, user_id, publication_audience, publication_pricing, user_questions(count)")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false });
    if (pErr) {
      setError(pErr.message);
      setPosts([]);
      setLoading(false);
      return;
    }
    const parsed: PostRow[] = (rows ?? []).map((r: Record<string, unknown>) => {
      const nested = r.user_questions;
      let qc = 0;
      if (Array.isArray(nested) && nested[0] && typeof nested[0] === "object") {
        const c = (nested[0] as { count?: number }).count;
        qc = typeof c === "number" ? c : 0;
      }
      return {
        id: String(r.id),
        title: typeof r.title === "string" ? r.title : "Untitled test",
        published_at: typeof r.published_at === "string" ? r.published_at : "",
        user_id: String(r.user_id),
        question_count: qc,
        publication_audience: parsePublicationAudience(
          (r as { publication_audience?: unknown }).publication_audience,
        ),
        publication_pricing: parsePublicationPricing(
          (r as { publication_pricing?: unknown }).publication_pricing,
        ),
      };
    });
    setPosts(parsed);
    const uids = [...new Set(parsed.map((p) => p.user_id))];
    if (uids.length) {
      const { data: profs } = await sb.from("profiles").select("id, first_name, last_name").in("id", uids);
      const map = new Map<string, string>();
      for (const pr of profs ?? []) {
        const id = typeof pr.id === "string" ? pr.id : "";
        if (!id) continue;
        map.set(
          id,
          authorLabel(
            typeof pr.first_name === "string" ? pr.first_name : null,
            typeof pr.last_name === "string" ? pr.last_name : null,
          ),
        );
      }
      setAuthors(map);
    } else {
      setAuthors(new Map());
    }
    if (user?.id) {
      const { data: lib, error: lErr } = await sb
        .from("user_community_library")
        .select("bank_id")
        .eq("user_id", user.id);
      if (!lErr) {
        setLibraryIds(new Set((lib ?? []).map((l) => String((l as { bank_id: string }).bank_id))));
      }
    } else {
      setLibraryIds(new Set());
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addToMyTests(bankId: string) {
    if (!supabase || !user?.id) return;
    setBusyId(bankId);
    setError(null);
    const { error: insErr } = await supabase.from("user_community_library").insert({
      user_id: user.id,
      bank_id: bankId,
    });
    setBusyId(null);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setLibraryIds((prev) => new Set(prev).add(bankId));
  }

  return (
    <main className="page page-dashboard page-community">
      <ReturnNavButton fallbackTo="/my-tests" className="custom-tests-page-nav" />
      <header className="page-header">
        <p className="eyebrow">StudyDeck</p>
        <h1 className="page-title">Community</h1>
        <p className="lead">
          Browse tests other learners have published from{" "}
          <Link to="/my-banks" state={{ from: location.pathname }}>
            Work Shop
          </Link>
          . Add one to{" "}
          <Link to="/my-tests" state={{ from: location.pathname }}>
            My Tests
          </Link>{" "}
          to run it like any other practice session.
        </p>
      </header>

      {error ? <p className="auth-error">{error}</p> : null}

      {loading ? (
        <div className="admin-state admin-state--loading custom-tests-loading">
          <div className="spinner" aria-hidden />
          <p className="muted">Loading community tests…</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="custom-tests-empty card">
          <p className="custom-tests-empty-title">No published tests yet</p>
          <p className="custom-tests-empty-desc muted">
            When someone publishes a test from Work Shop (audience: everyone), it will show up here.
            Friends-only posts only appear to connected friends.
          </p>
        </div>
      ) : (
        <ul className="community-feed">
          {posts.map((p) => {
            const isOwn = Boolean(user?.id && p.user_id === user.id);
            const inLibrary = libraryIds.has(p.id);
            const author = authors.get(p.user_id) ?? "Member";
            return (
              <li key={p.id} className="community-post card">
                <div className="community-post-main">
                  <span className="community-post-title">{p.title}</span>
                  <span className="muted community-post-meta">
                    {author}
                    {p.question_count > 0 ? ` · ${p.question_count} questions` : ""}
                    {p.published_at
                      ? ` · Published ${new Date(p.published_at).toLocaleDateString()}`
                      : ""}
                  </span>
                  <div className="community-post-badges">
                    {p.publication_audience === "friends" ? (
                      <span className="community-post-tag community-post-tag--friends">Friends</span>
                    ) : (
                      <span className="community-post-tag">Everyone</span>
                    )}
                    {p.publication_pricing === "paid" ? (
                      <span className="community-post-tag community-post-tag--paid">Paid</span>
                    ) : (
                      <span className="community-post-tag community-post-tag--free">Free</span>
                    )}
                  </div>
                </div>
                <div className="community-post-actions">
                  {isOwn ? (
                    <>
                      <span className="community-post-badge">Your test</span>
                      <Link
                        to={`/my-banks/${p.id}`}
                        state={{ from: location.pathname }}
                        className="btn btn-tertiary btn-compact"
                      >
                        Edit in Work Shop
                      </Link>
                      {p.question_count > 0 ? (
                        <Link
                          to={`/my-banks/${p.id}/practice`}
                          state={{ from: location.pathname }}
                          className="btn btn-compact"
                        >
                          Practice
                        </Link>
                      ) : null}
                    </>
                  ) : inLibrary ? (
                    <>
                      <span className="community-post-badge community-post-badge--ok">In My Tests</span>
                      {p.question_count > 0 ? (
                        <Link
                          to={`/my-banks/${p.id}/practice`}
                          state={{ from: location.pathname }}
                          className="btn btn-compact"
                        >
                          Practice
                        </Link>
                      ) : null}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-compact"
                      disabled={busyId === p.id || p.question_count === 0}
                      title={p.question_count === 0 ? "This test has no questions yet." : undefined}
                      onClick={() => void addToMyTests(p.id)}
                    >
                      {busyId === p.id ? "Adding…" : "Add to My Tests"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
