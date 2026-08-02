import {
  BID_CEILING_POISHA,
  OTP_LENGTH,
  OTP_RESEND_COOLDOWN_SECONDS,
  REQUIRED_KYC_DOCUMENTS,
  type BuyerType,
  type KycDocumentKind,
} from '@krishibid/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ErrorNote } from '../components/ui.js';
import { ApiRequestError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { compressImage, formatBdt } from '../lib/format.js';
import { currentLocale, setLocale } from '../lib/i18n.js';
import {
  useCompleteRegistration,
  useStartRegistration,
  useVerifyRegistration,
  uploadSignupDocument,
  type SignupDraft,
} from '../lib/signup.js';

const DISTRICTS = [
  'Dhaka', 'Rangpur', 'Bogura', 'Rajshahi', 'Khulna', 'Jashore', 'Cumilla',
  'Mymensingh', 'Sylhet', 'Dinajpur', 'Faridpur', 'Barishal', 'Chattogram', 'Rangamati',
];

const BUYER_TYPES: BuyerType[] = ['trader', 'wholesaler', 'retailer', 'processor', 'exporter', 'other'];

const DOCUMENT_KINDS: KycDocumentKind[] = ['nid_front', 'nid_back', 'selfie', 'certificate'];

const DRAFT_KEY = 'krishibid_signup_draft';

/**
 * The draft, persisted so a closed tab does not cost the work.
 *
 * The password is deliberately NOT stored: a signup draft sitting in localStorage with a
 * plaintext password on a shared phone is a worse outcome than retyping it. One key rather than
 * one per address — a second person signing up on the same device is replacing an abandoned
 * draft, which is the behaviour you want.
 */
type Draft = Omit<SignupDraft, 'password'>;

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // A full or blocked storage must not break signing up.
  }
}

/**
 * Field-level errors, pulled out of what the API already returns.
 *
 * Two shapes land here, and both belong next to a field rather than in a banner: Zod issues
 * (`[{ path, message }]`) and a uniqueness collision (`{ field }`), which is reported per field
 * precisely so that "this number is taken" does not make someone re-check their email too.
 */
function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiRequestError)) return {};
  const out: Record<string, string> = {};

  if (Array.isArray(error.details)) {
    for (const detail of error.details as { path?: string; message?: string }[]) {
      if (detail.path && detail.message) out[detail.path] = detail.message;
    }
    return out;
  }

  const field = (error.details as { field?: string } | null)?.field;
  if (field) out[field] = error.message;
  return out;
}

/** True when nothing in the error mapped to a field, so it needs saying somewhere. */
const isUnattributed = (error: unknown, fields: Record<string, string>): boolean =>
  Boolean(error) && Object.keys(fields).length === 0;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 text-sm font-medium text-red-700" role="alert">
      {message}
    </p>
  );
}

/** "Step 2 of 4" — sticky on mobile, where a long step scrolls the heading away. */
function StepIndicator({ step, total }: { step: number; total: number }) {
  const { t } = useTranslation();

  return (
    <div className="sticky top-0 z-10 -mx-4 bg-brand-50/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
      <p className="text-sm font-semibold text-brand-800">
        {t('signup.stepOf', { step, total })}
      </p>
      <div className="mt-1.5 flex gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-brand-600' : 'bg-brand-200'}`}
          />
        ))}
      </div>
    </div>
  );
}

interface DocumentState {
  uploaded: boolean;
  /** Object URL of the local file, so the farmer sees *which* photo landed. */
  previewUrl?: string;
  progress: number | null;
  busy: boolean;
  error?: string;
}

/**
 * One document tile: pick, watch it upload, see the thumbnail.
 *
 * The thumbnail is the point. A tick tells someone an upload happened; a picture of their own NID
 * tells them the right photo happened, which is the thing they are actually unsure about.
 */
