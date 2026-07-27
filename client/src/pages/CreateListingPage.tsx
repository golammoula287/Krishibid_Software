import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ErrorNote } from '../components/ui.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { currentLocale } from '../lib/i18n.js';

interface Crop {
  slug: string;
  names: { bn: string; en: string };
}

export default function CreateListingPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);

  const [form, setForm] = useState({
    cropSlug: '',
    quantityKg: '',
    qualityGrade: 'A' as 'A' | 'B' | 'C',
    // Entered in whole BDT for the farmer's convenience; converted to integer poisha
    // at submit, so the wire format is never a float.
    reservePriceBdt: '',
    bidWindowHours: '48',
    description: '',
  });

  const crops = useQuery({
    queryKey: ['crops'],
    queryFn: () => api.get<Crop[]>('/crops'),
    staleTime: 60 * 60_000,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/marketplace/listings', {
        cropSlug: form.cropSlug,
        quantityKg: Number(form.quantityKg),
        qualityGrade: form.qualityGrade,
        district: user?.district ?? 'Dhaka',
        reservePricePoisha: Math.round(Number(form.reservePriceBdt) * 100),
        bidWindowHours: Number(form.bidWindowHours),
        description: form.description || undefined,
      }),
    onSuccess: (listing) => navigate(`/listing/${listing.id}`),
  });

  return (
    <form
      className="card space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h1 className="text-xl font-bold text-brand-900">{t('market.createListing')}</h1>

      <div>
        <label htmlFor="crop" className="label">
          {t('market.allCrops')}
        </label>
        <select
          id="crop"
          value={form.cropSlug}
          onChange={(e) => setForm({ ...form, cropSlug: e.target.value })}
          className="field"
          required
        >
          <option value="">—</option>
          {crops.data?.map((crop) => (
            <option key={crop.slug} value={crop.slug}>
              {crop.names[locale]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="qty" className="label">
            {t('market.quantity')} ({t('common.kg')})
          </label>
          <input
            id="qty"
            type="number"
            inputMode="numeric"
            min="1"
            value={form.quantityKg}
            onChange={(e) => setForm({ ...form, quantityKg: e.target.value })}
            className="field"
            required
          />
        </div>
        <div>
          <label htmlFor="grade" className="label">
            {t('market.grade')}
          </label>
          <select
            id="grade"
            value={form.qualityGrade}
            onChange={(e) =>
              setForm({ ...form, qualityGrade: e.target.value as 'A' | 'B' | 'C' })
            }
            className="field"
          >
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="reserve" className="label">
          {t('market.reserve')} (৳)
        </label>
        <input
          id="reserve"
          type="number"
          inputMode="numeric"
          min="1"
          value={form.reservePriceBdt}
          onChange={(e) => setForm({ ...form, reservePriceBdt: e.target.value })}
          className="field"
          required
        />
      </div>

      <div>
        <label htmlFor="window" className="label">
          {t('market.closesIn')} (hours)
        </label>
        <input
          id="window"
          type="number"
          min="1"
          max="168"
          value={form.bidWindowHours}
          onChange={(e) => setForm({ ...form, bidWindowHours: e.target.value })}
          className="field"
          required
        />
      </div>

      <div>
        <label htmlFor="desc" className="label">
          {t('market.title')}
        </label>
        <textarea
          id="desc"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="field min-h-20"
          maxLength={1000}
        />
      </div>

      {create.isError && <ErrorNote error={create.error} />}

      <button type="submit" className="btn-primary w-full" disabled={create.isPending}>
        {create.isPending ? t('common.loading') : t('market.createListing')}
      </button>
    </form>
  );
}
