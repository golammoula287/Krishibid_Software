import type { AdvisorySourceDto, DiagnosisDto, DiseaseDto } from '@krishibid/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/icons.js';
import { CardSkeleton, ErrorNote, Spinner } from '../components/ui.js';
import { api, apiRequest } from '../lib/api.js';
import { compressImage, formatDate } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

type Tab = 'detect' | 'library' | 'sources';

const SEVERITY: Record<DiseaseDto['severity'], string> = {
  low: 'bg-slate-100 text-slate-600',
  moderate: 'bg-amber-100 text-amber-800',
  severe: 'bg-red-100 text-red-700',
};

/** A bar, because "72%" alone does not tell you whether that is a lot. */
function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${pct >= 80 ? 'bg-brand-600' : pct >= 60 ? 'bg-amber-500' : 'bg-slate-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 text-right text-xs font-semibold tabular-nums text-slate-600">{pct}%</span>
    </div>
  );
}

function ResultCard({ result }: { result: DiagnosisDto }) {
  const { t } = useTranslation();
  const top = result.predictions[0];

  /**
   * A withheld guess, said plainly.
   *
   * Below the confidence floor the model does not offer a remedy, and this says so rather than
   * showing its best guess in smaller type. Advising a spray off a coin-flip is the most harmful
   * thing this feature could do.
   */
  if (result.uncertain) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p className="flex items-center gap-2 font-bold text-amber-900">
          <Icon name="review" className="h-5 w-5" />
          {t('diagnose.uncertain')}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-amber-800">{t('diagnose.uncertainHelp')}</p>
        <a
          href="tel:16123"
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-900 px-4 py-2 text-sm font-semibold text-white"
        >
          <Icon name="phone" className="h-4 w-4" />
          {t('diagnose.callHelpline')}
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs uppercase tracking-wide text-slate-500">{t('diagnose.result')}</p>
      <p className="mt-0.5 text-xl font-bold text-brand-800">{top?.diseaseSlug}</p>
      <div className="mt-2.5">
        <Confidence value={top?.confidence ?? 0} />
      </div>

      {result.remedy && (
        <div className="mt-4 rounded-xl bg-brand-50 p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
            {t('diagnose.remedy')}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-brand-900">{result.remedy}</p>
        </div>
      )}

      {/* The runner-ups are shown so the farmer can see the model was choosing between plausible
          options, not pronouncing an oracle. */}
      {result.predictions.length > 1 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('diagnose.alsoConsidered')}
          </p>
          <ul className="space-y-2">
            {result.predictions.slice(1).map((p) => (
              <li key={p.label}>
                <p className="mb-1 text-xs text-slate-600">{p.diseaseSlug}</p>
                <Confidence value={p.confidence} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500">{t('diagnose.confirmNote')}</p>
    </div>
  );
}

/** One disease, opened in the order somebody standing in a field works through it. */
function DiseaseCard({ disease }: { disease: DiseaseDto }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [open, setOpen] = useState(false);

  const block = (labelKey: string, items: string[]) =>
    items.length > 0 && (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t(labelKey)}</p>
        <ul className="mt-1.5 space-y-1">
          {items.map((line) => (
            <li key={line} className="flex gap-2 text-sm leading-relaxed text-slate-700">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-500" />
              {line}
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-slate-900">{disease.names[locale]}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEVERITY[disease.severity]}`}>
              {t(`diagnose.severity.${disease.severity}`)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {disease.pathogen ? <em>{disease.pathogen}</em> : t('diagnose.pest')} · {disease.season[locale]}
          </p>
        </div>
        <Icon
          name="arrowRight"
          className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-100 p-4">
          {block('diagnose.symptoms', disease.symptoms[locale])}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t('diagnose.cause')}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{disease.cause[locale]}</p>
          </div>
          {block('diagnose.treatment', disease.treatment[locale])}
          {block('diagnose.prevention', disease.prevention[locale])}

          {/* No doses anywhere above. The right rate depends on the formulation and the soil, and
              a number invented here would be the most harmful thing on this platform. */}
          <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
            {t('diagnose.doseWarning')}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Crop disease: detect it, look it up, or go to somebody who knows.
 *
 * Three tabs because the model is only one of three answers, and on a deployment where it has not
 * been trained yet it is none of them. The library and the institution list stand on their own —
 * a page that went blank when the classifier was unavailable would be a page that had nothing to
 * say about crop disease, which is not true.
 */
export default function DiagnosePage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>('detect');
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [cropFilter, setCropFilter] = useState('');

  const health = useQuery({
    queryKey: ['diagnosis-health'],
    queryFn: () => api.get<{ ready: boolean; modelVersion: string }>('/diagnosis/health'),
    staleTime: 5 * 60_000,
  });

  const diseases = useQuery({
    queryKey: ['diseases'],
    queryFn: () => api.get<DiseaseDto[]>('/diagnosis/diseases'),
    staleTime: 60 * 60_000,
  });

  const sources = useQuery({
    queryKey: ['advisory-sources'],
    queryFn: () => api.get<AdvisorySourceDto[]>('/diagnosis/sources'),
    staleTime: 60 * 60_000,
  });

  const history = useQuery({
    queryKey: ['diagnosis-history'],
    queryFn: () => api.get<DiagnosisDto[]>('/diagnosis/history?limit=10'),
  });

  const diagnose = useMutation({
    mutationFn: async (file: File) => {
      // Compress in the browser first. A raw 6 MB camera photo on a rural 3G link is a
      // minutes-long upload that often just fails; ~150 KB is indistinguishable to a model that
      // only sees a 224px crop.
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append('image', compressed, 'leaf.jpg');
      return apiRequest<DiagnosisDto>('/diagnosis', { method: 'POST', body: form });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['diagnosis-history'] }),
  });

  const onPick = (file: File | undefined): void => {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    diagnose.mutate(file);
  };

  const modelDown = health.data?.ready === false;
  const crops = [...new Set((diseases.data ?? []).map((d) => d.cropSlug))];
  const shownDiseases = (diseases.data ?? []).filter(
    (d) => !cropFilter || d.cropSlug === cropFilter,
  );

  const TABS: { key: Tab; icon: 'diagnose' | 'learn' | 'advisor' }[] = [
    { key: 'detect', icon: 'diagnose' },
    { key: 'library', icon: 'learn' },
    { key: 'sources', icon: 'advisor' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('diagnose.title')}</h1>
        <p className="mt-0.5 text-sm text-slate-500">{t('diagnose.subtitle')}</p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {TABS.map(({ key, icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === key ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500'
            }`}
          >
            <Icon name={icon} className="h-4 w-4" />
            {t(`diagnose.tab.${key}`)}
          </button>
        ))}
      </div>

      {/* ----------------------------------------------------------- detect */}
      {tab === 'detect' && (
        <div className="space-y-4">
          {modelDown && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="flex items-center gap-2 font-semibold text-slate-800">
                <Icon name="review" className="h-4 w-4 text-slate-400" />
                {t('diagnose.unavailable')}
              </p>
              {/* Says what to do instead rather than leaving a dead screen. */}
              <p className="mt-1 text-sm text-slate-600">{t('diagnose.unavailableHelp')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setTab('library')} className="btn-secondary text-sm">
                  {t('diagnose.tab.library')}
                </button>
                <a href="tel:16123" className="btn-primary text-sm">
                  <Icon name="phone" className="h-4 w-4" />
                  {t('diagnose.callHelpline')}
                </a>
              </div>
            </div>
          )}

          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            // `capture` opens the rear camera directly on a phone, skipping the file browser —
            // one fewer step for a user standing in a field.
            capture="environment"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
          />

          {/* A dropzone, not a button. On a desktop somebody has the photo in a folder; on a
              phone the same target opens the camera. */}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={diagnose.isPending || modelDown}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              onPick(e.dataTransfer.files?.[0]);
            }}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 transition disabled:opacity-50 ${
              dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white hover:border-brand-400'
            }`}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              <Icon name="camera" className="h-7 w-7" />
            </span>
            <span className="font-semibold text-slate-800">{t('diagnose.takePhoto')}</span>
            <span className="text-xs text-slate-500">{t('diagnose.help')}</span>
          </button>

          {preview && (
            <img src={preview} alt="" className="mx-auto max-h-72 rounded-2xl object-contain" />
          )}

          {diagnose.isPending && <Spinner label={t('diagnose.analysing')} />}
          {diagnose.isError && <ErrorNote error={diagnose.error} />}
          {diagnose.data && <ResultCard result={diagnose.data} />}

          {history.data && history.data.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {t('diagnose.history')}
              </h2>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {history.data.map((item, i) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 p-3 ${i > 0 ? 'border-t border-slate-100' : ''}`}
                  >
                    <img src={item.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {item.uncertain ? t('diagnose.uncertain') : item.predictions[0]?.diseaseSlug}
                      </p>
                      <p className="text-xs text-slate-500">{formatDate(item.createdAt, locale)}</p>
                    </div>
                    {!item.uncertain && (
                      <span className="text-xs font-semibold tabular-nums text-slate-500">
                        {Math.round((item.predictions[0]?.confidence ?? 0) * 100)}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- library */}
      {tab === 'library' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('diagnose.libraryHelp')}</p>

          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setCropFilter('')}
              className={`badge shrink-0 ${cropFilter === '' ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}
            >
              {t('market.allCategories')}
            </button>
            {crops.map((slug) => (
              <button
                key={slug}
                type="button"
                onClick={() => setCropFilter(slug)}
                className={`badge shrink-0 ${cropFilter === slug ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}
              >
                {t(`crops.${slug}`, { defaultValue: slug })}
              </button>
            ))}
          </div>

          {diseases.isLoading && <CardSkeleton count={4} />}
          <div className="space-y-2.5">
            {shownDiseases.map((disease) => (
              <DiseaseCard key={disease.slug} disease={disease} />
            ))}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- sources */}
      {tab === 'sources' && (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-slate-600">{t('diagnose.sourcesHelp')}</p>

          {sources.isLoading && <CardSkeleton count={4} />}
          <div className="grid gap-3 sm:grid-cols-2">
            {sources.data?.map((source) => (
              <div key={source.slug} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-slate-900">{source.names[locale]}</p>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {t(`diagnose.sourceKind.${source.kind}`)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {source.about[locale]}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {/* The phone first where there is one — a person beats a website. */}
                  {source.phone && (
                    <a href={`tel:${source.phone}`} className="btn-primary text-sm">
                      <Icon name="phone" className="h-4 w-4" />
                      {source.phone}
                    </a>
                  )}
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="btn-secondary text-sm"
                  >
                    {t('diagnose.visitSite')}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
