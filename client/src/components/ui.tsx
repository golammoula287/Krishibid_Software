import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiRequestError } from '../lib/api.js';
import { hasCopyFor, resolveError } from '../lib/messages.js';
import { Icon, type IconName } from './icons.js';

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
 * Resolves through the message catalogue first, exactly as the toast does. That is the fix for a
 * real defect: this used to show a generic string for anything 5xx, so `mail_send_failed` — a
 * deliberate 503 whose copy was written for users, in two languages — rendered as "Something went
 * wrong". Someone whose signup could not send a code was told nothing at all about why.
 *
 * The original caution still holds for codes we have no words for: an unknown 5xx is an internal
 * failure, and its message is neither useful nor safe to put in front of a user. So the rule is
 * about whether copy exists, not about the status number.
 */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();

  const api = error instanceof ApiRequestError ? error : null;
  const known = api ? hasCopyFor(api.code) : false;
  const resolved = api && known ? resolveError(api.code, api.message) : null;

  const title =
    resolved?.title ?? (api && api.status < 500 ? api.message : t('common.error'));

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
      <p className="text-sm font-medium text-red-800">{title}</p>
      {/* The actionable next step, where there is one. Omitted rather than padded with
          "please try again" on a failure that retrying will not fix. */}
      {resolved?.hint && <p className="mt-1 text-sm text-red-700">{resolved.hint}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-3">
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  action,
}: {
  icon: IconName;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 py-10 text-center">
      {/* Circled and muted: an empty state should read as "nothing here yet", not as an alert. */}
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Icon name={icon} className="h-7 w-7" strokeWidth={1.5} />
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
