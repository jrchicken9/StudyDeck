import type { ReactNode } from "react";

export type ConfirmModalProps = {
  open: boolean;
  title: string;
  titleId: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Primary action: default uses accent button; danger uses destructive styling */
  confirmVariant?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmModal({
  open,
  title,
  titleId,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onCancel}
    >
      <div className="modal-panel card confirm-modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        <div className="confirm-modal-body lead lead--compact">{description}</div>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={confirmVariant === "danger" ? "btn btn-confirm-danger" : "btn"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
