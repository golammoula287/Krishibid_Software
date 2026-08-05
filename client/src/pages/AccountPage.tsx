import { BID_CEILING_POISHA, type BalanceDto, type BuyerTier } from '@krishibid/shared';
import { Icon } from '../components/icons.js';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { CardSkeleton, ErrorNote, Spinner } from '../components/ui.js';
import { useAccount, useChangePassword, useUpdateProfile } from '../lib/account.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { formatBdt } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

const TIER_ORDER: BuyerTier[] = ['basic', 'verified', 'trusted'];

/**
 * Verification, phrased as a next action rather than a status label.
 *
 * "Pending review" on its own leaves a farmer who has already uploaded documents unsure whether
 * anything is expected of them — which is precisely the dead end this panel exists to avoid.
 */
function FarmerVerification() {
  const { t } = useTranslation();
  const { data } = useAccount();
  if (!data?.kyc) return null;

  const { kyc, canListProduce, cannotListReason } = data;

  const tone =
    kyc.status === 'approved'
      ? 'border-brand-200 bg-brand-50 text-brand-900'
      : kyc.status === 'rejected'
        ? 'border-red-200 bg-red-50 text-red-900'
        : 'border-amber-200 bg-amber-50 text-amber-900';

  return (
    <section className={`card border ${tone}`}>
      <h2 className="font-bold">{t('account.verification')}</h2>
      <p className="mt-1 text-sm">{t(`account.kycStatus.${kyc.status}`)}</p>

      {kyc.status === 'rejected' && kyc.rejectionReason && (
        <p className="mt-2 rounded-lg bg-white/60 p-2 text-sm">
          <span className="font-semibold">{t('account.reason')}: </span>
          {kyc.rejectionReason}
        </p>
      )}

      {!canListProduce && (
        <p className="mt-2 text-sm font-medium">
          {t(`account.cannotList.${cannotListReason ?? 'kyc_not_started'}`)}
        </p>
      )}

      {kyc.status !== 'approved' && kyc.status !== 'pending_review' && (
        <Link to="/verify" className="btn-primary mt-3 w-full">
          {kyc.status === 'rejected' ? t('account.resubmit') : t('account.startVerification')}
        </Link>
      )}

      {kyc.missingDocuments.length > 0 && kyc.status !== 'approved' && (
        <p className="mt-2 text-xs">
          {t('account.stillNeeded')}:{' '}
          {kyc.missingDocuments.map((d) => t(`account.documents.${d}`)).join(', ')}
        </p>
      )}
    </section>
  );
}

/**
 * Buyer tier as a ladder, with the next rung spelled out.
 *
 * Framed as unlocking rather than restricting. The limit is real, but a buyer who can see
 * exactly what raises it is far likelier to supply the information than one handed a refusal.
 */
function BuyerTrust() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const { data } = useAccount();
  if (!data || data.role !== 'buyer') return null;

  const tier = data.buyerTier ?? 'basic';
  const currentIndex = TIER_ORDER.indexOf(tier);

  return (
    <section className="card">
      <h2 className="font-bold text-brand-900">{t('account.trustLevel')}</h2>

      <div className="mt-3 flex gap-1.5">
        {TIER_ORDER.map((step, i) => (
          <div
            key={step}
            className={`h-2 flex-1 rounded-full ${i <= currentIndex ? 'bg-brand-600' : 'bg-slate-200'}`}
            aria-hidden
          />
        ))}
      </div>

      <p className="mt-2 text-sm font-semibold text-brand-800">{t(`account.tier.${tier}`)}</p>

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-500">{t('account.bidLimit')}</dt>
          <dd className="font-semibold tabular-nums">
            {tier === 'trusted'
              ? t('account.noLimit')
              : formatBdt(data.bidCeilingPoisha ?? BID_CEILING_POISHA.basic, locale)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">{t('account.cleanOrders')}</dt>
          <dd className="font-semibold tabular-nums">{data.cleanCompletedOrders ?? 0}</dd>
        </div>
      </dl>

      {data.nextTierRequirement && (
        <p className="mt-3 rounded-lg bg-brand-50 p-2.5 text-sm text-brand-900">
          {data.nextTierRequirement}
        </p>
      )}

      {data.kyc?.status !== 'approved' && (
        <Link to="/verify" className="btn-secondary mt-3 w-full">
          {t('account.verifyIdentity')}
        </Link>
      )}
    </section>
  );
}

