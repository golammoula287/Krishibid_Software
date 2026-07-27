import type { DiagnosisDto } from '@krishibid/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorNote, Spinner } from '../components/ui.js';
import { api, apiRequest } from '../lib/api.js';
import { compressImage, formatDate } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

function ResultCard({ result }: { result: DiagnosisDto }) {
  const { t } = useTranslation();
  const top = result.predictions[0];

  // Uncertain results deliberately show NO disease name and NO remedy. Presenting a
  // low-confidence guess is how a farmer sprays the wrong chemical on a healthy crop.
  if (result.uncertain) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="font-bold text-amber-900">⚠️ {t('diagnose.uncertain')}</p>
        <p className="mt-1 text-sm text-amber-800">{t('diagnose.uncertainHelp')}</p>
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <div>
        <p className="text-xs text-slate-500">{t('diagnose.result')}</p>
        <p className="text-lg font-bold text-brand-900">{top?.diseaseSlug}</p>
        <p className="text-sm text-slate-600">
          {t('diagnose.confidence')}: {Math.round((top?.confidence ?? 0) * 100)}%
        </p>
      </div>

      {result.remedy && (
        <div className="border-t border-brand-50 pt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('diagnose.remedy')}
          </p>
          <p className="text-sm text-slate-800">{result.remedy}</p>
        </div>
      )}

      {/* The runner-up predictions are shown so the farmer can see the model was
          choosing between plausible options, not pronouncing an oracle. */}
      {result.predictions.length > 1 && (
        <ul className="border-t border-brand-50 pt-3 text-xs text-slate-500">
          {result.predictions.slice(1).map((p) => (
            <li key={p.label} className="flex justify-between">
              <span>{p.diseaseSlug}</span>
              <span>{Math.round(p.confidence * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DiagnosePage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const health = useQuery({
    queryKey: ['diagnosis-health'],
    queryFn: () => api.get<{ ready: boolean; modelVersion: string }>('/diagnosis/health'),
    staleTime: 5 * 60_000,
  });

  const history = useQuery({
    queryKey: ['diagnosis-history'],
    queryFn: () => api.get<DiagnosisDto[]>('/diagnosis/history?limit=10'),
  });

  const diagnose = useMutation({
    mutationFn: async (file: File) => {
      // Compress in the browser first. A raw 6 MB camera photo on a rural 3G link is
      // a minutes-long upload that often just fails; ~150 KB is indistinguishable to
      // a model that only sees a 224px crop.
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append('image', compressed, 'leaf.jpg');
      return apiRequest<DiagnosisDto>('/diagnosis', { method: 'POST', body: form });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['diagnosis-history'] });
    },
  });

  const onPick = (file: File | undefined): void => {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    diagnose.mutate(file);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-brand-900">{t('diagnose.title')}</h1>

      {health.data && !health.data.ready && (
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
          {t('diagnose.unavailable')}
        </div>
      )}

      <div className="card space-y-3">
        <p className="text-sm text-slate-600">{t('diagnose.help')}</p>

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          // `capture` opens the rear camera directly on a phone, skipping the file
          // browser — one fewer step for a user standing in a field.
          capture="environment"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])}
        />

        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="btn-primary w-full"
          disabled={diagnose.isPending || health.data?.ready === false}
        >
          📷 {t('diagnose.takePhoto')}
        </button>

        {preview && (
          <img
            src={preview}
            alt=""
            className="mx-auto max-h-64 rounded-xl object-contain"
          />
        )}

        {diagnose.isPending && <Spinner label={t('diagnose.analysing')} />}
        {diagnose.isError && <ErrorNote error={diagnose.error} />}
        {diagnose.data && <ResultCard result={diagnose.data} />}
      </div>

      {history.data && history.data.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-bold text-brand-900">{t('diagnose.history')}</h2>
          {history.data.map((item) => (
            <div key={item.id} className="card flex items-center gap-3">
              <img src={item.imageUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">
                  {item.uncertain ? t('diagnose.uncertain') : item.predictions[0]?.diseaseSlug}
                </p>
                <p className="text-xs text-slate-500">{formatDate(item.createdAt, locale)}</p>
              </div>
              {!item.uncertain && (
                <span className="badge bg-brand-100 text-brand-800">
                  {Math.round((item.predictions[0]?.confidence ?? 0) * 100)}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
