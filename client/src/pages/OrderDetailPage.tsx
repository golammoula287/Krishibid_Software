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

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-900">{o.cropSlug}</h1>
            <p className="text-sm text-slate-600">
              {formatNumber(o.quantityKg, locale)} {t('common.kg')}
            </p>
          </div>
          <StatusBadge status={o.status} label={t(`orders.status.${o.status}`)} />
        </div>

        <div className="mt-4 border-t border-brand-50 pt-4">
          <p className="text-xs text-slate-500">{t('orders.amount')}</p>
          <p className="text-2xl font-bold text-brand-800">
            {formatBdt(o.agreedAmountPoisha, locale)}
          </p>

          {/* Farmers see the commission split explicitly. Hiding the platform's cut
              until payout is how a marketplace loses a farmer's trust once. */}
          {isFarmer && p && (
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>{t('payment.commission')}</span>
                <span>− {formatBdt(p.commissionPoisha, locale)}</span>
              </div>
              <div className="flex justify-between font-semibold text-brand-800">
                <span>{t('payment.youReceive')}</span>
                <span>{formatBdt(p.farmerNetPoisha, locale)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---- escrow status ---- */}
      {o.status === 'awaiting_payment' && o.paymentDeadline && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            {t('orders.payBy', { date: formatDate(o.paymentDeadline, locale) })}
          </p>
        </div>
      )}

      {(o.status === 'confirmed' || o.status === 'in_transit') && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="flex items-center gap-1.5 font-semibold text-blue-900">
            <Icon name="shield" className="h-4 w-4" />
            {t('orders.escrowHeld')}
          </p>
          <p className="mt-1 text-sm text-blue-800">
            {isBuyer ? t('orders.escrowHelpBuyer') : t('orders.escrowHelpFarmer')}
          </p>
          {o.status === 'in_transit' && p?.autoReleaseAt && (
            <p className="mt-2 text-xs text-blue-700">
              {t('orders.autoRelease', { date: formatDate(p.autoReleaseAt, locale) })}
            </p>
          )}
        </div>
      )}

      <DeliveryCard delivery={o.delivery} />

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

      {/* ---- audit trail ---- */}
      <div className="card">
        <h2 className="mb-3 font-bold text-brand-900">{t('orders.title')}</h2>
        <ol className="space-y-3">
          {o.statusHistory.map((event, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {t(`orders.status.${event.status}`)}
                </p>
                <p className="text-xs text-slate-500">{formatDate(event.at, locale)}</p>
                {event.note && <p className="mt-0.5 text-xs text-slate-600">{event.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
