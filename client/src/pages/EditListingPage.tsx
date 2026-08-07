import type { ListingDto } from '@krishibid/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import PhotoPicker from '../components/PhotoPicker.js';
import { CardSkeleton, ErrorNote } from '../components/ui.js';
import { api, apiRequest } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { formatBdt } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';
import { useToast } from '../lib/toast.js';

/**
 * Correcting a lot already on the shelf.
 *
 * Not the create form with a flag. Half of what create asks — category, unit, sale mode, the bid
 * window — cannot be changed after publishing, because changing them replaces the thing rather
 * than correcting it. A form showing six disabled fields to explain that is a worse way of saying
 * it than simply not showing them.
 *
 * Prices are entered in whole taka and converted to integer poisha on submit, so a float never
 * reaches the wire.
 */
export default function EditListingPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const locale = currentLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const user = useAuth((s) => s.user);

  const listing = useQuery({
    queryKey: ['listing', id],
    queryFn: () => api.get<ListingDto>(`/marketplace/listings/${id}`),
  });

  const [form, setForm] = useState({
    title: '',
    description: '',
    qualityGrade: 'A' as 'A' | 'B' | 'C',
    priceBdt: '',
    stock: '',
  });
  const [photos, setPhotos] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  const data = listing.data;

  /**
   * Filled once, when the listing arrives.
   *
   * Guarded by `ready` rather than keyed on the data: a refetch while somebody is halfway through
   * typing would otherwise throw their edits away and put the old values back.
   */
  useEffect(() => {
    if (!data || ready) return;
    setForm({
      title: data.title,
      description: data.description ?? '',
      qualityGrade: data.qualityGrade,
      priceBdt: String(
        ((data.saleMode === 'auction' ? data.reservePricePoisha : data.pricePerUnitPoisha) ?? 0) /
          100,
      ),
      stock: String(data.stock ?? ''),
    });
    setPhotos(data.photos);
    setReady(true);
  }, [data, ready]);

  const save = useMutation({
    mutationFn: () => {
      const isAuction = data?.saleMode === 'auction';
      return apiRequest<ListingDto>(`/marketplace/listings/${id}`, {
        method: 'PATCH',
        body: {
          title: form.title,
          description: form.description || undefined,
          qualityGrade: form.qualityGrade,
          photos,
          // Only the price field this listing's own shop uses. Sending both would leave a
          // document carrying a reserve and a unit price at once.
          ...(priceLocked
            ? {}
            : isAuction
              ? { reservePricePoisha: Math.round(Number(form.priceBdt) * 100) }
              : {
                  pricePerUnitPoisha: Math.round(Number(form.priceBdt) * 100),
                  stock: Number(form.stock),
                }),
        },
      });
    },
    onSuccess: async () => {
      toast.showSuccess('listing_updated');
      await queryClient.invalidateQueries({ queryKey: ['listing', id] });
      await queryClient.invalidateQueries({ queryKey: ['listings'] });
      navigate(`/listing/${id}`);
    },
  });

  if (listing.isLoading) return <CardSkeleton count={2} />;
  if (listing.isError) return <ErrorNote error={listing.error} onRetry={() => void listing.refetch()} />;
  if (!data) return null;

  if (user?.id !== data.farmerId) {
    return <ErrorNote error={new Error(t('sell.notYours'))} />;
  }

  const isAuction = data.saleMode === 'auction';
  /**
   * The price is frozen once anybody has bid.
   *
   * Somebody who bid against a reserve committed real money to a number; moving it under them
   * afterwards is moving the goalposts. Refused by the API too — this only means the seller finds
   * out before typing rather than after.
   */
  const priceLocked = isAuction && (data.bidCount ?? 0) > 0;

  return (
    <form
      className="mx-auto max-w-2xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('sell.editTitle')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t('sell.editHelp', { category: data.categorySlug })}
        </p>
      </div>

      <div className="card space-y-3">
        <div>
          <label htmlFor="title" className="label">
            {t('sell.productName')}
          </label>
          <input
            id="title"
            className="field"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            minLength={3}
            maxLength={120}
          />
        </div>

        <div>
          <label htmlFor="grade" className="label">
            {t('market.grade')}
          </label>
          <select
            id="grade"
            className="field"
            value={form.qualityGrade}
            onChange={(e) => setForm({ ...form, qualityGrade: e.target.value as 'A' | 'B' | 'C' })}
          >
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <label htmlFor="price" className="label">
            {isAuction
              ? t('sell.reserveLabel')
              : t('sell.pricePerUnit', { unit: t(`units.${data.unit}`) })}
          </label>
          <input
            id="price"
            type="number"
            inputMode="decimal"
            step="any"
            min="1"
            className="field"
            value={form.priceBdt}
            onChange={(e) => setForm({ ...form, priceBdt: e.target.value })}
            disabled={priceLocked}
            required={!priceLocked}
          />
          {priceLocked && (
            <p className="mt-1.5 text-xs font-medium text-amber-700">
              {t('sell.priceLocked', { count: data.bidCount ?? 0 })}
            </p>
          )}
        </div>

        {!isAuction && (
          <div>
            <label htmlFor="stock" className="label">
              {t('shop.available')}
            </label>
            <input
              id="stock"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              className="field"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
              required
            />
            {/* Zero is allowed and means sold out — a supplier who has run out should be able to
                say so without cancelling the listing. */}
            <p className="mt-1 text-xs text-slate-500">{t('sell.stockZeroNote')}</p>
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <PhotoPicker photos={photos} onChange={setPhotos} />

        <div>
          <label htmlFor="desc" className="label">
            {t('sell.description')}
          </label>
          <textarea
            id="desc"
            className="field min-h-24"
            maxLength={1000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        {save.isError && <ErrorNote error={save.error} />}

        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1" disabled={save.isPending}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate(`/listing/${id}`)}
          >
            {t('common.cancel')}
          </button>
        </div>

        {!priceLocked && Number(form.priceBdt) > 0 && (
          <p className="text-center text-xs text-slate-400">
            {formatBdt(Math.round(Number(form.priceBdt) * 100), locale)}
          </p>
        )}
      </div>
    </form>
  );
}
