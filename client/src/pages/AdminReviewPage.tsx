import type { ReviewQueueItemDto } from '@krishibid/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../components/ConfirmDialog.js';
import { CardSkeleton, ErrorNote } from '../components/ui.js';
import { useReviewDecision, useReviewQueue } from '../lib/account.js';
import { formatDate } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * The face-similarity score, presented as advice rather than a verdict.
 *
 * Deliberately not styled as pass/fail with a green tick: it is a cosine distance between two
 * photographs computed by a small local model, it is not a liveness check, and a photo of a
 * photo can score well. Framing it as a decision would invite a reviewer to stop looking.
 */
function FaceScore({ item }: { item: ReviewQueueItemDto }) {
  const { t } = useTranslation();
  const face = item.application.faceSimilarity;

  if (!face) {
    return <p className="text-xs text-slate-500">{t('admin.faceNotComputed')}</p>;
  }
  if (face.unavailableReason) {
    return (
      <p className="text-xs text-slate-500">
        {t('admin.faceUnavailable')} — {face.unavailableReason}
      </p>
    );
  }

  const percent = Math.round(face.score * 100);

  return (
    <div className="rounded-lg bg-slate-50 p-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-500">{t('admin.faceSimilarity')}</span>
        <span className="text-sm font-bold tabular-nums">{percent}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full ${face.passed ? 'bg-brand-600' : 'bg-amber-500'}`}
          style={{ width: `${percent}%` }}
          aria-hidden
        />
      </div>
      <p className="mt-1.5 text-xs text-slate-500">{t('admin.faceAdvisory')}</p>
    </div>
  );
}

function ApplicationCard({ item }: { item: ReviewQueueItemDto }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const decide = useReviewDecision();

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmApprove, setConfirmApprove] = useState(false);

  return (
    <article className="card space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-brand-900">{item.name}</h2>
          <p className="text-sm text-slate-600">
            {item.phone} · {item.district}
          </p>
          <p className="text-xs text-slate-400">
            {t('admin.submitted')} {formatDate(item.submittedAt, locale)}
          </p>
        </div>
      </header>

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">{t('account.nameOnNid')}</dt>
          <dd className="text-right font-medium">{item.application.fullNameOnNid ?? '—'}</dd>
        </div>
      </dl>

      <FaceScore item={item} />

      {/* Signed, short-lived URLs. Opened in a new tab rather than embedded so an NID image is
          not sitting rendered on screen longer than the reviewer needs it. */}
      <div className="flex flex-wrap gap-2">
        {item.application.documents.map((doc) =>
          doc.viewUrl ? (
            <a
              key={doc.kind}
              href={doc.viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-sm"
            >
              {t(`account.documents.${doc.kind}`)}
            </a>
          ) : (
            <span key={doc.kind} className="badge bg-slate-100 text-slate-500">
              {t(`account.documents.${doc.kind}`)} — {t('admin.linkUnavailable')}
            </span>
          ),
        )}
      </div>

      {rejecting ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            decide.mutate(
              { userId: item.userId, decision: 'reject', reason },
              { onSuccess: () => setRejecting(false) },
            );
          }}
        >
          <label htmlFor={`reason-${item.userId}`} className="label">
            {t('admin.rejectReason')}
          </label>
          <textarea
            id={`reason-${item.userId}`}
            className="field"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
            // The applicant reads this and acts on it, so a vague reason wastes a resubmission.
            placeholder={t('admin.rejectReasonPlaceholder')}
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-danger flex-1" disabled={decide.isPending}>
              {t('admin.confirmReject')}
            </button>
            <button type="button" className="btn-secondary flex-1" onClick={() => setRejecting(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary flex-1"
            onClick={() => setConfirmApprove(true)}
            disabled={decide.isPending}
          >
            {t('admin.approve')}
          </button>
          <button
            type="button"
            className="btn-secondary flex-1"
            onClick={() => setRejecting(true)}
            disabled={decide.isPending}
          >
            {t('admin.reject')}
          </button>
        </div>
      )}

      {/* Approval lets someone start taking money from buyers, so it gets a second step. */}
      <ConfirmDialog
        open={confirmApprove}
        title={t('admin.confirmApproveTitle')}
        body={t('admin.confirmApproveBody', { name: item.name })}
        confirmLabel={t('admin.approve')}
        busy={decide.isPending}
        onConfirm={() =>
          decide.mutate(
            { userId: item.userId, decision: 'approve' },
            { onSuccess: () => setConfirmApprove(false) },
          )
        }
        onCancel={() => setConfirmApprove(false)}
      />
    </article>
  );
}

export default function AdminReviewPage() {
  const { t } = useTranslation();
  const queue = useReviewQueue();

  if (queue.isLoading) return <CardSkeleton count={2} />;
  if (queue.isError) return <ErrorNote error={queue.error} onRetry={() => void queue.refetch()} />;

  const items = queue.data ?? [];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-brand-900">{t('admin.reviewQueue')}</h1>
        <p className="text-sm text-slate-600">
          {items.length > 0 ? t('admin.pendingCount', { count: items.length }) : t('admin.queueEmpty')}
        </p>
      </header>

      {items.map((item) => (
        <ApplicationCard key={item.userId} item={item} />
      ))}
    </div>
  );
}
