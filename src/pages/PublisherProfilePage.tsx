import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { CommunityAuthorPublic } from "../components/CommunityPostCard";
import {
  audienceShortLabel,
  parsePublicationAudience,
  parsePublicationPricing,
  pricingShortLabel,
  type PublicationAudience,
  type PublicationPricing,
} from "../lib/publication";
import { isUuid } from "../lib/isUuid";
import { supabase } from "../lib/supabaseClient";

type RpcAuthorRow = {
  id: string;
  display_name: string | null;
  publisher_rating_sum: number | null;
  publisher_rating_count: number | null;
};

type PublishedBankRow = {
  id: string;
  title: string;
  published_at: string;
  publication_audience: PublicationAudience;
  publication_pricing: PublicationPricing;
  testRatingSum: number;
  testRatingCount: number;
};

function averageRating(sum: number, count: number): number | null {
  if (count <= 0) return null;
  return sum / count;
}

export default function PublisherProfilePage() {
  const { publisherId } = useParams<{ publisherId: string }>();
  const location = useLocation();
  const { user } = useAuth();
  const [author, setAuthor] = useState<CommunityAuthorPublic | null>(null);
  const [banks, setBanks] = useState<PublishedBankRow[]>([]);
  const [myPublisherRating, setMyPublisherRating] = useState<number | null>(null);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const sb = supabase;
    if (!publisherId || !isUuid(publisherId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    if (!sb) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNotFound(false);

    const { data: rpcRows, error: rpcErr } = await sb.rpc("community_authors_for_ids", {
      target_ids: [publisherId],
    });
    if (rpcErr) {
      setError(rpcErr.message);
      setAuthor(null);
      setBanks([]);
      setLoading(false);
      return;
    }
    const row = (rpcRows ?? [])[0] as RpcAuthorRow | undefined;
    if (!row?.id) {
      setNotFound(true);
      setAuthor(null);
      setBanks([]);
      setLoading(false);
      return;
    }
    const label =
      typeof row.display_name === "string" && row.display_name.trim()
        ? row.display_name.trim()
        : "Member";
    setAuthor({
      id: row.id,
      displayName: label,
      ratingSum: typeof row.publisher_rating_sum === "number" ? row.publisher_rating_sum : 0,
      ratingCount:
        typeof row.publisher_rating_count === "number" ? row.publisher_rating_count : 0,
    });

    const { data: bankRows, error: bErr } = await sb
      .from("user_question_banks")
      .select(
        "id, title, published_at, publication_audience, publication_pricing, test_rating_sum, test_rating_count",
      )
      .eq("user_id", publisherId)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false });
    if (bErr) {
      setError(bErr.message);
      setBanks([]);
    } else {
      setBanks(
        (bankRows ?? []).map((b) => ({
          id: String(b.id),
          title: typeof b.title === "string" ? b.title : "Untitled test",
          published_at: typeof b.published_at === "string" ? b.published_at : "",
          publication_audience: parsePublicationAudience(
            (b as { publication_audience?: unknown }).publication_audience,
          ),
          publication_pricing: parsePublicationPricing(
            (b as { publication_pricing?: unknown }).publication_pricing,
          ),
          testRatingSum: typeof (b as { test_rating_sum?: unknown }).test_rating_sum === "number"
            ? (b as { test_rating_sum: number }).test_rating_sum
            : 0,
          testRatingCount:
            typeof (b as { test_rating_count?: unknown }).test_rating_count === "number"
              ? (b as { test_rating_count: number }).test_rating_count
              : 0,
        })),
      );
    }

    if (user?.id && user.id !== publisherId) {
      const { data: mine } = await sb
        .from("publisher_ratings")
        .select("rating")
        .eq("rater_user_id", user.id)
        .eq("publisher_user_id", publisherId)
        .maybeSingle();
      const rt = (mine as { rating?: number } | null)?.rating;
      setMyPublisherRating(typeof rt === "number" ? rt : null);
    } else {
      setMyPublisherRating(null);
    }

    setLoading(false);
  }, [publisherId, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setPublisherRating(rating: number) {
    if (!supabase || !user?.id || !publisherId || user.id === publisherId) return;
    setRatingBusy(true);
    setError(null);
    const { error: upErr } = await supabase.from("publisher_ratings").upsert(
      {
        rater_user_id: user.id,
        publisher_user_id: publisherId,
        rating,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "rater_user_id,publisher_user_id" },
    );
    setRatingBusy(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setMyPublisherRating(rating);
    const { data: refreshed } = await supabase.rpc("community_authors_for_ids", {
      target_ids: [publisherId],
    });
    const r = (refreshed ?? [])[0] as RpcAuthorRow | undefined;
    if (r?.id) {
      const label =
        typeof r.display_name === "string" && r.display_name.trim()
          ? r.display_name.trim()
          : "Member";
      setAuthor({
        id: r.id,
        displayName: label,
        ratingSum: typeof r.publisher_rating_sum === "number" ? r.publisher_rating_sum : 0,
        ratingCount:
          typeof r.publisher_rating_count === "number" ? r.publisher_rating_count : 0,
      });
    }
  }

  const isOwn = Boolean(user?.id && publisherId && user.id === publisherId);
  const pubAvg = author ? averageRating(author.ratingSum, author.ratingCount) : null;

  if (loading) {
    return (
      <main className="page page-dashboard page-publisher-profile">
        <div className="admin-state admin-state--loading custom-tests-loading">
          <div className="spinner" aria-hidden />
          <p className="muted">Loading publisher…</p>
        </div>
      </main>
    );
  }

  if (notFound || !publisherId) {
    return (
      <main className="page page-dashboard page-publisher-profile">
        <header className="page-header">
          <h1 className="page-title">Publisher not found</h1>
          <p className="lead muted">
            This member has no Community posts you can view, or the link is invalid.
          </p>
          <Link to="/community" className="btn">
            Back to Community
          </Link>
        </header>
      </main>
    );
  }

  return (
    <main className="page page-dashboard page-publisher-profile">
      <header className="page-header">
        <p className="eyebrow">Community</p>
        <h1 className="page-title">{author?.displayName ?? "Publisher"}</h1>
        <p className="lead lead--compact">
          Published tests and publisher reputation. Rate them here after you have tried their
          material — not on the feed.
        </p>
      </header>

      {error ? <p className="auth-error">{error}</p> : null}

      <section className="card publisher-profile-hero">
        <div className="publisher-profile-hero-top">
          <div className="publisher-profile-avatar" aria-hidden>
            {(author?.displayName ?? "?").charAt(0).toUpperCase()}
          </div>
          <div className="publisher-profile-hero-meta">
            <h2 className="publisher-profile-name">{author?.displayName}</h2>
            <div className="publisher-profile-rating-line muted" aria-label="Publisher rating">
              {pubAvg !== null ? (
                <>
                  <span className="publisher-profile-stars" aria-hidden>
                    {Array.from({ length: 5 }, (_, i) => (
                      <span
                        key={i}
                        className={
                          "community-post-star" +
                          (i < Math.round(pubAvg) ? " community-post-star--on" : "")
                        }
                      >
                        ★
                      </span>
                    ))}
                  </span>
                  <span>
                    {pubAvg.toFixed(1)} from {author?.ratingCount ?? 0}{" "}
                    {author?.ratingCount === 1 ? "rating" : "ratings"}
                  </span>
                </>
              ) : (
                <span>No publisher ratings yet</span>
              )}
            </div>
          </div>
        </div>

        {!isOwn && user?.id ? (
          <div className="publisher-profile-rate">
            <span className="community-thread-rate-label muted">
              {myPublisherRating ? "Your rating" : "Rate this publisher"}
            </span>
            <div className="community-thread-rate-stars" role="group" aria-label="Choose 1 to 5 stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={
                    "community-thread-rate-btn" +
                    (myPublisherRating && n <= myPublisherRating ? " community-thread-rate-btn--on" : "")
                  }
                  disabled={ratingBusy}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  onClick={() => void setPublisherRating(n)}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
        ) : isOwn ? (
          <p className="muted publisher-profile-own-hint">This is your publisher profile.</p>
        ) : (
          <p className="muted publisher-profile-own-hint">
            <Link to="/auth/login">Sign in</Link> to rate this publisher.
          </p>
        )}
      </section>

      <section className="card publisher-profile-tests" aria-labelledby="publisher-tests-heading">
        <h2 id="publisher-tests-heading" className="publisher-profile-section-title">
          Published tests
        </h2>
        {banks.length === 0 ? (
          <p className="muted">No visible listings.</p>
        ) : (
          <ul className="publisher-profile-test-list">
            {banks.map((b) => {
              const tAvg = averageRating(b.testRatingSum, b.testRatingCount);
              return (
                <li key={b.id} className="publisher-profile-test-row">
                  <div className="publisher-profile-test-main">
                    <span className="publisher-profile-test-title">{b.title}</span>
                    <span className="muted publisher-profile-test-meta">
                      {audienceShortLabel(b.publication_audience)}
                      <span aria-hidden> · </span>
                      {pricingShortLabel(b.publication_pricing)}
                      {b.published_at ? (
                        <>
                          <span aria-hidden> · </span>
                          Listed {new Date(b.published_at).toLocaleDateString()}
                        </>
                      ) : null}
                    </span>
                    <span className="muted publisher-profile-test-rating">
                      {tAvg !== null
                        ? `Test rating ${tAvg.toFixed(1)} (${b.testRatingCount} ${
                            b.testRatingCount === 1 ? "rating" : "ratings"
                          })`
                        : "No test ratings yet"}
                    </span>
                  </div>
                  <div className="publisher-profile-test-actions">
                    <Link
                      to={`/my-banks/${b.id}/practice`}
                      state={{ from: location.pathname }}
                      className="btn btn-compact"
                    >
                      Practice
                    </Link>
                    <Link
                      to="/community"
                      state={{ from: location.pathname }}
                      className="btn btn-tertiary btn-compact"
                    >
                      View on Community
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="muted publisher-profile-back">
        <Link to="/community" state={{ from: location.pathname }}>
          ← Community
        </Link>
      </p>
    </main>
  );
}
