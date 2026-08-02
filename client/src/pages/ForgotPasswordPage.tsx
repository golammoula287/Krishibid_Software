import { OTP_LENGTH, OTP_RESEND_COOLDOWN_SECONDS } from '@krishibid/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorNote } from '../components/ui.js';
import { useConfirmPasswordReset, useRequestPasswordReset } from '../lib/signup.js';

/**
 * Password reset by email, which is the only verified channel.
 *
 * Requesting a code says the same thing whether or not the address is registered. That is
 * deliberate: an endpoint that answers "no such account" is a free tool for discovering which
 * addresses are on the platform, and the people most worth discovering are the ones with money in
 * escrow. The cost is that a mistyped address gets silence rather than a correction — recoverable
 * by trying again, unlike an enumerated user list.
 */
export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const request = useRequestPasswordReset();
  const confirm = useConfirmPasswordReset();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <header>
        <h1 className="text-xl font-bold text-brand-900">{t('forgot.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('forgot.help')}</p>
      </header>

      {!sent ? (
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
            confirm.mutate(
              { email, code, newPassword },
              // Every session was just revoked, including any on this device, so login is the
              // only sensible destination.
              { onSuccess: () => navigate('/login', { replace: true }) },
            );
          }}
        >
          <p className="text-sm text-slate-700">
            {t('forgot.codeSent')} <span className="font-semibold">{email}</span>
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

          <div>
            <label htmlFor="newPassword" className="label">
              {t('account.newPassword')}
            </label>
            <input
              id="newPassword"
              className="field"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
            <p className="mt-1 text-xs text-slate-500">{t('signup.passwordHelp')}</p>
          </div>

          {/* Stated before they submit: a reset ends every session, on every device. */}
          <p className="text-xs text-slate-500">{t('forgot.logoutWarning')}</p>

          {confirm.error != null && <ErrorNote error={confirm.error} />}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={confirm.isPending || code.length !== OTP_LENGTH}
          >
            {confirm.isPending ? t('forgot.saving') : t('forgot.setPassword')}
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
