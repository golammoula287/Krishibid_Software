import type { ListingDto } from '@krishibid/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from './ConfirmDialog.js';
import { Icon } from './icons.js';
import { ErrorNote } from './ui.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.js';

/**
 * Edit and remove, for the supplier who listed it.
 *
 * A seller could publish a lot and then do nothing to it — a typo in the title, a price entered
 * with one zero too many, a photograph that turned out blurry, and the only remedy was to cancel
 * and start again. Cancelling is also refused once anybody has bid, so the common case was a
 * listing nobody could fix.
 *
 * Both actions are shown together because they answer the same question, and the destructive one
 * is second and quieter. The API enforces every rule independently — hiding a button is
 * presentation, and a request straight to the API has to be refused too.
 */
export default function OwnerControls({ listing }: { listing: ListingDto }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [confirmOpen, setConfirmOpen] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.del(`/marketplace/listings/${listing.id}`),
    onSuccess: async () => {
      toast.showSuccess('listing_removed');
      await queryClient.invalidateQueries({ queryKey: ['listings'] });
      await queryClient.invalidateQueries({ queryKey: ['my-listings'] });
      navigate('/dashboard');
    },
    onError: () => setConfirmOpen(false),
  });

  if (listing.status !== 'open') return null;

  // Cancelling is refused server-side once there are bids; saying so here means the seller finds
  // out before they tap rather than from a refusal.
  const hasBids = (listing.bidCount ?? 0) > 0;

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">{t('sell.yourListing')}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {hasBids ? t('sell.hasBidsNote') : t('sell.ownerHelp')}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate(`/listing/${listing.id}/edit`)}
            className="btn-secondary text-sm"
          >
            <Icon name="review" className="h-4 w-4" />
            {t('sell.edit')}
          </button>

          <button
            type="button"
            disabled={hasBids}
            onClick={() => setConfirmOpen(true)}
            className="btn-secondary text-sm text-red-700 disabled:opacity-40"
          >
            {t('sell.remove')}
          </button>
        </div>
      </div>

      {remove.isError && (
        <div className="mt-3">
          <ErrorNote error={remove.error} />
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t('sell.removeConfirmTitle')}
        body={t('sell.removeConfirmBody')}
        confirmLabel={t('sell.remove')}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
