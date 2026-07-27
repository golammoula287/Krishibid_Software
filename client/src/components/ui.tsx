import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiRequestError } from '../lib/api.js';

export function Spinner({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-slate-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700" />
      <span className="text-sm">{label ?? t('common.loading')}</span>
    </div>
  );
}

/** Skeletons preserve layout, so the page doesn't jump when data lands. */
export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card space-y-3">
          <div className="skeleton h-5 w-2/5" />
          <div className="skeleton h-4 w-3/5" />
          <div className="skeleton h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Error display.
 *
 * Shows the server's message when it is a client error (4xx) — those messages are
 * written for users and are actionable ("your bid must exceed the current highest
 * bid"). For 5xx it shows a generic string, because an internal message is neither
 * useful nor safe to surface.
 */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();

  const message =
    error instanceof ApiRequestError && error.status < 500 ? error.message : t('common.error');

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
      <p className="text-sm font-medium text-red-800">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-3">
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, action }: { icon: string; title: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 py-10 text-center">
      <span aria-hidden className="text-4xl">
        {icon}
      </span>
      <p className="text-slate-600">{title}</p>
      {action}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  awaiting_payment: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-800',
  in_transit: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-brand-100 text-brand-800',
  disputed: 'bg-red-100 text-red-800',
  refunded: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-slate-200 text-slate-700',
  held: 'bg-blue-100 text-blue-800',
  released: 'bg-brand-100 text-brand-800',
  pending: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={`badge ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {label}
    </span>
  );
}
