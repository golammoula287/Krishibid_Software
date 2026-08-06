import type { SaleMode, Unit } from '@krishibid/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/icons.js';
import PhotoPicker from '../components/PhotoPicker.js';
import { ErrorNote } from '../components/ui.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useCategories } from '../lib/catalogue.js';
import { formatBdt } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * Listing something for sale, in either shop.
 *
 * One form with the sale mode chosen at the top rather than two pages. The fields that differ are
 * three out of nine, and splitting them would mean a supplier who picked the wrong shop retyping
 * everything — including the description, which is the part they actually laboured over.
 *
 * Prices are entered in whole taka and converted to integer poisha at submit, so a float never
 * reaches the wire. This codebase does not put money in a float anywhere, and the entry point is
 * where that discipline has to start.
 */
export default function CreateListingPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);

  const categories = useCategories();

  const [saleMode, setSaleMode] = useState<SaleMode>('auction');
  /**
   * Separate from the rest of the form because it is already on the server.
   *
   * These are URLs of photographs that have been uploaded; the form fields are text nobody has
   * committed yet. Keeping them apart is what lets an upload survive a failed submit.
   */
  const [photos, setPhotos] = useState<string[]>([]);
  const [form, setForm] = useState({
    categorySlug: '',
    title: '',
    quantity: '',
    unit: 'kg' as Unit,
    qualityGrade: 'A' as 'A' | 'B' | 'C',
    reservePriceBdt: '',
    bidWindowHours: '48',
    pricePerUnitBdt: '',
    description: '',
  });

  const set = (patch: Partial<typeof form>): void => setForm({ ...form, ...patch });

  const category = categories.data?.find((c) => c.slug === form.categorySlug);
  /** Only the units this category is actually sold in — "40 litres of rice" is not offered. */
  const units: Unit[] = category?.units ?? ['kg'];

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/marketplace/listings', {
        categorySlug: form.categorySlug,
        title: form.title,
        quantity: Number(form.quantity),
        unit: form.unit,
        qualityGrade: form.qualityGrade,
        district: user?.district ?? 'Dhaka',
        description: form.description || undefined,
        photos,
        saleMode,
        ...(saleMode === 'auction'
          ? {
              reservePricePoisha: Math.round(Number(form.reservePriceBdt) * 100),
              bidWindowHours: Number(form.bidWindowHours),
            }
          : {
              pricePerUnitPoisha: Math.round(Number(form.pricePerUnitBdt) * 100),
              // Stock starts as the whole lot. Selling part of it is the buyer's choice.
              stock: Number(form.quantity),
            }),
      }),
    onSuccess: (listing) => navigate(`/listing/${listing.id}`),
  });

  /** Shown live, because the total is what a supplier is actually deciding about. */
  const fixedTotalPoisha =
    Math.round(Number(form.pricePerUnitBdt) * 100) * Number(form.quantity || 0);

  return (
    <form
      className="mx-auto max-w-2xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h1 className="text-2xl font-bold text-brand-900">{t('market.createListing')}</h1>

      {/* ---- which shop ---- */}
      <div className="card space-y-3">
        <span className="label">{t('sell.howToSell')}</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['auction', 'fixed'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSaleMode(mode)}
              aria-pressed={saleMode === mode}
              className={`rounded-xl border p-3 text-left transition ${
                saleMode === mode
                  ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                  : 'border-slate-200 hover:border-brand-200'
              }`}
            >
              <span className="flex items-center gap-2 font-semibold text-brand-900">
                <Icon name={mode === 'auction' ? 'trending' : 'basket'} className="h-4 w-4" />
                {t(`market.shop.${mode}`)}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-600">
                {t(`sell.${mode}Help`)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <label htmlFor="category" className="label">
            {t('sell.category')}
          </label>
          <select
            id="category"
            value={form.categorySlug}
            onChange={(e) => {
              const next = categories.data?.find((c) => c.slug === e.target.value);
              // The unit resets with the category, or a leftover unit could be one this
              // category does not use and the server would reject the submit.
              set({ categorySlug: e.target.value, unit: (next?.units[0] ?? 'kg') as Unit });
            }}
            className="field"
            required
          >
            <option value="">—</option>
            {categories.data?.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.names[locale]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="title" className="label">
            {t('sell.productName')}
          </label>
          <input
            id="title"
            className="field"
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder={t('sell.productPlaceholder')}
            required
            minLength={3}
            maxLength={120}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="qty" className="label">
              {t('market.quantity')}
            </label>
            <input
              id="qty"
              type="number"
              inputMode="decimal"
              step="any"
              min="1"
              value={form.quantity}
              onChange={(e) => set({ quantity: e.target.value })}
              className="field"
              required
            />
          </div>
          <div>
            <label htmlFor="unit" className="label">
              {t('sell.unit')}
            </label>
            <select
              id="unit"
              value={form.unit}
              onChange={(e) => set({ unit: e.target.value as Unit })}
              className="field"
              disabled={!form.categorySlug}
            >
              {units.map((u) => (
                <option key={u} value={u}>
                  {t(`units.${u}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="grade" className="label">
            {t('market.grade')}
          </label>
          <select
            id="grade"
            value={form.qualityGrade}
            onChange={(e) => set({ qualityGrade: e.target.value as 'A' | 'B' | 'C' })}
            className="field"
          >
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
      </div>

      {/* ---- price, which is where the two shops differ ---- */}
      <div className="card space-y-3">
        {saleMode === 'auction' ? (
          <>
            <div>
              <label htmlFor="reserve" className="label">
                {t('sell.reserveLabel')}
              </label>
              <input
                id="reserve"
                type="number"
                inputMode="numeric"
                min="1"
                value={form.reservePriceBdt}
                onChange={(e) => set({ reservePriceBdt: e.target.value })}
                className="field"
                required
              />
              <p className="mt-1 text-xs text-slate-500">{t('sell.reserveHelp')}</p>
            </div>

            <div>
              <label htmlFor="window" className="label">
                {t('sell.bidWindow')}
              </label>
              <input
                id="window"
                type="number"
                min="1"
                max="168"
                value={form.bidWindowHours}
                onChange={(e) => set({ bidWindowHours: e.target.value })}
                className="field"
                required
              />
              {/* Perishables get a nudge, not a block: a supplier who knows their cold storage
                  better than we do should not be stopped. */}
              {category?.perishable && Number(form.bidWindowHours) > 48 && (
                <p className="mt-1 text-xs font-medium text-amber-700">
                  {t('sell.perishableWarning')}
                </p>
              )}
            </div>
          </>
        ) : (
          <div>
            <label htmlFor="price" className="label">
              {t('sell.pricePerUnit', { unit: t(`units.${form.unit}`) })}
            </label>
            <input
              id="price"
              type="number"
              inputMode="decimal"
              step="any"
              min="1"
              value={form.pricePerUnitBdt}
              onChange={(e) => set({ pricePerUnitBdt: e.target.value })}
              className="field"
              required
            />
            {fixedTotalPoisha > 0 && (
              <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900">
                {t('sell.fixedTotal', { amount: formatBdt(fixedTotalPoisha, locale) })}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">{t('sell.stockHelp')}</p>
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
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            className="field min-h-24"
            maxLength={1000}
          />
        </div>

        {create.isError && <ErrorNote error={create.error} />}

        <button type="submit" className="btn-primary w-full" disabled={create.isPending}>
          {create.isPending ? t('common.loading') : t('market.createListing')}
        </button>
      </div>
    </form>
  );
}
