import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  accountStatusLabel,
  parseAccountStatus,
  type AccountStatus,
} from "../lib/accountStatus";
import {
  audienceShortLabel,
  parsePublicationAudience,
  parsePublicationPricing,
  pricingShortLabel,
  type PublicationAudience,
  type PublicationPricing,
} from "../lib/publication";
import { supabase } from "../lib/supabaseClient";

type PublishedBankRow = {
  id: string;
  title: string;
  published_at: string;
  publication_audience: PublicationAudience;
  publication_pricing: PublicationPricing;
};

type ProfileRow = {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  approved_at: string | null;
  created_at: string | null;
  account_status: string | null;
  moderation_note: string | null;
  moderation_updated_at: string | null;
};

function formatMetaPhone(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const raw = meta.phone ?? meta.signup_phone;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

export default function ProfilePage() {
  const { user } = useAuth();
  const location = useLocation();
  const [row, setRow] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishedBanks, setPublishedBanks] = useState<PublishedBankRow[]>([]);
  const [publishedLoading, setPublishedLoading] = useState(false);
  const [publishedError, setPublishedError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id || !supabase) {
      setLoading(false);
      setRow(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: qErr } = await supabase
        .from("profiles")
        .select(
          "email, first_name, last_name, approved_at, created_at, account_status, moderation_note, moderation_updated_at",
        )
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (qErr) {
        setError(qErr.message);
        setRow(null);
      } else if (data) {
        setRow({
          email: typeof data.email === "string" ? data.email : null,
          first_name: typeof data.first_name === "string" ? data.first_name : null,
          last_name: typeof data.last_name === "string" ? data.last_name : null,
          approved_at: typeof data.approved_at === "string" ? data.approved_at : null,
          created_at: typeof data.created_at === "string" ? data.created_at : null,
          account_status: typeof data.account_status === "string" ? data.account_status : null,
          moderation_note: typeof data.moderation_note === "string" ? data.moderation_note : null,
          moderation_updated_at:
            typeof data.moderation_updated_at === "string"
              ? data.moderation_updated_at
              : null,
        });
      } else {
        setRow(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !supabase) {
      setPublishedBanks([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setPublishedLoading(true);
      setPublishedError(null);
      const { data, error: pErr } = await supabase
        .from("user_question_banks")
        .select("id, title, published_at, publication_audience, publication_pricing")
        .eq("user_id", user.id)
        .not("published_at", "is", null)
        .order("published_at", { ascending: false });
      if (cancelled) return;
      if (pErr) {
        setPublishedError(pErr.message);
        setPublishedBanks([]);
      } else {
        setPublishedBanks(
          (data ?? [])
            .map((b) => ({
              id: String(b.id),
              title: typeof b.title === "string" ? b.title : "Untitled test",
              published_at: typeof b.published_at === "string" ? b.published_at : "",
              publication_audience: parsePublicationAudience(
                (b as { publication_audience?: unknown }).publication_audience,
              ),
              publication_pricing: parsePublicationPricing(
                (b as { publication_pricing?: unknown }).publication_pricing,
              ),
            }))
            .filter((b) => b.published_at.length > 0),
        );
      }
      setPublishedLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const meta = user?.user_metadata as Record<string, unknown> | undefined;
  const metaPhone = formatMetaPhone(meta);
  const nameFromProfile = [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim();
  const nameFromMeta = [
    typeof meta?.first_name === "string" ? meta.first_name.trim() : "",
    typeof meta?.last_name === "string" ? meta.last_name.trim() : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const displayName = nameFromProfile || nameFromMeta || null;
  const accessStatus: AccountStatus = parseAccountStatus(row?.account_status);

  const accountEmail = row?.email ?? user?.email ?? null;
  const accountPhone = user?.phone ?? metaPhone;

  return (
    <main className="page page-profile">
      <header className="page-header">
        <p className="eyebrow">Account</p>
        <h1 className="page-title">My profile</h1>
        <p className="lead lead--compact">
          Your sign-in details, access status, and tests you have published to the community.
          Password and email changes are handled outside this app (for example in your account
          provider settings).
        </p>
      </header>

      {error ? <p className="auth-error">{error}</p> : null}

      {loading ? (
        <div className="page--centered profile-loading">
          <div className="spinner" aria-hidden />
          <p className="muted">Loading profile…</p>
        </div>
      ) : (
        <div className="card profile-card">
          <h2 className="profile-card-kicker">Profile</h2>
          <dl className="profile-dl">
            <div className="profile-dl-row">
              <dt>Name</dt>
              <dd>{displayName ?? "—"}</dd>
            </div>
            <div className="profile-dl-row">
              <dt>Email</dt>
              <dd>{accountEmail ?? "—"}</dd>
            </div>
            {accountPhone ? (
              <div className="profile-dl-row">
                <dt>Phone</dt>
                <dd>{accountPhone}</dd>
              </div>
            ) : null}
            <div className="profile-dl-row">
              <dt>Site Access</dt>
              <dd>
                {row?.approved_at ? (
                  <span className="profile-status profile-status--ok">Approved</span>
                ) : (
                  <span className="profile-status profile-status--pending">
                    Awaiting administrator approval
                  </span>
                )}
                {row?.approved_at && accessStatus !== "active" ? (
                  <>
                    {" "}
                    <span
                      className={`profile-status profile-status--moderation profile-status--${accessStatus}`}
                    >
                      {accountStatusLabel(accessStatus)}
                    </span>
                  </>
                ) : null}
                {row?.moderation_note ? (
                  <span className="profile-moderation-note">
                    {" "}
                    — {row.moderation_note}
                  </span>
                ) : null}
                {row?.approved_at && accessStatus !== "active" ? (
                  <div className="profile-moderation-more">
                    <Link to="/account/moderation">Account notice →</Link>
                  </div>
                ) : null}
              </dd>
            </div>
            {row?.created_at ? (
              <div className="profile-dl-row">
                <dt>Member since</dt>
                <dd>{new Date(row.created_at).toLocaleDateString()}</dd>
              </div>
            ) : null}
            {user?.id ? (
              <div className="profile-dl-row profile-dl-row--id">
                <dt>Account ID</dt>
                <dd title={user.id}>{user.id}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      )}

      <section className="card profile-published" aria-labelledby="profile-published-heading">
        <h2 id="profile-published-heading" className="profile-card-kicker">
          Published tests
        </h2>
        <p className="muted profile-published-intro">
          Work Shop banks you have published appear here. Use <strong>Publication…</strong> on the Work
          Shop card to change audience, pricing, or unpublish.
        </p>
        {publishedError ? <p className="auth-error">{publishedError}</p> : null}
        {publishedLoading ? (
          <p className="muted">Loading published tests…</p>
        ) : publishedBanks.length === 0 ? (
          <p className="muted">You have not published any tests yet.</p>
        ) : (
          <ul className="profile-published-list">
            {publishedBanks.map((b) => (
              <li key={b.id} className="profile-published-row">
                <div>
                  <span className="profile-published-title">{b.title}</span>
                  <span className="muted profile-published-meta">
                    Published {new Date(b.published_at).toLocaleDateString()}
                    {" · "}
                    {audienceShortLabel(b.publication_audience)}
                    {" · "}
                    {pricingShortLabel(b.publication_pricing)}
                  </span>
                </div>
                <Link
                  to={`/my-banks/${b.id}`}
                  state={{ from: location.pathname }}
                  className="btn btn-tertiary btn-compact"
                >
                  Open in Work Shop
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