function DocumentTile({
  kind,
  state,
  onPick,
}: {
  kind: KycDocumentKind;
  state: DocumentState;
  onPick: (file: File) => void;
}) {
  const { t } = useTranslation();
  const required = (REQUIRED_KYC_DOCUMENTS as readonly string[]).includes(kind);
  const percent = state.progress === null ? null : Math.round(state.progress * 100);

  return (
    <div className="rounded-xl border border-brand-100 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">
          {t(`account.documents.${kind}`)}
          {!required && (
            <span className="ml-1 text-xs font-normal text-slate-400">
              ({t('account.optional')})
            </span>
          )}
        </p>
        {state.uploaded && (
          <span className="badge bg-brand-100 text-brand-800">{t('account.uploaded')}</span>
        )}
      </div>

      {state.previewUrl && (
        <img
          src={state.previewUrl}
          alt={t(`account.documents.${kind}`)}
          className="mt-2 h-28 w-full rounded-lg border border-brand-100 object-cover"
        />
      )}

      {state.busy && (
        <div className="mt-2">
          {/* Real progress, not a spinner: on 2G an NID upload takes tens of seconds, and an
              indeterminate spinner there is indistinguishable from a hang. */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-brand-100">
            <div
              className={`h-full bg-brand-600 transition-[width] ${percent === null ? 'animate-pulse w-1/3' : ''}`}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {percent === null
              ? t('signup.uploading', { name: t(`account.documents.${kind}`) })
              : t('signup.uploadingPercent', {
                  name: t(`account.documents.${kind}`),
                  percent,
                })}
          </p>
        </div>
      )}

      <FieldError message={state.error} />

      <label
        className={`btn-secondary mt-2 w-full cursor-pointer text-sm ${
          state.busy ? 'pointer-events-none opacity-50' : ''
        }`}
      >
        {state.uploaded ? t('account.replace') : t('account.upload')}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture={kind === 'selfie' ? 'user' : undefined}
          className="hidden"
          disabled={state.busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            // Clear the input so re-picking the same file fires onChange again.
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

export default function SignupPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const navigate = useNavigate();
  const { user } = useAuth();

  const saved = useRef(readDraft()).current;

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<SignupDraft>({
    name: saved?.name ?? '',
    phone: saved?.phone ?? '',
    email: saved?.email ?? '',
    district: saved?.district ?? 'Dhaka',
    role: saved?.role ?? 'farmer',
    password: '',
  });

  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [signupToken, setSignupToken] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Farmer step 3.
  const [nidNumber, setNidNumber] = useState('');
  const [fullNameOnNid, setFullNameOnNid] = useState('');
  const [farmSize, setFarmSize] = useState('');
  const [crops, setCrops] = useState('');
  const [documents, setDocuments] = useState<Record<string, DocumentState>>({});

  // Buyer step 3, both optional.
  const [businessName, setBusinessName] = useState('');
  const [buyerType, setBuyerType] = useState<BuyerType | ''>('');

  const start = useStartRegistration();
  const verify = useVerifyRegistration();
  const complete = useCompleteRegistration();

  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // Autofocus the first field of each step — one less tap on a phone.
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, [step]);

  // Mirrors the server's resend cooldown, so the button is disabled rather than 429-ing.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Release the object URLs the thumbnails hold when the wizard unmounts.
  useEffect(
    () => () => {
      for (const doc of Object.values(documents)) {
        if (doc.previewUrl) URL.revokeObjectURL(doc.previewUrl);
      }
    },
    [documents],
  );

  if (user) return <Navigate to="/" replace />;

  // The error that belongs to whichever step is on screen.
  const stepError = step === 1 ? start.error : step === 2 ? verify.error : complete.error;
  const errors = fieldErrors(stepError);
  const isFarmer = form.role === 'farmer';
  const totalSteps = isFarmer ? 4 : 3;

  const set = (patch: Partial<SignupDraft>): void => {
    const next = { ...form, ...patch };
    setForm(next);
    const { password: _password, ...rest } = next;
    writeDraft(rest);
  };

  const requiredMissing = REQUIRED_KYC_DOCUMENTS.filter((k) => !documents[k]?.uploaded);

  async function handlePick(kind: KycDocumentKind, file: File): Promise<void> {
    const previewUrl = URL.createObjectURL(file);
    setDocuments((d) => ({
      ...d,
      [kind]: { uploaded: false, previewUrl, progress: null, busy: true },
    }));

    try {
      /**
       * Compressed in the browser first.
       *
       * A phone photo of an NID is 4–8 MB, which on rural mobile data is a minutes-long upload
       * that often just fails. 1600px is ample for a reviewer to read the card.
       */
      const compressed = await compressImage(file, 1600);

      await uploadSignupDocument(signupToken, kind, compressed, ({ ratio }) => {
        setDocuments((d) => ({ ...d, [kind]: { ...d[kind]!, progress: ratio } }));
      });

      setDocuments((d) => ({
        ...d,
        [kind]: { uploaded: true, previewUrl, progress: 1, busy: false },
      }));
    } catch (error) {
      setDocuments((d) => ({
        ...d,
        [kind]: {
          ...d[kind]!,
          busy: false,
          uploaded: false,
          error: error instanceof Error ? error.message : t('common.error'),
        },
      }));
    }
  }

  // ---- the submitted screen: a farmer's account exists but is not open ----
  if (submitted) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4">
        <div className="card border border-brand-200 bg-brand-50">
          <h1 className="text-xl font-bold text-brand-900">{t('signup.submittedTitle')}</h1>
          <p className="mt-2 text-sm text-brand-900">{t('signup.submittedBody')}</p>
          <p className="mt-2 text-sm text-brand-900">
            {t('signup.submittedEmail', { email: form.email })}
          </p>
        </div>

        <div className="card space-y-2">
          <Link to="/signup/status" className="btn-primary w-full">
            {t('signup.checkStatus')}
          </Link>
          <Link to="/" className="btn-secondary w-full">
            {t('signup.browseMarket')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <header className="text-center">
        <h1 className="text-2xl font-bold text-brand-900">{t('signup.title')}</h1>
        <p className="text-sm text-slate-600">{t('app.tagline')}</p>
        <button
          type="button"
          onClick={() => setLocale(locale === 'bn' ? 'en' : 'bn')}
          className="mt-1 text-xs font-semibold text-brand-700 underline"
        >
          {locale === 'bn' ? 'English' : 'বাংলা'}
        </button>
      </header>

      <StepIndicator step={step} total={totalSteps} />

      {/* ---- step 1: the same five fields for both roles ---- */}
      {step === 1 && (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate(
              { ...form, locale },
              {
                onSuccess: (result) => {
                  setStep(2);
                  setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
                  // Prefilled when the server has no mail provider, which keeps development
                  // usable without weakening production, where the field stays empty.
                  if (result.devCode) setCode(result.devCode);
                },
              },
            );
          }}
        >
          <div>
            <span className="label">{t('auth.role')}</span>
            <div className="flex gap-2">
              {(['farmer', 'buyer'] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => set({ role })}
                  aria-pressed={form.role === role}
                  className={form.role === role ? 'btn-primary flex-1' : 'btn-secondary flex-1'}
                >
                  {t(`auth.${role}`)}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {isFarmer ? t('signup.farmerNote') : t('signup.buyerNote')}
            </p>
          </div>

          <div>
            <label htmlFor="name" className="label">
              {t('auth.name')}
            </label>
            <input
              id="name"
              ref={firstFieldRef}
              className="field"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              autoComplete="name"
              required
              minLength={2}
            />
            <FieldError message={errors.name} />
          </div>

          <div>
            <label htmlFor="phone" className="label">
              {t('auth.phone')}
            </label>
            <input
              id="phone"
              className="field"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="01XXXXXXXXX"
              value={form.phone}
              onChange={(e) => set({ phone: e.target.value })}
              required
            />
            {/* Said plainly, because calling it verified would be a lie a farmer might rely on. */}
            <p className="mt-1 text-xs text-slate-500">{t('signup.phoneContactOnly')}</p>
            <FieldError message={errors.phone} />
          </div>

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
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
              required
            />
            <p className="mt-1 text-xs text-slate-500">{t('signup.emailWhy')}</p>
            <FieldError message={errors.email} />
          </div>

          <div>
            <label htmlFor="district" className="label">
              {t('auth.district')}
            </label>
            <select
              id="district"
              className="field"
              value={form.district}
              onChange={(e) => set({ district: e.target.value })}
            >
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="password" className="label">
              {t('auth.password')}
            </label>
            <input
              id="password"
              className="field"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={8}
            />
            <p className="mt-1 text-xs text-slate-500">{t('signup.passwordHelp')}</p>
            <FieldError message={errors.password} />
          </div>

          {isUnattributed(start.error, errors) && <ErrorNote error={start.error} />}

          <button type="submit" className="btn-primary w-full" disabled={start.isPending}>
            {start.isPending ? t('signup.sendingCode') : t('signup.continue')}
          </button>

          <p className="text-center text-sm text-slate-600">
            {t('auth.haveAccount')}{' '}
            <Link to="/login" className="font-semibold text-brand-700 underline">
              {t('auth.login')}
            </Link>
          </p>
        </form>
      )}

      {/* ---- step 2: the emailed code ---- */}
      {step === 2 && (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate(
              { email: form.email, code },
              {
                onSuccess: (result) => {
                  setSignupToken(result.signupToken);
                  setStep(3);
                },
              },
            );
          }}
        >
          <p className="text-sm text-slate-700">
            {t('signup.codeSentTo')}{' '}
            <span className="font-semibold">{form.email}</span>
          </p>

          <div>
            <label htmlFor="code" className="label">
              {t('account.enterCode')}
            </label>
            <input
              id="code"
              ref={firstFieldRef}
              className="field text-center text-2xl tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={OTP_LENGTH}
              value={code}
              // Accepts a pasted code and strips spaces and dashes rather than rejecting it.
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
              required
            />
            {/* The wrong code is a field problem, not a request failure, so it says so here. */}
            {verify.error != null && <FieldError message={(verify.error as Error).message} />}
          </div>

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={verify.isPending || code.length !== OTP_LENGTH}
          >
            {verify.isPending ? t('signup.checkingCode') : t('signup.continue')}
          </button>

          <button
            type="button"
            className="btn-secondary w-full"
            disabled={cooldown > 0 || start.isPending}
            onClick={() =>
              start.mutate(
                { ...form, locale },
                {
                  onSuccess: (result) => {
                    setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
                    if (result.devCode) setCode(result.devCode);
                  },
                },
              )
            }
          >
            {cooldown > 0 ? t('account.resendIn', { seconds: cooldown }) : t('account.resendCode')}
          </button>

          {/* Back never loses what was typed — the draft is state, not a fresh mount. */}
          <button
            type="button"
            className="w-full text-center text-sm text-brand-700 underline"
            onClick={() => setStep(1)}
          >
            {t('signup.back')}
          </button>
        </form>
      )}

      {/* ---- step 3, buyer: both fields optional ---- */}
      {step === 3 && !isFarmer && (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            complete.mutate(
              {
                signupToken,
                details: {
                  ...(businessName ? { businessName } : {}),
                  ...(buyerType ? { buyerType } : {}),
                },
              },
              { onSuccess: () => navigate('/', { replace: true }) },
            );
          }}
        >
          <h2 className="font-bold text-brand-900">{t('signup.businessTitle')}</h2>
          <p className="text-sm text-slate-600">{t('signup.businessWhy')}</p>

          <div>
            <label htmlFor="business" className="label">
              {t('account.businessName')}
            </label>
            <input
              id="business"
              ref={firstFieldRef}
              className="field"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="buyerType" className="label">
              {t('signup.buyerType')}
            </label>
            <select
              id="buyerType"
              className="field"
              value={buyerType}
              onChange={(e) => setBuyerType(e.target.value as BuyerType)}
            >
              <option value="">{t('signup.choose')}</option>
              {BUYER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`signup.buyerTypes.${type}`)}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={complete.isPending}>
            {complete.isPending ? t('signup.creatingAccount') : t('signup.finish')}
          </button>

          {/* The skip says what it costs, rather than being an unexplained link. */}
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={complete.isPending}
            onClick={() =>
              complete.mutate(
                { signupToken, details: {} },
                { onSuccess: () => navigate('/', { replace: true }) },
              )
            }
          >
            {t('signup.skipForNow')}
          </button>
          <p className="text-center text-xs text-slate-500">
            {t('signup.skipCost', { amount: formatBdt(BID_CEILING_POISHA.basic, locale) })}
          </p>
        </form>
      )}

      {/* ---- step 3, farmer: application details ---- */}
      {step === 3 && isFarmer && (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(4);
          }}
        >
          <h2 className="font-bold text-brand-900">{t('account.yourDetails')}</h2>

          <div>
            <label htmlFor="nid" className="label">
              {t('account.nidNumber')}
            </label>
            <input
              id="nid"
              ref={firstFieldRef}
              className="field"
              inputMode="numeric"
              value={nidNumber}
              onChange={(e) => setNidNumber(e.target.value.replace(/\D/g, ''))}
              required
            />
            <p className="mt-1 text-xs text-slate-500">{t('account.nidHelp')}</p>
            <FieldError message={errors.nidNumber} />
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
            <FieldError message={errors.fullNameOnNid} />
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
            <FieldError message={errors.farmSizeAcres} />
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
            <p className="mt-1 text-xs text-slate-500">{t('account.cropsHelp')}</p>
            <FieldError message={errors.cropsGrown} />
          </div>

          <button type="submit" className="btn-primary w-full">
            {t('signup.continue')}
          </button>
          <button
            type="button"
            className="w-full text-center text-sm text-brand-700 underline"
            onClick={() => setStep(2)}
          >
            {t('signup.back')}
          </button>
        </form>
      )}

      {/* ---- step 4, farmer: documents, then submit for review ---- */}
      {step === 4 && (
        <div className="space-y-4">
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            {t('account.kycPrivacyNote')}
          </p>

          <section className="card">
            <h2 className="font-bold text-brand-900">{t('account.documents.heading')}</h2>
            {/* Two columns from md, so all four uploads are visible at once on a desktop
                instead of being scrolled through one at a time. */}
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              {DOCUMENT_KINDS.map((kind) => (
                <DocumentTile
                  key={kind}
                  kind={kind}
                  state={documents[kind] ?? { uploaded: false, progress: null, busy: false }}
                  onPick={(file) => void handlePick(kind, file)}
                />
              ))}
            </div>
          </section>

          <div className="card space-y-3">
            {requiredMissing.length > 0 && (
              <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900">
                {t('account.stillNeeded')}:{' '}
                {requiredMissing.map((d) => t(`account.documents.${d}`)).join(', ')}
              </p>
            )}

            {/* A failure here must not discard the other steps' input, so it renders in place
                rather than resetting the wizard. */}
            {isUnattributed(complete.error, errors) && <ErrorNote error={complete.error} />}

            <button
              type="button"
              className="btn-primary w-full"
              disabled={complete.isPending || requiredMissing.length > 0}
              onClick={() =>
                complete.mutate(
                  {
                    signupToken,
                    details: {
                      nidNumber,
                      fullNameOnNid,
                      farmSizeAcres: Number(farmSize),
                      cropsGrown: crops
                        .split(',')
                        .map((c) => c.trim())
                        .filter(Boolean),
                    },
                  },
                  {
                    onSuccess: () => {
                      localStorage.removeItem(DRAFT_KEY);
                      setSubmitted(true);
                    },
                  },
                )
              }
            >
              {complete.isPending ? t('signup.submitting') : t('account.submitForReview')}
            </button>

            <button
              type="button"
              className="w-full text-center text-sm text-brand-700 underline"
              onClick={() => setStep(3)}
            >
              {t('signup.back')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
