import { useEffect, useState } from "react";
import {
  type PublicationAudience,
  type PublicationPricing,
  parsePublicationAudience,
  parsePublicationPricing,
} from "../lib/publication";
import { supabase } from "../lib/supabaseClient";

export type PublishTestModalBank = {
  id: string;
  title: string;
  question_count: number;
  published_at: string | null;
  publication_audience: PublicationAudience;
  publication_pricing: PublicationPricing;
};

type Props = {
  open: boolean;
  bank: PublishTestModalBank | null;
  onClose: () => void;
  onSaved: () => void;
};

export default function PublishTestModal({ open, bank, onClose, onSaved }: Props) {
  const [audience, setAudience] = useState<PublicationAudience>("everyone");
  const [pricing, setPricing] = useState<PublicationPricing>("free");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !bank) return;
    setAudience(parsePublicationAudience(bank.publication_audience));
    setPricing(parsePublicationPricing(bank.publication_pricing));
    setError(null);
  }, [open, bank]);

  if (!open || !bank) return null;

  const row = bank;
  const isPublished = Boolean(row.published_at);
  const canPublish = row.question_count > 0;

  async function handlePublishOrUpdate() {
    if (!supabase || !canPublish) return;
    setBusy(true);
    setError(null);
    const publishedAt = isPublished ? row.published_at : new Date().toISOString();
    const { error: uErr } = await supabase
      .from("user_question_banks")
      .update({
        published_at: publishedAt,
        publication_audience: audience,
        publication_pricing: pricing,
      })
      .eq("id", row.id);
    setBusy(false);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    onSaved();
    onClose();
  }

  async function handleUnpublish() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: uErr } = await supabase
      .from("user_question_banks")
      .update({ published_at: null })
      .eq("id", row.id);
    setBusy(false);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-test-modal-title"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-panel card publish-test-modal" onClick={(e) => e.stopPropagation()}>
        <h2 id="publish-test-modal-title" className="modal-title">
          {isPublished ? "Publication settings" : "Publish to Community"}
        </h2>
        <p className="muted publish-test-modal-lead">
          <span className="text-emphasis">{row.title}</span>
          {!canPublish ? (
            <> — add questions in the editor before publishing.</>
          ) : null}
        </p>

        <fieldset className="publish-test-fieldset" disabled={!canPublish || busy}>
          <legend className="publish-test-legend">Audience</legend>
          <label className="publish-test-radio">
            <input
              type="radio"
              name="pub-audience"
              checked={audience === "everyone"}
              onChange={() => setAudience("everyone")}
            />
            <span>
              <strong>Everyone</strong>
              <span className="muted publish-test-radio-hint">
                Any signed-in learner can see this test on Community and add it to My Tests.
              </span>
            </span>
          </label>
          <label className="publish-test-radio">
            <input
              type="radio"
              name="pub-audience"
              checked={audience === "friends"}
              onChange={() => setAudience("friends")}
            />
            <span>
              <strong>Friends only</strong>
              <span className="muted publish-test-radio-hint">
                Only you and people you are connected with as friends can see and add this test.
                Friend connections will be manageable in a future update.
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset className="publish-test-fieldset" disabled={!canPublish || busy}>
          <legend className="publish-test-legend">Pricing</legend>
          <label className="publish-test-radio">
            <input
              type="radio"
              name="pub-pricing"
              checked={pricing === "free"}
              onChange={() => setPricing("free")}
            />
            <span>
              <strong>Free</strong>
              <span className="muted publish-test-radio-hint">No charge to take this test.</span>
            </span>
          </label>
          <label className="publish-test-radio">
            <input
              type="radio"
              name="pub-pricing"
              checked={pricing === "paid"}
              onChange={() => setPricing("paid")}
            />
            <span>
              <strong>Paid</strong>
              <span className="muted publish-test-radio-hint">
                Reserved for a future release — checkout and access control are not enforced yet; learners
                can still open the test for now.
              </span>
            </span>
          </label>
        </fieldset>

        {error ? <p className="auth-error">{error}</p> : null}

        <div className="modal-actions publish-test-modal-actions">
          <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {isPublished ? (
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void handleUnpublish()}>
              {busy ? "Working…" : "Unpublish"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={!canPublish || busy}
            onClick={() => void handlePublishOrUpdate()}
          >
            {busy ? "Saving…" : isPublished ? "Save changes" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
