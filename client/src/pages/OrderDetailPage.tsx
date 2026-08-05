import type { InitiatePaymentResult, OrderDto, PaymentDto } from '@krishibid/shared';
import { Icon } from '../components/icons.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { CardSkeleton, ErrorNote, StatusBadge } from '../components/ui.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { formatBdt, formatDate, formatNumber } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

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

        {isFarmer && o.status === 'confirmed' && (
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
