import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Spinner } from '../components/ui.js';

/**
 * Where SSLCOMMERZ sends the browser back to.
 *
 * This page renders **no authoritative payment state**. The redirect is
 * user-reachable — anyone can open /payment/return?outcome=success — so the only
 * thing it can honestly do is invalidate the cached queries and send the user to
 * their orders, where the status comes from the server's own record of the verified
 * IPN.
 *
 * The brief delay exists because the IPN is a separate server-to-server call that
 * may land a moment after the browser redirect; refetching immediately would often
 * show `awaiting_payment` for a payment that is about to be confirmed.
 */
export default function PaymentReturnPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const [settling, setSettling] = useState(true);

  const outcome = params.get('outcome') ?? 'unknown';

  useEffect(() => {
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order'] });
      void queryClient.invalidateQueries({ queryKey: ['payment'] });
      setSettling(false);
    }, 2500);

    return () => clearTimeout(timer);
  }, [queryClient]);

  if (settling && outcome === 'success') {
    return <Spinner label={t('payment.verifying')} />;
  }

  const view = {
    success: { icon: '✅', title: t('payment.success'), help: t('payment.successHelp') },
    fail: { icon: '❌', title: t('payment.fail'), help: '' },
    cancel: { icon: '⚠️', title: t('payment.cancel'), help: '' },
  }[outcome] ?? { icon: '❓', title: t('common.error'), help: '' };

  return (
    <div className="card flex flex-col items-center gap-3 py-10 text-center">
      <span aria-hidden className="text-5xl">
        {view.icon}
      </span>
      <h1 className="text-xl font-bold text-brand-900">{view.title}</h1>
      {view.help && <p className="max-w-sm text-sm text-slate-600">{view.help}</p>}
      <Link to="/orders" className="btn-primary mt-2">
        {t('payment.backToOrders')}
      </Link>
    </div>
  );
}
