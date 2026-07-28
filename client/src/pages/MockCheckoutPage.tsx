import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../lib/api.js';

/**
 * Simulated checkout.
 *
 * Stands in for the SSLCOMMERZ hosted page when the server runs with
 * `PAYMENT_MODE=mock`, so the escrow flow is demonstrable without gateway credentials.
 *
 * Deliberately styled as an obvious simulation rather than as a convincing payment page.
 * A mock checkout that looked real would be indistinguishable from a phishing screen,
 * and anyone watching a demo should be able to see at a glance that no money moved.
 */
export default function MockCheckoutPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tranId = params.get('tran') ?? '';

  const complete = useMutation({
    mutationFn: (outcome: 'success' | 'fail') =>
      api.post<{ status: string; orderId: string }>('/payments/mock/complete', {
        tranId,
        outcome,
      }),
    onSuccess: (_data, outcome) => {
      navigate(`/payment/return?outcome=${outcome === 'success' ? 'success' : 'fail'}`, {
        replace: true,
      });
    },
  });

  if (!tranId) {
    return (
      <div className="card mx-auto mt-8 max-w-md text-center">
        <p className="text-slate-700">{t('common.error')}</p>
        <button type="button" className="btn-secondary mt-4" onClick={() => navigate('/orders')}>
          {t('payment.backToOrders')}
        </button>
      </div>
    );
  }

  const error = complete.error;
  const notEnabled = error instanceof ApiRequestError && error.status === 404;

  return (
    <div className="mx-auto mt-6 max-w-md">
      {/* Unmissable banner: this is the whole point of the page's design. */}
      <div className="rounded-t-2xl border-2 border-b-0 border-dashed border-amber-500 bg-amber-100 px-4 py-3 text-center">
        <p className="text-sm font-bold uppercase tracking-wide text-amber-900">
          ⚠ {t('payment.mockBanner')}
        </p>
      </div>

      <div className="rounded-b-2xl border-2 border-dashed border-amber-500 bg-white p-5">
        <h1 className="text-lg font-bold text-slate-900">{t('payment.mockTitle')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('payment.mockHelp')}</p>

        <dl className="mt-4 space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">{t('payment.mockTranId')}</dt>
            <dd className="font-mono text-xs text-slate-700">{tranId}</dd>
          </div>
        </dl>

        {notEnabled ? (
          <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {t('payment.mockDisabled')}
          </p>
        ) : (
          error && (
            <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {error instanceof Error ? error.message : t('common.error')}
            </p>
          )
        )}

        <div className="mt-5 space-y-2">
          <button
            type="button"
            className="btn-primary w-full"
            disabled={complete.isPending}
            onClick={() => complete.mutate('success')}
          >
            {complete.isPending ? t('payment.verifying') : t('payment.mockPaySuccess')}
          </button>

          {/* Failure is a first-class button: the unhappy path is the one worth
              demonstrating, since it proves escrow is not credited on a failed payment. */}
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={complete.isPending}
            onClick={() => complete.mutate('fail')}
          >
            {t('payment.mockPayFail')}
          </button>

          <button
            type="button"
            className="btn w-full text-slate-500"
            disabled={complete.isPending}
            onClick={() => navigate('/orders')}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
