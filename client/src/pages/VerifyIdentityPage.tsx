import { REQUIRED_KYC_DOCUMENTS, type KycDocumentKind } from '@krishibid/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Spinner } from '../components/ui.js';
import { useAccount, useSubmitKyc, useUploadKycDocument } from '../lib/account.js';
import { compressImage } from '../lib/format.js';

const ALL_DOCUMENTS: KycDocumentKind[] = ['nid_front', 'nid_back', 'selfie', 'certificate'];

function DocumentRow({
  kind,
  uploaded,
  disabled,
}: {
  kind: KycDocumentKind;
  uploaded: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const upload = useUploadKycDocument();
  const required = REQUIRED_KYC_DOCUMENTS.includes(kind);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-brand-50 py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">
          {t(`account.documents.${kind}`)}
          {!required && <span className="ml-1 text-xs text-slate-400">({t('account.optional')})</span>}
        </p>
        {uploaded && <p className="text-xs text-brand-700">{t('account.uploaded')}</p>}
      </div>

      <label
        className={`btn-secondary shrink-0 cursor-pointer text-sm ${
          disabled ? 'pointer-events-none opacity-50' : ''
        }`}
      >
        {upload.isPending ? t('common.loading') : uploaded ? t('account.replace') : t('account.upload')}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={disabled || upload.isPending}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            /**
             * Compressed in the browser before upload.
             *
             * A phone photo of an NID is 4–8 MB, which on rural mobile data is a minutes-long
             * upload that often just fails. 1600px is ample for a reviewer to read the card.
             */
            const compressed = await compressImage(file, 1600);
            upload.mutate({ kind, file: compressed });
            // Clear the input so re-picking the same file fires onChange again.
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

export default function VerifyIdentityPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useAccount();
  const submit = useSubmitKyc();

  const [nidNumber, setNidNumber] = useState('');
  const [fullNameOnNid, setFullNameOnNid] = useState('');
  const [farmSize, setFarmSize] = useState('');
  const [crops, setCrops] = useState('');

  if (isLoading) return <Spinner />;
  if (!data) return null;

  const kyc = data.kyc;
  const uploaded = new Set(kyc?.documents.map((d) => d.kind) ?? []);
  const locked = kyc?.status === 'pending_review' || kyc?.status === 'approved';
  const missing = kyc?.missingDocuments ?? REQUIRED_KYC_DOCUMENTS;

  // Email first: it is the only channel that has actually been proven, and the only way to tell
  // someone what was decided. Reviewing documents attached to an unverified address would mean
  // approving somebody we cannot reach.
  if (!data.verification.emailVerified) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-xl font-bold text-brand-900">{t('account.verifyIdentity')}</h1>
        <div className="card border border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">{t('account.emailFirst')}</p>
          <Link to="/verify/email" className="btn-primary mt-3 w-full">
            {t('account.verifyEmail')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <header>
        <h1 className="text-xl font-bold text-brand-900">{t('account.verifyIdentity')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('account.verifyIdentityWhy')}</p>
      </header>

      {/**
       * Said plainly, because the alternative is implying something untrue.
       *
       * These documents are read by a person on this platform. They are NOT checked against the
       * Election Commission — that needs a government partnership this project does not have.
       */}
      <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        {t('account.kycPrivacyNote')}
      </p>

      {locked && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
          {t(`account.kycStatus.${kyc!.status}`)}
        </p>
      )}

      <section className="card">
        <h2 className="font-bold text-brand-900">{t('account.documents.heading')}</h2>
        <div className="mt-2">
          {ALL_DOCUMENTS.map((kind) => (
            <DocumentRow key={kind} kind={kind} uploaded={uploaded.has(kind)} disabled={locked} />
          ))}
        </div>
      </section>

      {!locked && (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate(
              {
                nidNumber,
                fullNameOnNid,
                farmSizeAcres: Number(farmSize),
                cropsGrown: crops
                  .split(',')
                  .map((c) => c.trim())
                  .filter(Boolean),
              },
              { onSuccess: () => navigate('/account') },
            );
          }}
        >
          <h2 className="font-bold text-brand-900">{t('account.yourDetails')}</h2>

          <div>
            <label htmlFor="nid" className="label">
              {t('account.nidNumber')}
            </label>
            <input
              id="nid"
              className="field"
              inputMode="numeric"
              value={nidNumber}
              onChange={(e) => setNidNumber(e.target.value.replace(/\D/g, ''))}
              required
            />
            <p className="mt-1 text-xs text-slate-500">{t('account.nidHelp')}</p>
          </div>

          <div>
            <label htmlFor="nidName" className="label">
              {t('account.nameOnNid')}
            </label>
            <input
              id="nidName"
              className="field"
              value={fullNameOnNid}
              onChange={(e) => setFullNameOnNid(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="farmSize" className="label">
              {t('account.farmSize')}
            </label>
            <input
              id="farmSize"
              className="field"
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={farmSize}
              onChange={(e) => setFarmSize(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="crops" className="label">
              {t('account.cropsGrown')}
            </label>
            <input
              id="crops"
              className="field"
              placeholder={t('account.cropsPlaceholder')}
              value={crops}
              onChange={(e) => setCrops(e.target.value)}
              required
            />
            {/* Collected here because it also drives government-scheme matching later, so a
                farmer fills it once rather than twice. */}
            <p className="mt-1 text-xs text-slate-500">{t('account.cropsHelp')}</p>
          </div>

          {missing.length > 0 && (
            <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900">
              {t('account.stillNeeded')}:{' '}
              {missing.map((d) => t(`account.documents.${d}`)).join(', ')}
            </p>
          )}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={submit.isPending || missing.length > 0}
          >
            {submit.isPending ? t('common.loading') : t('account.submitForReview')}
          </button>
        </form>
      )}
    </div>
  );
}
