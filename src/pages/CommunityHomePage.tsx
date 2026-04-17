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
  testRatingSum: number;
  testRatingCount: number;
  likeCount: number;
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

function num(raw: unknown, fallback = 0): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

export default function CommunityHomePage() {
  const location = useLocation();
  const { user } = useAuth();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [authors, setAuthors] = useState<Map<string, CommunityAuthorPublic>>(new Map());
  const [likedBankIds, setLikedBankIds] = useState<Set<string>>(new Set());
  const [libraryIds, setLibraryIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [likeBusyBankId, setLikeBusyBankId] = useState<string | null>(null);

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
        "id, title, published_at, user_id, publication_audience, publication_pricing, publication_description, test_rating_sum, test_rating_count, community_like_count, user_questions(count)",
      )
      .not("published_at", "is", null)
      .order("community_like_count", { ascending: false })
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
      testRatingSum: num((r as { test_rating_sum?: unknown }).test_rating_sum, 0),
      testRatingCount: num((r as { test_rating_count?: unknown }).test_rating_count, 0),
      likeCount: num((r as { community_like_count?: unknown }).community_like_count, 0),
    }));
    setPosts(parsed);

    const uids = [...new Set(parsed.map((p) => p.user_id))];
    const bankIds = parsed.map((p) => p.id);

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
    } else {
      setAuthors(new Map());
    }

    if (user?.id && bankIds.length) {
      const { data: likes } = await sb
        .from("community_bank_likes")
        .select("bank_id")
        .eq("user_id", user.id)
        .in("bank_id", bankIds);
      setLikedBankIds(
        new Set((likes ?? []).map((x) => String((x as { bank_id: string }).bank_id))),
      );
    } else {
      setLikedBankIds(new Set());
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

  async function toggleLike(bankId: string, currentlyLiked: boolean) {
    if (!supabase || !user?.id) return;
    setLikeBusyBankId(bankId);
    setError(null);
    if (currentlyLiked) {
      const { error: delErr } = await supabase
        .from("community_bank_likes")
        .delete()
        .eq("user_id", user.id)
        .eq("bank_id", bankId);
      setLikeBusyBankId(null);
      if (delErr) {
        setError(delErr.message);
        return;
      }
      setLikedBankIds((prev) => {
        const next = new Set(prev);
        next.delete(bankId);
        return next;
      });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === bankId ? { ...p, likeCount: Math.max(0, p.likeCount - 1) } : p,
        ),
      );
    } else {
      const { error: insErr } = await supabase.from("community_bank_likes").insert({
        user_id: user.id,
        bank_id: bankId,
      });
      setLikeBusyBankId(null);
      if (insErr) {
        setError(insErr.message);
        return;
      }
      setLikedBankIds((prev) => new Set(prev).add(bankId));
      setPosts((prev) =>
        prev.map((p) => (p.id === bankId ? { ...p, likeCount: p.likeCount + 1 } : p)),
      );
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
          . Likes help popular posts rise to the top. Rate the <strong>test</strong> after you finish
          a session; rate the <strong>publisher</strong> from their profile.
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
            const post: CommunityPost = {
              id: p.id,
              title: p.title,
              published_at: p.published_at,
              user_id: p.user_id,
              question_count: p.question_count,
              publication_audience: p.publication_audience,
              publication_pricing: p.publication_pricing,
              publication_description: p.publication_description,
              testRatingSum: p.testRatingSum,
              testRatingCount: p.testRatingCount,
              likeCount: p.likeCount,
            };
            const author = authors.get(p.user_id) ?? null;
            return (
              <li key={p.id} className="community-feed-item">
                <CommunityPostCard
                  post={post}
                  author={author}
                  viewerId={user?.id}
                  inLibrary={libraryIds.has(p.id)}
                  busyId={busyId}
                  pathname={location.pathname}
                  liked={likedBankIds.has(p.id)}
                  likeBusy={likeBusyBankId === p.id}
                  onAddToMyTests={addToMyTests}
                  onToggleLike={toggleLike}
                />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
