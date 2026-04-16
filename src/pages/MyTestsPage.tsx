import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { EXAMS } from "../data/exams";
import { supabase } from "../lib/supabaseClient";

type LibraryRow = {
  bank_id: string;
  title: string;
  added_at: string;
};

export default function MyTestsPage() {
  const location = useLocation();
  const { user } = useAuth();
  const [library, setLibrary] = useState<LibraryRow[]>([]);
  const [libLoading, setLibLoading] = useState(true);
  const [libError, setLibError] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState<string | null>(null);

  const loadLibrary = useCallback(async () => {
    const sb = supabase;
    if (!sb || !user?.id) {
      setLibrary([]);
      setLibLoading(false);
      return;
    }
    setLibLoading(true);
    setLibError(null);
    const { data, error: qErr } = await sb
      .from("user_community_library")
      .select("bank_id, added_at, user_question_banks(id, title)")
      .eq("user_id", user.id)
      .order("added_at", { ascending: false });
    if (qErr) {
      setLibError(qErr.message);
      setLibrary([]);
      setLibLoading(false);
      return;
    }
    const out: LibraryRow[] = [];
    for (const row of data ?? []) {
      const bid = typeof row.bank_id === "string" ? row.bank_id : null;
      const added = typeof row.added_at === "string" ? row.added_at : "";
      const nested = row.user_question_banks as { id?: string; title?: string } | null;
      const title =
        nested && typeof nested.title === "string" && nested.title.trim()
          ? nested.title.trim()
          : "Community test";
      if (bid) out.push({ bank_id: bid, title, added_at: added });
    }
    setLibrary(out);
    setLibLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  async function removeFromLibrary(bankId: string) {
    if (!supabase || !user?.id) return;
    setRemoveBusy(bankId);
    setLibError(null);
    const { error: dErr } = await supabase
      .from("user_community_library")
      .delete()
      .eq("user_id", user.id)
      .eq("bank_id", bankId);
    setRemoveBusy(null);
    if (dErr) {
      setLibError(dErr.message);
      return;
    }
    await loadLibrary();
  }

  return (
    <main className="page page-dashboard page-my-tests">
      <header className="page-header">
        <p className="eyebrow">Practice</p>
        <h1 className="page-title">My Tests</h1>
        <p className="lead">
          Official exams, tests you added from the{" "}
          <Link to="/community" state={{ from: location.pathname }}>
            Community
          </Link>
          , and your own banks from{" "}
          <Link to="/my-banks" state={{ from: location.pathname }}>
            Work Shop
          </Link>
          .
        </p>
      </header>

      {libError ? <p className="auth-error">{libError}</p> : null}

      <h2 className="my-tests-section-title">Official curriculum</h2>
      <ul className="exam-grid">
        {EXAMS.map((exam) => (
          <li key={exam.id}>
            <Link
              to={`/exams/${exam.id}`}
              state={{ from: location.pathname }}
              className="exam-card"
            >
              <span className="exam-card-kicker">{exam.subtitle}</span>
              <span className="exam-card-title">{exam.title}</span>
              <span className="exam-card-desc">{exam.description}</span>
              <span className="exam-card-cta">{exam.dashboardCta}</span>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="my-tests-section-title">From the community</h2>
      {libLoading ? (
        <div className="admin-state admin-state--loading custom-tests-loading">
          <div className="spinner" aria-hidden />
          <p className="muted">Loading saved tests…</p>
        </div>
      ) : library.length === 0 ? (
        <p className="muted my-tests-empty-hint">
          Nothing here yet — open{" "}
          <Link to="/community" state={{ from: location.pathname }}>
            Community
          </Link>{" "}
          and use <strong>Add to My Tests</strong> on a post you like.
        </p>
      ) : (
        <ul className="exam-grid">
          {library.map((row) => (
            <li key={row.bank_id} className="exam-grid-item-with-actions">
              <Link
                to={`/my-banks/${row.bank_id}/practice`}
                state={{ from: location.pathname }}
                className="exam-card exam-card--custom"
              >
                <span className="exam-card-kicker">Community</span>
                <span className="exam-card-title">{row.title}</span>
                <span className="exam-card-desc">
                  Added {row.added_at ? new Date(row.added_at).toLocaleDateString() : "recently"}.
                </span>
                <span className="exam-card-cta">Set up session</span>
              </Link>
              <button
                type="button"
                className="btn btn-ghost btn-compact exam-grid-remove"
                disabled={removeBusy === row.bank_id}
                onClick={() => void removeFromLibrary(row.bank_id)}
              >
                {removeBusy === row.bank_id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="my-tests-section-title">Your Work Shop tests</h2>
      <p className="muted my-tests-empty-hint">
        Banks you build live in{" "}
        <Link to="/my-banks" state={{ from: location.pathname }}>
          Work Shop
        </Link>
        . Use <strong>Run test</strong> there, or publish to Community from the test&apos;s General tab.
      </p>
    </main>
  );
}
