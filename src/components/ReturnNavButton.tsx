import { useReturnNavigation } from "../hooks/useReturnNavigation";

type Props = {
  /** When `location.state.from` and history are missing, navigate here. */
  fallbackTo: string;
  /** Used on personalized practice pages to refine the return label (e.g. back to Edit). */
  practiceBankId?: string;
  /** Defaults to shared layout class for spacing. */
  className?: string;
};

/**
 * One-tap return: prefers `state.from` on the location, then browser history,
 * then `fallbackTo`. Pair with `Link … state={{ from: location.pathname }}`
 * on inbound links.
 */
export default function ReturnNavButton({
  fallbackTo,
  practiceBankId,
  className = "page-return-nav",
}: Props) {
  const { handleReturn, returnLabel } = useReturnNavigation(fallbackTo, {
    practiceBankId,
  });

  return (
    <div className={className}>
      <button type="button" className="btn secondary btn-compact" onClick={handleReturn}>
        ← {returnLabel}
      </button>
    </div>
  );
}
