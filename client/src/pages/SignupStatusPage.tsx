import { OTP_LENGTH, OTP_RESEND_COOLDOWN_SECONDS, type ApprovalStatusDto } from '@krishibid/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ErrorNote } from '../components/ui.js';
import { formatDate } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';
import { useCheckStatus, useRequestStatusCode } from '../lib/signup.js';

/**
 * Approval status, with no session involved.
 *
 * A farmer waiting for review cannot log in — that is the whole point of the wall — so without
 * this page they would have no way at all of finding out whether anything had happened. Being
 * left to guess is its own kind of refusal.
 *
 * Requesting a code answers identically whether or not the address is registered, so this cannot
 * be used to test which emails have accounts.
 */
const TONE: Record<ApprovalStatusDto['status'], string> = {
  pending_approval: 'border-amber-200 bg-amber-50 text-amber-900',
  active: 'border-brand-200 bg-brand-50 text-brand-900',
  rejected: 'border-red-200 bg-red-50 text-red-900',
  suspended: 'border-red-200 bg-red-50 text-red-900',
};

export default function SignupStatusPage() {
  const { t } = useTranslation();
  const locale = currentLocale();

  const request = useRequestStatusCode();
  const check = useCheckStatus();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const status = check.data;

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <header>
        <h1 className="text-xl font-bold text-brand-900">{t('status.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('status.help')}</p>
      </header>

      {status ? (
        <div className={`card border ${TONE[status.status]}`}>
          <p className="font-bold">{t(`status.state.${status.status}`)}</p>

          {status.submittedAt && (
            <p className="mt-2 text-sm">
              {t('status.submittedAt', { date: formatDate(status.submittedAt, locale) })}
            </p>
          )}
          {status.decidedAt && (
            <p className="mt-1 text-sm">
              {t('status.decidedAt', { date: formatDate(status.decidedAt, locale) })}
            </p>
          )}

          {status.rejectionReason && (
            <p className="mt-2 rounded-lg bg-white/60 p-2 text-sm">
              <span className="font-semibold">{t('account.reason')}: </span>
              {status.rejectionReason}
            </p>
          )}

          <div className="mt-3 space-y-2">
            {/* A rejection is the one state with something to do, so it gets the button. */}
            {status.status === 'rejected' && (
              <Link to="/login" className="btn-primary w-full">
                {t('status.logInToResubmit')}
              </Link>
            )}
            {status.status === 'active' && (
              <Link to="/login" className="btn-primary w-full">
                {t('auth.login')}
              </Link>
            )}
            <Link to="/" className="btn-secondary w-full">
              {t('signup.browseMarket')}
            </Link>
          </div>
        </div>
      ) : !sent ? (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate(email, {
              onSuccess: (result) => {
                setSent(true);
                setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
                if (result.devCode) setCode(result.devCode);
              },
            });
          }}
        >
          <div>
            <label htmlFor="email" className="label">
              {t('signup.email')}
            </label>
            <input
              id="email"
              className="field"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <p className="mt-1 text-xs text-slate-500">{t('status.emailHelp')}</p>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={request.isPending}>
            {request.isPending ? t('signup.sendingCode') : t('account.sendCode')}
          </button>
        </form>
      ) : (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            check.mutate({ email, code });
          }}
        >
          <p className="text-sm text-slate-700">
            {t('signup.codeSentTo')} <span className="font-semibold">{email}</span>
          </p>

          <div>
            <label htmlFor="code" className="label">
              {t('account.enterCode')}
            </label>
            <input
              id="code"
              className="field text-center text-2xl tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={OTP_LENGTH}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
              required
              autoFocus
            />
          </div>

          {check.error != null && <ErrorNote error={check.error} />}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={check.isPending || code.length !== OTP_LENGTH}
          >
            {check.isPending ? t('status.checking') : t('status.showStatus')}
          </button>

          <button
            type="button"
            className="btn-secondary w-full"
            disabled={cooldown > 0 || request.isPending}
            onClick={() =>
              request.mutate(email, {
                onSuccess: (result) => {
                  setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
                  if (result.devCode) setCode(result.devCode);
                },
              })
            }
          >
            {cooldown > 0 ? t('account.resendIn', { seconds: cooldown }) : t('account.resendCode')}
          </button>
        </form>
      )}

      <p className="text-center text-sm">
        <Link to="/login" className="font-semibold text-brand-700 underline">
          {t('auth.login')}
        </Link>
      </p>
    </div>
  );
}
