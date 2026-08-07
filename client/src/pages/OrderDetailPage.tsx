import type {
  DeliveryDto,
  InitiatePaymentResult,
  OrderDto,
  PaymentDto,
} from '@krishibid/shared';
import { Icon } from '../components/icons.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { StarPicker } from '../components/Stars.js';
import { CardSkeleton, ErrorNote, StatusBadge } from '../components/ui.js';
import { useCreateReview, useReviewableOrders } from '../lib/reviews.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { formatBdt, formatDate, formatNumber } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * Where the goods are, and who has them.
 *
 * The order status says "in transit"; this says by whose hands. When an admin dispatches a
 * platform delivery they record an agent and a number, and this is the only place that reaches
 * the two people who need it — a buyer wondering where their consignment is, and a supplier
 * wanting to know it actually left. Recording it and not showing it would have made the dispatch
 * board a private note.
 *
 * Not rendered at all for a pickup: there is no journey to report, and a card saying "you are
 * collecting this" is a card explaining a decision back to the person who made it.
 */
function DeliveryCard({ delivery }: { delivery: DeliveryDto }) {
  const { t } = useTranslation();
  const locale = currentLocale();

  if (delivery.method === 'pickup') return null;

  const dispatched = delivery.status === 'dispatched' || delivery.status === 'delivered';

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 font-bold text-brand-900">
          <Icon name="truck" className="h-5 w-5 text-brand-600" />
          {t(`delivery.method.${delivery.method}`)}
        </h2>
        <span
          className={`badge ${
            delivery.status === 'delivered'
              ? 'bg-brand-100 text-brand-800'
              : delivery.status === 'dispatched'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-amber-100 text-amber-800'
          }`}
        >
          {t(`delivery.status.${delivery.status}`)}
        </span>
      </div>

      {/* The agent, given the weight the question deserves — this is what somebody scrolled
          here to find, so it is a panel rather than another row in a list of details. */}
      {dispatched && delivery.agentName && (
        <div className="mt-3 rounded-xl bg-brand-50 p-3">
          <p className="text-xs text-brand-700">{t('delivery.carriedBy')}</p>
          <p className="mt-0.5 font-semibold text-brand-900">{delivery.agentName}</p>

          {delivery.agentPhone && (
            // A number you can ring rather than a number you must copy. On the phone this is
            // most people will open the app on, that is the difference between usable and not.
            <a
              href={`tel:${delivery.agentPhone}`}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 underline"
            >
              <Icon name="phone" className="h-4 w-4" />
              {delivery.agentPhone}
            </a>
          )}

          {delivery.trackingNote && (
            <p className="mt-2 text-sm text-brand-800">{delivery.trackingNote}</p>
          )}
          {delivery.dispatchedAt && (
            <p className="mt-2 text-xs text-brand-700">
              {t('delivery.dispatchedAt', { date: formatDate(delivery.dispatchedAt, locale) })}
            </p>
          )}
        </div>
      )}

      {delivery.status === 'awaiting_dispatch' && (
        <p className="mt-2 text-sm text-slate-600">{t('delivery.awaitingAgent')}</p>
      )}

      <dl className="mt-3 space-y-2 border-t border-brand-50 pt-3 text-sm">
        {delivery.addressLine && (
          <div>
            <dt className="text-xs text-slate-500">{t('delivery.address')}</dt>
            <dd className="text-slate-800">
              {delivery.addressLine}
              {delivery.district && `, ${delivery.district}`}
            </dd>
          </div>
        )}
        {delivery.contactPhone && (
          <div>
            <dt className="text-xs text-slate-500">{t('delivery.contactPhone')}</dt>
            <dd className="text-slate-800">{delivery.contactPhone}</dd>
          </div>
        )}
        {delivery.note && (
          <div>
            <dt className="text-xs text-slate-500">{t('delivery.note')}</dt>
            <dd className="text-slate-800">{delivery.note}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-slate-500">{t('delivery.charge')}</dt>
          <dd className="font-semibold tabular-nums text-slate-800">
            {delivery.chargePoisha > 0 ? formatBdt(delivery.chargePoisha, locale) : t('delivery.free')}
          </dd>
        </div>
        {delivery.deliveredAt && (
          <div className="flex justify-between">
            <dt className="text-slate-500">{t('delivery.deliveredAt')}</dt>
            <dd className="text-slate-800">{formatDate(delivery.deliveredAt, locale)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/**
 * Rating the supplier, on the order that earned it.
 *
 * Here rather than on a separate reviews screen because this is where the buyer already is the
 * moment they confirm delivery — the transaction is in front of them and the experience is fresh.
 * A prompt that arrives a week later on a page they have to go looking for is a prompt nobody
 * answers.
 *
 * Shown only once the order is complete, which is also what the API requires: a review is a
 * verdict on the whole transaction, and until the goods arrived the thing being judged had not
 * finished happening.
 */
function ReviewPanel({ orderId, supplierId }: { orderId: string; supplierId: string }) {
  const { t } = useTranslation();
  const pending = useReviewableOrders();
  const create = useCreateReview();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  // Absent from the pending list means it has been reviewed already — or the list has not loaded,
  // in which case showing nothing briefly beats showing a form that then vanishes.
  const reviewable = pending.data?.some((o) => o.orderId === orderId);
  if (!reviewable) {
    return pending.data ? (
      <div className="card">
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Icon name="check" className="h-4 w-4 text-brand-600" />
          {t('review.alreadyLeft')}
        </p>
        <Link
          to={`/supplier/${supplierId}`}
          className="mt-2 inline-block text-sm font-semibold text-brand-700 underline"
        >
          {t('review.viewSupplier')}
        </Link>
      </div>
    ) : null;
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-bold text-brand-900">{t('review.title')}</h2>
        <p className="mt-0.5 text-sm text-slate-600">{t('review.help')}</p>
      </div>

      <StarPicker value={rating} onChange={setRating} />

      <div>
        <label htmlFor="review-comment" className="label">
          {t('review.comment')}
        </label>
        <textarea
          id="review-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="field min-h-20"
          maxLength={600}
          placeholder={t('review.commentPlaceholder')}
        />
      </div>

      {create.isError && <ErrorNote error={create.error} />}

      <button
        type="button"
        className="btn-primary w-full"
        // A star is required; the sentence is not. Forcing a written justification for a rating
        // is how you get either no reviews or thoughtless ones.
        disabled={rating === 0 || create.isPending}
        onClick={() =>
          create.mutate({ orderId, rating, comment: comment.trim() || undefined })
        }
      >
        {create.isPending ? t('common.loading') : t('review.submit')}
      </button>
    </section>
  );
}

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const locale = currentLocale();
  const user = useAuth((s) => s.user);
  const queryClient = useQueryClient();

  const [disputeReason, setDisputeReason] = useState('');
  const [showDispute, setShowDispute] = useState(false);

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderDto>(`/orders/${id}`),
  });

  const payment = useQuery({
    queryKey: ['payment', id],
    queryFn: () => api.get<PaymentDto | null>(`/payments/order/${id}`),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['order', id] });
    void queryClient.invalidateQueries({ queryKey: ['payment', id] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  };

  /**
   * Starts checkout. On success the browser LEAVES the app for the SSLCOMMERZ hosted
   * page, so there is no success state to render here — the user comes back via
   * /payment/return.
   */
  const pay = useMutation({
    mutationFn: () => api.post<InitiatePaymentResult>('/payments/initiate', { orderId: id }),
    onSuccess: (result) => {
      window.location.href = result.gatewayUrl;
    },
  });

  const ship = useMutation({
    mutationFn: () => api.post('/orders/ship', { orderId: id }),
    onSuccess: invalidate,
  });

  const confirmDelivery = useMutation({
    mutationFn: () => api.post('/payments/confirm-delivery', { orderId: id }),
    onSuccess: invalidate,
  });

  const dispute = useMutation({
    mutationFn: () => api.post('/payments/dispute', { orderId: id, reason: disputeReason }),
    onSuccess: () => {
      setShowDispute(false);
      setDisputeReason('');
      invalidate();
    },
  });

  if (order.isLoading) return <CardSkeleton count={2} />;
  if (order.isError) return <ErrorNote error={order.error} onRetry={() => void order.refetch()} />;
  if (!order.data) return null;

  const o = order.data;
  const p = payment.data;
  const isBuyer = user?.id === o.buyerId;
  const isFarmer = user?.id === o.farmerId;

  /**
   * One line about where the money stands, rather than a coloured panel per state.
   *
   * This page had a card, then an amber box, then a blue box, then a delivery card, then the
   * actions, then the trail — six stacked containers to describe one order, each with its own
   * border fighting the others for attention. The status is one fact and now reads as one line.
   */
  const escrowNote =
    o.status === 'awaiting_payment' && o.paymentDeadline
      ? { tone: 'warn' as const, text: t('orders.payBy', { date: formatDate(o.paymentDeadline, locale) }) }
      : o.status === 'confirmed' || o.status === 'in_transit'
        ? {
            tone: 'hold' as const,
            text: isBuyer ? t('orders.escrowHelpBuyer') : t('orders.escrowHelpFarmer'),
          }
        : null;

  return (
    /**
     * Two columns on a desk, stacked on a phone.
     *
     * The left is the order as it stands and what to do about it; the right is the reference
     * material — where the goods are, and what has happened so far. Putting the action six
     * scrolls below the summary was what made this page feel like a form to fill in rather than
     * a thing to act on.
     */
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="space-y-4">
        <section className="card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-slate-900">{o.productTitle ?? o.cropSlug}</h1>
              <p className="text-sm text-slate-500">
                {formatNumber(o.quantityKg, locale)} {t('common.kg')}
              </p>
            </div>
            <StatusBadge status={o.status} label={t(`orders.status.${o.status}`)} />
          </div>

          <dl className="mt-5 space-y-1.5 border-t border-slate-100 pt-4 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-slate-500">{t('orders.amount')}</dt>
              <dd className="text-2xl font-bold tabular-nums text-brand-700">
                {formatBdt(o.agreedAmountPoisha, locale)}
              </dd>
            </div>

            {/* Suppliers see the commission split explicitly. Hiding the platform's cut until
                payout is how a marketplace loses a supplier's trust once. */}
            {isFarmer && p && (
              <>
                <div className="flex justify-between text-slate-500">
                  <dt>{t('payment.commission')}</dt>
                  <dd className="tabular-nums">− {formatBdt(p.commissionPoisha, locale)}</dd>
                </div>
                <div className="flex justify-between font-semibold text-slate-900">
                  <dt>{t('payment.youReceive')}</dt>
                  <dd className="tabular-nums">{formatBdt(p.farmerNetPoisha, locale)}</dd>
                </div>
              </>
            )}
          </dl>

          {escrowNote && (
            <p
              className={`mt-4 flex items-start gap-2 border-t border-slate-100 pt-3 text-sm ${
                escrowNote.tone === 'warn' ? 'text-amber-700' : 'text-slate-600'
              }`}
            >
              <Icon
                name="shield"
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  escrowNote.tone === 'warn' ? 'text-amber-600' : 'text-brand-600'
                }`}
              />
              <span>
                {escrowNote.text}
                {o.status === 'in_transit' && p?.autoReleaseAt && (
                  <span className="mt-0.5 block text-xs text-slate-400">
                    {t('orders.autoRelease', { date: formatDate(p.autoReleaseAt, locale) })}
                  </span>
                )}
              </span>
            </p>
          )}
        </section>

      {isBuyer && o.status === 'completed' && (
          <ReviewPanel orderId={o.id} supplierId={o.farmerId} />
        )}

        {/* ---- actions ---- */}
        <div className="space-y-2">
        {isBuyer && o.status === 'awaiting_payment' && (
          <>
            {pay.isError && <ErrorNote error={pay.error} />}
            <button
              type="button"
              onClick={() => pay.mutate()}
              className="btn-primary w-full"
              disabled={pay.isPending}
            >
              {pay.isPending ? t('payment.redirecting') : t('orders.payNow')}
            </button>
          </>
        )}

        {/* A platform delivery is not the supplier's to declare shipped — they hand it to us,
            and our agent taking it is what puts it in transit. The API refuses either way; this
            stops the supplier being shown a button whose only outcome is a refusal. */}
        {isFarmer && o.status === 'confirmed' && o.delivery.method !== 'platform' && (
          <>
            {ship.isError && <ErrorNote error={ship.error} />}
            <button
              type="button"
              onClick={() => ship.mutate()}
              className="btn-primary w-full"
              disabled={ship.isPending}
            >
              {t('orders.markShipped')}
            </button>
          </>
        )}

        {isFarmer && o.status === 'confirmed' && o.delivery.method === 'platform' && (
          <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
            <p className="text-sm font-semibold text-brand-900">{t('delivery.weCollect')}</p>
            <p className="mt-1 text-sm text-brand-800">{t('delivery.weCollectHelp')}</p>
          </div>
        )}

        {isBuyer && o.status === 'in_transit' && (
          <>
            {confirmDelivery.isError && <ErrorNote error={confirmDelivery.error} />}
            <button
              type="button"
              onClick={() => confirmDelivery.mutate()}
              className="btn-primary w-full"
              disabled={confirmDelivery.isPending}
            >
              {t('orders.confirmDelivery')}
            </button>
            <button
              type="button"
              onClick={() => setShowDispute(true)}
              className="btn-secondary w-full"
            >
              {t('orders.raiseDispute')}
            </button>
          </>
        )}
      </div>

      {showDispute && (
          <form
            className="card space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              dispute.mutate();
            }}
          >
          <label htmlFor="reason" className="label">
            {t('orders.raiseDispute')}
          </label>
          <textarea
            id="reason"
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            className="field min-h-24"
            minLength={10}
            required
          />
          {dispute.isError && <ErrorNote error={dispute.error} />}
          <div className="flex gap-2">
            <button type="submit" className="btn-danger flex-1" disabled={dispute.isPending}>
              {t('orders.raiseDispute')}
            </button>
            <button
              type="button"
              onClick={() => setShowDispute(false)}
              className="btn-secondary flex-1"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

    </div>

      {/**
       * The reference column: where the goods are, and what has happened.
       *
       * Sticky on a desk so it stays beside the action rather than scrolling away — the whole
       * point of splitting this page is that the two halves are read together.
       */}
      <aside className="space-y-4 lg:sticky lg:top-20">
        <DeliveryCard delivery={o.delivery} />

        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t('orders.history')}
          </h2>
          {/* A line down the left rather than a card per event: this is a sequence, and boxing
              each step made six things that happened look like six things to decide about. */}
          <ol className="relative space-y-4 border-l border-slate-200 pl-4">
            {o.statusHistory.map((event, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[1.3rem] top-1 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                <p className="text-sm font-medium text-slate-800">
                  {t(`orders.status.${event.status}`)}
                </p>
                <p className="text-xs text-slate-400">{formatDate(event.at, locale)}</p>
                {event.note && <p className="mt-0.5 text-xs text-slate-500">{event.note}</p>}
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}
