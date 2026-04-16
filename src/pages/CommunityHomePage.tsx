import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import CommunityPostCard, {
  type CommunityAuthorPublic,
  type CommunityPost,
} from "../components/CommunityPostCard";
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
  publication_description: string | null;
};

type RpcAuthorRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  publisher_rating_sum: number | null;
  publisher_rating_count: number | null;
};

function authorLabel(first: string | null, last: string | null): string {
  const n = [first, last].filter(Boolean).join(" ").trim();
  return n || "Member";
}

function parseQuestionCountFromRow(r: Record<string, unknown>): number {
  const nested = r.user_questions;
  if (Array.isArray(nested) && nested[0] && typeof nested[0] === "object") {
    const c = (nested[0] as { count?: number }).count;
    return typeof c === "number" ? c : 0;
  }
  return 0;
}

export default function CommunityHomePage() {
  const location = useLocation();
  const { user } = useAuth();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [authors, setAuthors] = useState<Map<string, CommunityAuthorPublic>>(new Map());
  const [myRatings, setMyRatings] = useState<Map<string, number>>(new Map());
  const [libraryIds, setLibraryIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ratingBusyPublisherId, setRatingBusyPublisherId] = useState<string | null>(null);

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
      .select(
        "id, title, published_at, user_id, publication_audience, publication_pricing, publication_description, user_questions(count)",
      )
      .not("published_at", "is", null)
      .order("published_at", { ascending: false });
    if (pErr) {
      setError(pErr.message);
      setPosts([]);
      setLoading(false);
      return;
    }
    const parsed: PostRow[] = (rows ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      title: typeof r.title === "string" ? r.title : "Untitled test",
      published_at: typeof r.published_at === "string" ? r.published_at : "",
      user_id: String(r.user_id),
      question_count: parseQuestionCountFromRow(r),
      publication_audience: parsePublicationAudience(
        (r as { publication_audience?: unknown }).publication_audience,
      ),
      publication_pricing: parsePublicationPricing(
        (r as { publication_pricing?: unknown }).publication_pricing,
      ),
      publication_description:
        typeof (r as { publication_description?: unknown }).publication_description === "string"
          ? (r as { publication_description: string }).publication_description
          : null,
    }));
    setPosts(parsed);

    const uids = [...new Set(parsed.map((p) => p.user_id))];
    if (uids.length) {
      const { data: rpcRows, error: rpcErr } = await sb.rpc("community_authors_for_ids", {
        target_ids: uids,
      });
      if (rpcErr) {
        setError(rpcErr.message);
        setAuthors(new Map());
      } else {
        const map = new Map<string, CommunityAuthorPublic>();
        for (const row of (rpcRows ?? []) as RpcAuthorRow[]) {
          if (!row?.id) continue;
          map.set(row.id, {
            id: row.id,
            displayName: authorLabel(row.first_name, row.last_name),
            ratingSum: typeof row.publisher_rating_sum === "number" ? row.publisher_rating_sum : 0,
            ratingCount:
              typeof row.publisher_rating_count === "number" ? row.publisher_rating_count : 0,
          });
        }
        setAuthors(map);
      }

      if (user?.id) {
        const { data: mine } = await sb
          .from("publisher_ratings")
          .select("publisher_user_id, rating")
          .eq("rater_user_id", user.id)
          .in("publisher_user_id", uids);
        const rmap = new Map<string, number>();
        for (const m of mine ?? []) {
          const pid = String((m as { publisher_user_id: string }).publisher_user_id);
          const rt = (m as { rating: number }).rating;
          if (typeof rt === "number") rmap.set(pid, rt);
        }
        setMyRatings(rmap);
      } else {
        setMyRatings(new Map());
      }
    } else {
      setAuthors(new Map());
      setMyRatings(new Map());
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

  async function setPublisherRating(publisherUserId: string, rating: number) {
    if (!supabase || !user?.id || publisherUserId === user.id) return;
    setRatingBusyPublisherId(publisherUserId);
    setError(null);
    const { error: upErr } = await supabase.from("publisher_ratings").upsert(
      {
        rater_user_id: user.id,
        publisher_user_id: publisherUserId,
        rating,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "rater_user_id,publisher_user_id" },
    );
    setRatingBusyPublisherId(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setMyRatings((prev) => {
      const next = new Map(prev);
      next.set(publisherUserId, rating);
      return next;
    });
    const { data: refreshed } = await supabase.rpc("community_authors_for_ids", {
      target_ids: [publisherUserId],
    });
    const row = (refreshed ?? [])[0] as RpcAuthorRow | undefined;
    if (row?.id) {
      setAuthors((prev) => {
        const next = new Map(prev);
        next.set(row.id, {
          id: row.id,
          displayName: authorLabel(row.first_name, row.last_name),
          ratingSum: typeof row.publisher_rating_sum === "number" ? row.publisher_rating_sum : 0,
          ratingCount:
            typeof row.publisher_rating_count === "number" ? row.publisher_rating_count : 0,
        });
        return next;
      });
    }
  }

  return (
    <main className="page page-dashboard page-community">
      <header className="page-header">
        <p className="eyebrow">StudyDeck</p>
        <h1 className="page-title">Community</h1>
        <p className="lead">
          Browse tests other learners have published from{" "}
          <Link to="/my-banks" state={{ from: location.pathname }}>
            Work Shop
          </Link>
          . Each post shows who published it, what the test is about, and how other learners rate them.
          Add a test to{" "}
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
        <ul className="community-feed community-feed--threaded">
          {posts.map((p) => {
            const post: CommunityPost = { ...p };
            const author = authors.get(p.user_id) ?? null;
            return (
              <li key={p.id} className="community-feed-item">
                <CommunityPostCard
                  post={post}
                  author={author}
                  myRating={myRatings.get(p.user_id) ?? null}
                  viewerId={user?.id}
                  inLibrary={libraryIds.has(p.id)}
                  busyId={busyId}
                  pathname={location.pathname}
                  onAddToMyTests={addToMyTests}
                  onSetPublisherRating={setPublisherRating}
                  ratingBusyPublisherId={ratingBusyPublisherId}
                />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
