import { MAX_LISTING_PHOTOS } from '@krishibid/shared';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './icons.js';
import { ErrorNote } from './ui.js';
import { uploadListingPhotos } from '../lib/photos.js';

/**
 * Photographs of a lot.
 *
 * Produce is the one thing on this platform a buyer cannot inspect before committing money to it,
 * and until now a listing was a paragraph of text and a grade letter. A photograph of the actual
 * sacks is the closest substitute for standing in the yard.
 *
 * Uploaded on selection rather than on submit. The supplier finds out immediately whether the
 * picture arrived, while they still have the phone in their hand and the lot in front of them —
 * and if the connection drops it costs one retry of one photo, not the whole form.
 */
export default function PhotoPicker({
  photos,
  onChange,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  const remaining = MAX_LISTING_PHOTOS - photos.length;

  const pick = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;

    setError(null);
    setBusy(true);
    setRatio(0);

    try {
      // Sliced here as well as at the route: selecting eight when two slots are left should
      // upload two, not fail the whole batch after the bytes have already gone.
      const urls = await uploadListingPhotos(Array.from(files).slice(0, remaining), (p) =>
        setRatio(p.ratio),
      );
      onChange([...photos, ...urls]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      setRatio(null);
      // Cleared so re-picking the same file fires a change event.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = (url: string): void => onChange(photos.filter((p) => p !== url));

  /** Promotion rather than drag-and-drop: one tap, and it works the same on a phone. */
  const makeCover = (url: string): void => onChange([url, ...photos.filter((p) => p !== url)]);

  return (
    <div>
      <span className="label">{t('sell.photos')}</span>
      <p className="mb-2 text-xs text-slate-500">{t('sell.photosHelp')}</p>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((url, index) => (
          <div key={url} className="relative aspect-square overflow-hidden rounded-xl bg-slate-100">
            <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />

            {index === 0 ? (
              <span className="absolute left-1 top-1 rounded-md bg-brand-700/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {t('sell.cover')}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => makeCover(url)}
                className="absolute left-1 top-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white"
              >
                {t('sell.makeCover')}
              </button>
            )}

            <button
              type="button"
              onClick={() => remove(url)}
              aria-label={t('sell.removePhoto')}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white"
            >
              ×
            </button>
          </div>
        ))}

        {remaining > 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-brand-200 text-brand-700 transition hover:border-brand-400 disabled:opacity-50"
          >
            <Icon name="camera" className="h-6 w-6" />
            <span className="text-xs font-medium">
              {busy ? t('common.loading') : t('sell.addPhoto')}
            </span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => void pick(e.target.files)}
      />

      {/* A real bar, not a spinner. On a slow connection the difference between "working" and
          "stuck" is the only thing the supplier wants to know. */}
      {busy && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: ratio === null ? '40%' : `${Math.round(ratio * 100)}%` }}
          />
        </div>
      )}

      {error != null && (
        <div className="mt-2">
          <ErrorNote error={error} />
        </div>
      )}
    </div>
  );
}
