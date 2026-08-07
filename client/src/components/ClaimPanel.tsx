import type { ClaimReason } from '@krishibid/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './icons.js';
import { ErrorNote } from './ui.js';
import { useFileClaim, useMyClaims } from '../lib/fulfilment.js';
import { formatDate } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

const REASONS: ClaimReason[] = [
  'not_delivered',
  'quantity_short',
  'wrong_item',
  'quality_poor',
  'damaged',
  'other',
];

/**
 * Reporting that what arrived is not what was bought.
 *
 * Available from the moment the goods are on their way, and that is the point of it: escrow now
 * releases when the goods arrive, so a buyer who opens the sacks the next morning and finds them
 * damp needs somewhere to go that is not "the money has already moved, nothing can be done". An
 * admin reads it and decides.
 *
 * One open report at a time — the API enforces it — because a second while the first is
 * unresolved is the same complaint said twice, splitting an admin's attention across two records
 * of one problem.
 */
export default function ClaimPanel({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const claims = useMyClaims();
  const file = useFileClaim();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ClaimReason>('quantity_short');
  const [detail, setDetail] = useState('');

  const existing = (claims.data ?? []).filter((c) => c.orderId === orderId);
  const active = existing.find((c) => c.status === 'open' || c.status === 'reviewing');

  const form = (
    <div className="space-y-3">
      <div>
        <span className="label">{t('claim.whatWentWrong')}</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              aria-pressed={reason === r}
              className={`rounded-xl px-3 py-2.5 text-left text-sm transition ${
                reason === r
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {t(`claim.reason.${r}`)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="claim-detail" className="label">
          {t('claim.detail')}
        </label>
        {/* Ten characters minimum. A reason code alone tells an admin which drawer to look in,
            not what happened — "quality_poor" on 200kg could be damp sacks or the wrong grade,
            and those have different answers. */}
        <textarea
          id="claim-detail"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className="field min-h-24"
          minLength={10}
          maxLength={1000}
          placeholder={t('claim.detailPlaceholder')}
        />
      </div>

      {file.isError && <ErrorNote error={file.error} />}

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={detail.trim().length < 10 || file.isPending}
          onClick={() =>
            file.mutate(
              { orderId, reason, detail: detail.trim() },
              {
                onSuccess: () => {
                  setOpen(false);
                  setDetail('');
                },
              },
            )
          }
        >
          {file.isPending ? t('common.loading') : t('claim.submit')}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );

  if (existing.length > 0) {
    return (
      <section className="card space-y-3">
        <h2 className="font-bold text-slate-900">{t('claim.yours')}</h2>

        {existing.map((claim) => (
          <div key={claim.id} className="rounded-xl bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-800">
                {t(`claim.reason.${claim.reason}`)}
              </p>
              <span
                className={`badge ${
                  claim.status === 'upheld'
                    ? 'bg-brand-100 text-brand-800'
                    : claim.status === 'rejected'
                      ? 'bg-slate-200 text-slate-600'
                      : 'bg-amber-100 text-amber-800'
                }`}
              >
                {t(`claim.status.${claim.status}`)}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{claim.detail}</p>
            <p className="mt-1 text-xs text-slate-400">{formatDate(claim.createdAt, locale)}</p>

            {/* The admin's words, verbatim. A decision paraphrased into a status badge is a
                decision the buyer cannot argue with. */}
            {claim.adminNote && (
              <p className="mt-2 rounded-lg bg-white p-2.5 text-sm text-slate-700">
                <span className="font-semibold">{t('claim.decision')}: </span>
                {claim.adminNote}
              </p>
            )}
          </div>
        ))}

        {!active && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-secondary w-full text-sm"
          >
            {t('claim.fileAnother')}
          </button>
        )}
        {!active && open && form}
      </section>
    );
  }

  return (
    <section className="card">
      {open ? (
        <div className="space-y-3">
          <h2 className="font-bold text-slate-900">{t('claim.title')}</h2>
          {form}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900">{t('claim.problemTitle')}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{t('claim.problemHelp')}</p>
          </div>
          <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-sm">
            <Icon name="review" className="h-4 w-4" />
            {t('claim.report')}
          </button>
        </div>
      )}
    </section>
  );
}
