import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** The consequence, stated plainly. */
  body?: React.ReactNode;
  /**
   * The figure being committed to, rendered large and unmissable.
   *
   * Separate from `body` because the amount is the thing people get wrong — a mistyped
   * ৳50,000 for ৳5,000 — and burying it in a sentence is how that mistake survives a
   * confirmation step.
   */
  amount?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Blocking confirmation for irreversible actions.
 *
 * A modal rather than a toast: a toast is a non-blocking notification that disappears, which
 * is the wrong shape for a decision that must be made before proceeding. Toasts still report
 * the outcome afterwards.
 *
 * Chosen over the browser's `confirm()` because that cannot show Bangla-formatted currency in
 * a large typeface, cannot be styled for a 360px screen, and is suppressible by the browser.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  amount,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement>(null);

  /**
   * Focus lands on CANCEL, not confirm.
   *
   * Deliberate: a user who hits Enter out of habit should not commit money. The confirm button
   * has to be chosen on purpose, which is the entire point of a second step.
   */
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    // Stop the page scrolling behind the dialog on mobile.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      // Backdrop click cancels, but never while the request is in flight — dismissing
      // mid-submit would leave the user unsure whether it went through.
      onClick={() => !busy && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-bold text-slate-900">
          {title}
        </h2>

        {amount && (
          <p className="mt-3 rounded-xl bg-brand-50 py-3 text-center text-3xl font-bold tabular-nums text-brand-900">
            {amount}
          </p>
        )}

        {body && <div className="mt-3 text-sm leading-relaxed text-slate-600">{body}</div>}

        <div className="mt-5 flex flex-col gap-2">
          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={tone === 'danger' ? 'btn-danger w-full' : 'btn-primary w-full'}
          >
            {busy ? t('common.loading') : confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="btn-secondary w-full"
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
