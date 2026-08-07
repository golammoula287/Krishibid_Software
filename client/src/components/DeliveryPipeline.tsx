import { DELIVERY_TRANSITIONS, type DeliveryDto, type DeliveryStatus } from '@krishibid/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from './icons.js';
import { ErrorNote } from './ui.js';
import { useAdvanceDelivery } from '../lib/fulfilment.js';
import { formatDate } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/** The journey, in order, with the icon and timestamp field each step owns. */
const STEPS: { status: DeliveryStatus; icon: IconName; at: keyof DeliveryDto }[] = [
  { status: 'awaiting_dispatch', icon: 'orders', at: 'dispatchedAt' },
  { status: 'collected', icon: 'sprout', at: 'collectedAt' },
  { status: 'processing', icon: 'market', at: 'processedAt' },
  { status: 'dispatched', icon: 'truck', at: 'dispatchedAt' },
  { status: 'delivered', icon: 'check', at: 'deliveredAt' },
];

/**
 * Where a consignment is, and — for an admin — the one button that moves it on.
 *
 * The same component serves both audiences on purpose. A buyer and an operations person looking
 * at the same order should see the same picture of it; giving the admin a separate control panel
 * is how the two drift until they disagree about what happened.
 *
 * Exactly one action is offered, the next legal step. A dropdown of every status would let
 * somebody mark an uncollected order delivered — which pays the supplier for goods nobody picked
 * up, since the release hangs off precisely that status.
 */
export default function DeliveryPipeline({
  orderId,
  delivery,
  canAdvance,
}: {
  orderId: string;
  delivery: DeliveryDto;
  /** True for an admin. The API enforces it too; this only decides whether to draw a button. */
  canAdvance: boolean;
}) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const advance = useAdvanceDelivery();
  const [note, setNote] = useState('');

  if (delivery.method === 'pickup' || delivery.status === 'not_required') return null;

  const currentIndex = STEPS.findIndex((s) => s.status === delivery.status);
  const next = DELIVERY_TRANSITIONS[delivery.status]?.[0];

  return (
    <section className="card">
      <h2 className="mb-4 flex items-center gap-2 font-bold text-slate-900">
        <Icon name="truck" className="h-5 w-5 text-brand-600" />
        {t('fulfil.title')}
      </h2>

      {/* A rail rather than a badge. "Dispatched" alone does not say whether collection happened
          yesterday or an hour ago, and that is most of what somebody wants to know. */}
      <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5">
        {STEPS.map((step, i) => {
          const done = i <= currentIndex;
          const at = delivery[step.at] as string | undefined;

          return (
            <li key={step.status} className="relative">
              <span
                className={`absolute -left-[1.72rem] flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white ${
                  done ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-400'
                }`}
              >
                <Icon name={step.icon} className="h-3.5 w-3.5" />
              </span>
              <p className={`text-sm font-semibold ${done ? 'text-slate-900' : 'text-slate-400'}`}>
                {t(`delivery.status.${step.status}`)}
              </p>
              {done && at && (
                <p className="text-xs text-slate-400">{formatDate(at, locale)}</p>
              )}
            </li>
          );
        })}
      </ol>

      {delivery.agentName && (
        <div className="mt-4 rounded-xl bg-brand-50 p-3">
          <p className="text-xs text-brand-700">{t('delivery.carriedBy')}</p>
          <p className="mt-0.5 font-semibold text-brand-900">{delivery.agentName}</p>
          {delivery.agentPhone && (
            <a
              href={`tel:${delivery.agentPhone}`}
              className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 underline"
            >
              <Icon name="phone" className="h-4 w-4" />
              {delivery.agentPhone}
            </a>
          )}
          {delivery.trackingNote && (
            <p className="mt-2 text-sm text-brand-800">{delivery.trackingNote}</p>
          )}
        </div>
      )}

      {canAdvance && next && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('fulfil.notePlaceholder')}
            aria-label={t('fulfil.notePlaceholder')}
            className="field"
            maxLength={300}
          />

          {advance.isError && <ErrorNote error={advance.error} />}

          <button
            type="button"
            className="btn-primary w-full"
            disabled={advance.isPending}
            onClick={() =>
              advance.mutate(
                { orderId, status: next, note: note.trim() || undefined },
                { onSuccess: () => setNote('') },
              )
            }
          >
            {advance.isPending ? t('common.loading') : t(`fulfil.action.${next}`)}
          </button>

          {/* Said before the tap, not after: this is the step that moves money. */}
          {next === 'delivered' && (
            <p className="text-center text-xs text-amber-700">{t('fulfil.releasesPayment')}</p>
          )}
        </div>
      )}
    </section>
  );
}
