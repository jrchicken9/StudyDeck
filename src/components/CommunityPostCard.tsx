import { Link } from "react-router-dom";
import type { PublicationAudience, PublicationPricing } from "../lib/publication";

export type CommunityPost = {
  id: string;
  title: string;
  published_at: string;
  user_id: string;
  question_count: number;
  publication_audience: PublicationAudience;
  publication_pricing: PublicationPricing;
  publication_description: string | null;
};

export type CommunityAuthorPublic = {
  id: string;
  displayName: string;
  ratingSum: number;
  ratingCount: number;
};

function monogramFromName(name: string): string {
  const s = name.trim();
  if (!s) return "?";
  return s.charAt(0).toUpperCase();
}

function averageRating(sum: number, count: number): number | null {
  if (count <= 0) return null;
  return sum / count;
}

function StarRow({ value, max = 5 }: { value: number; max?: number }) {
  const filled = Math.min(max, Math.max(0, Math.round(value)));
  return (
    <span className="community-post-star-row" aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={"community-post-star" + (i < filled ? " community-post-star--on" : "")}
        >
          ★
        </span>
      ))}
    </span>
  );
}

type Props = {
  post: CommunityPost;
  author: CommunityAuthorPublic | null;
  myRating: number | null;
  viewerId: string | undefined;
  inLibrary: boolean;
  busyId: string | null;
  pathname: string;
  onAddToMyTests: (bankId: string) => void;
  onSetPublisherRating: (publisherUserId: string, rating: number) => Promise<void>;
  ratingBusyPublisherId: string | null;
};

export default function CommunityPostCard({
  post: p,
  author,
  myRating,
  viewerId,
  inLibrary,
  busyId,
  pathname,
  onAddToMyTests,
  onSetPublisherRating,
  ratingBusyPublisherId,
}: Props) {
  const isOwn = Boolean(viewerId && p.user_id === viewerId);
  const displayName = author?.displayName ?? "Member";
  const avg = author ? averageRating(author.ratingSum, author.ratingCount) : null;
  const publishedLabel = p.published_at
    ? new Date(p.published_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  const linkState = { from: pathname };

  return (
    <article className="community-thread-card card">
      <header className="community-thread-header">
        <div className="community-thread-avatar" aria-hidden title={displayName}>
          {monogramFromName(displayName)}
        </div>
        <div className="community-thread-header-text">
          <div className="community-thread-name-row">
            <span className="community-thread-author">{displayName}</span>
            {isOwn ? (
              <span className="community-thread-you-pill">You</span>
            ) : null}
          </div>
          <div className="community-thread-sub muted">
            <time dateTime={p.published_at}>{publishedLabel}</time>
            <span className="community-thread-dot" aria-hidden>
              ·
            </span>
            <span>Publisher</span>
          </div>
          <div className="community-thread-rating-block" aria-label="Publisher rating">
            {avg !== null ? (
              <>
                <StarRow value={avg} />
                <span className="community-thread-rating-meta muted">
                  {avg.toFixed(1)} · {author?.ratingCount ?? 0}{" "}
                  {author?.ratingCount === 1 ? "rating" : "ratings"}
                </span>
              </>
            ) : (
              <span className="muted community-thread-rating-meta">No ratings yet</span>
            )}
          </div>
        </div>
      </header>

      <div className="community-thread-body">
        <h2 className="community-thread-title">{p.title}</h2>
        {p.publication_description?.trim() ? (
          <p className="community-thread-description">{p.publication_description.trim()}</p>
        ) : (
          <p className="community-thread-description community-thread-description--empty muted">
            No description was added for this listing.
          </p>
        )}
        <div className="community-thread-stats muted">
          <span>{p.question_count} question{p.question_count === 1 ? "" : "s"} in pool</span>
        </div>
      </div>

      <div className="community-thread-tags">
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

      {!isOwn && viewerId ? (
        <div className="community-thread-rate">
          <span className="community-thread-rate-label muted">
            {myRating ? "Your rating" : "Rate this publisher"}
          </span>
          <div className="community-thread-rate-stars" role="group" aria-label="Choose 1 to 5 stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={
                  "community-thread-rate-btn" +
                  (myRating && n <= myRating ? " community-thread-rate-btn--on" : "")
                }
                disabled={ratingBusyPublisherId === p.user_id}
                aria-pressed={myRating === n ? true : myRating ? n <= myRating : undefined}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                onClick={() => void onSetPublisherRating(p.user_id, n)}
              >
                ★
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <footer className="community-thread-footer">
        <div className="community-thread-actions">
          {isOwn ? (
            <>
              <span className="community-post-badge">Your test</span>
              <Link to={`/my-banks/${p.id}`} state={linkState} className="btn btn-tertiary btn-compact">
                Edit in Work Shop
              </Link>
              {p.question_count > 0 ? (
                <Link to={`/my-banks/${p.id}/practice`} state={linkState} className="btn btn-compact">
                  Practice
                </Link>
              ) : null}
            </>
          ) : inLibrary ? (
            <>
              <span className="community-post-badge community-post-badge--ok">In My Tests</span>
              {p.question_count > 0 ? (
                <Link to={`/my-banks/${p.id}/practice`} state={linkState} className="btn btn-compact">
                  Practice
                </Link>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className="btn btn-compact"
              disabled={busyId === p.id || p.question_count === 0 || !viewerId}
              title={
                !viewerId
                  ? "Sign in to add community tests."
                  : p.question_count === 0
                    ? "This test has no questions yet."
                    : undefined
              }
              onClick={() => void onAddToMyTests(p.id)}
            >
              {busyId === p.id ? "Adding…" : "Add to My Tests"}
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}