/** Farmer earnings. Kept from the original page — escrow and available stay separate. */
function BalancePanel() {
  const { t } = useTranslation();
  const locale = currentLocale();

  const balance = useQuery({
    queryKey: ['balance'],
    queryFn: () => api.get<BalanceDto>('/payments/balance'),
  });

  return (
    <section className="card space-y-3">
      <h2 className="font-bold text-brand-900">{t('payment.balance')}</h2>
      {balance.isLoading && <Spinner />}
      {balance.data && (
        /* Escrow and available are separate lines, never summed into one "balance".
           Conflating money that is still conditional with money a farmer can actually
           withdraw would be actively misleading. */
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="flex items-center gap-1.5 text-slate-600">
              <Icon name="shield" className="h-4 w-4" />
              {t('payment.escrow')}
            </dt>
            <dd className="font-semibold text-blue-800">
              {formatBdt(balance.data.escrowPoisha, locale)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-brand-50 pt-2">
            <dt className="flex items-center gap-1.5 text-slate-600">
              <Icon name="check" className="h-4 w-4" />
              {t('payment.available')}
            </dt>
            <dd className="text-lg font-bold text-brand-800">
              {formatBdt(balance.data.availablePoisha, locale)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

/**
 * Contact details: the address that is verified, and the number that is not.
 *
 * The number carries no "verified" badge and never will while there is no SMS provider. It is
 * labelled as contact information, because a farmer deciding whether to trust a buyer would
 * reasonably rely on a verified badge — and putting one on an unchecked number is the kind of
 * small lie that gets someone hurt.
 */
function ContactPanel() {
  const { t } = useTranslation();
  const { data } = useAccount();
  if (!data) return null;

  const { emailVerified, email } = data.verification;

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-bold text-brand-900">{t('account.email')}</h2>

        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="min-w-0 break-all text-sm">{email}</p>
          {emailVerified ? (
            <span className="badge shrink-0 bg-brand-100 text-brand-800">
              {t('account.verified')}
            </span>
          ) : (
            <span className="badge shrink-0 bg-amber-100 text-amber-800">
              {t('account.unverified')}
            </span>
          )}
        </div>

        {!emailVerified && (
          <p className="mt-2 text-sm text-amber-800">{t('account.verifyEmailWhy')}</p>
        )}

        <Link to="/verify/email" className="btn-secondary mt-3 w-full">
          {emailVerified ? t('account.changeEmail') : t('account.verifyNow')}
        </Link>
      </div>

      <div className="border-t border-brand-50 pt-3">
        <h2 className="font-bold text-brand-900">{t('account.phone')}</h2>
        <p className="mt-2 font-mono text-sm">{data.phone}</p>
        <p className="mt-1 text-xs text-slate-500">{t('account.phoneContactOnly')}</p>
      </div>
    </section>
  );
}

function ProfileForm() {
  const { t } = useTranslation();
  const { data } = useAccount();
  const update = useUpdateProfile();

  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  const [businessName, setBusinessName] = useState('');

  if (!data) return null;

  // Fields fall back to the saved value until touched, so editing one never blanks another.
  const nameValue = name || data.name;
  const districtValue = district || data.district;
  const businessValue = businessName || data.businessName || '';

  return (
    <form
      className="card space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        // Only changed fields are sent — the server rejects an empty update, and sending
        // unchanged values would make every save look like an edit in the audit trail.
        update.mutate({
          ...(nameValue !== data.name ? { name: nameValue } : {}),
          ...(districtValue !== data.district ? { district: districtValue } : {}),
          ...(data.role === 'buyer' && businessValue !== (data.businessName ?? '')
            ? { businessName: businessValue }
            : {}),
        });
      }}
    >
      <h2 className="font-bold text-brand-900">{t('account.editProfile')}</h2>

      <div>
        <label htmlFor="name" className="label">
          {t('auth.name')}
        </label>
        <input id="name" className="field" value={nameValue} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label htmlFor="district" className="label">
          {t('auth.district')}
        </label>
        <input
          id="district"
          className="field"
          value={districtValue}
          onChange={(e) => setDistrict(e.target.value)}
        />
      </div>

      {data.role === 'buyer' && (
        <div>
          <label htmlFor="business" className="label">
            {t('account.businessName')}
          </label>
          <input
            id="business"
            className="field"
            value={businessValue}
            onChange={(e) => setBusinessName(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">{t('account.businessHelp')}</p>
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={update.isPending}>
        {update.isPending ? t('common.loading') : t('common.save')}
      </button>
    </form>
  );
}

function PasswordForm() {
  const { t } = useTranslation();
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  return (
    <form
      className="card space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        change.mutate({ currentPassword: current, newPassword: next });
      }}
    >
      <h2 className="font-bold text-brand-900">{t('account.changePassword')}</h2>
      <input
        type="password"
        className="field"
        placeholder={t('account.currentPassword')}
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        required
        autoComplete="current-password"
      />
      <input
        type="password"
        className="field"
        placeholder={t('account.newPassword')}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        required
        minLength={8}
        autoComplete="new-password"
      />
      {/* Said up front: a password change ends every session, by design. */}
      <p className="text-xs text-slate-500">{t('account.passwordLogoutWarning')}</p>
      <button type="submit" className="btn-secondary w-full" disabled={change.isPending}>
        {change.isPending ? t('common.loading') : t('account.changePassword')}
      </button>
    </form>
  );
}

export default function AccountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const account = useAccount();
  const logout = useAuth((s) => s.logout);

  if (account.isLoading) return <CardSkeleton count={3} />;
  if (account.isError) {
    return <ErrorNote error={account.error} onRetry={() => void account.refetch()} />;
  }

  const data = account.data;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <header className="card">
        <h1 className="text-xl font-bold text-brand-900">{data.name}</h1>
        <p className="text-sm text-slate-600">
          {t(`auth.${data.role}`, { defaultValue: data.role })} · {data.district}
        </p>
      </header>

      {/* Suspension first and unmissable — every other control below it is moot. */}
      {data.accountStatus === 'suspended' && (
        <div className="card border border-red-300 bg-red-50">
          <p className="font-bold text-red-900">{t('account.suspended')}</p>
          {data.suspensionReason && (
            <p className="mt-1 text-sm text-red-800">{data.suspensionReason}</p>
          )}
        </div>
      )}

      <ContactPanel />

      {data.role === 'farmer' && (
        <>
          <FarmerVerification />
          <BalancePanel />
        </>
      )}
      {data.role === 'buyer' && <BuyerTrust />}

      <ProfileForm />
      <PasswordForm />

      <button
        type="button"
        onClick={() => void logout().then(() => navigate('/login', { replace: true }))}
        className="btn-secondary w-full"
      >
        {t('auth.logout')}
      </button>
    </div>
  );
}
