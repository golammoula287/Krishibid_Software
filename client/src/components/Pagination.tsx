import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './icons.js';

/**
 * The pages to actually render, with gaps.
 *
 * A marketplace with sixty pages must not print sixty buttons. This keeps the first, the last,
 * and a window around where you are — the set somebody might plausibly want to reach in one tap —
 * and marks the omissions so the numbers do not look like they are lying about being consecutive.
 */
function windowed(page: number, pageCount: number, wide: boolean): (number | 'gap')[] {
  const max = wide ? 7 : 5;
  if (pageCount <= max) return Array.from({ length: pageCount }, (_, i) => i + 1);

  /**
   * A narrower window on a phone.
   *
   * Seven numbers plus two arrows is about 360px of controls before any gaps, which is the whole
   * width of the handsets a lot of this audience is on — the row wrapped or pushed the page
   * sideways. Five still gives first, last, current and a neighbour each side.
   */
  const neighbours = wide ? [page - 1, page, page + 1] : [page];
  const around = neighbours.filter((n) => n > 1 && n < pageCount);
  const shown = new Set([1, ...around, pageCount]);

  const out: (number | 'gap')[] = [];
  let previous = 0;
  for (const n of [...shown].sort((a, b) => a - b)) {
    if (n - previous > 1) out.push('gap');
    out.push(n);
    previous = n;
  }
  return out;
}

export default function Pagination({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number;
  pageCount: number;
  /** Shown as "87 products" — how much is on offer is information, not decoration. */
  total: number;
  onChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  // Measured rather than assumed: `sm` is where the row has the room for the wider window.
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 640px)').matches);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 640px)');
    const onChange = (e: MediaQueryListEvent): void => setWide(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  if (pageCount <= 1) {
    return total > 0 ? (
      <p className="mt-8 text-center text-sm text-slate-500">{t('market.totalProducts', { count: total })}</p>
    ) : null;
  }

  const step = (next: number) => (): void => {
    onChange(next);
    // Paging without this leaves you at the bottom of a grid you have already read.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <nav className="mt-10 flex flex-col items-center gap-3" aria-label={t('market.pagination')}>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={step(page - 1)}
          disabled={page <= 1}
          aria-label={t('common.previous')}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-brand-300 hover:text-brand-700 disabled:opacity-35 disabled:hover:border-slate-200"
        >
          <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
        </button>

        {windowed(page, pageCount, wide).map((entry, i) =>
          entry === 'gap' ? (
            <span key={`gap-${i}`} className="px-1 text-slate-400">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={step(entry)}
              aria-current={entry === page ? 'page' : undefined}
              className={`h-9 min-w-9 rounded-lg px-3 text-sm font-semibold tabular-nums transition ${
                entry === page
                  ? 'bg-brand-700 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700'
              }`}
            >
              {entry}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={step(page + 1)}
          disabled={page >= pageCount}
          aria-label={t('common.next')}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-brand-300 hover:text-brand-700 disabled:opacity-35 disabled:hover:border-slate-200"
        >
          <Icon name="arrowRight" className="h-4 w-4" />
        </button>
      </div>

      <p className="text-sm text-slate-500">
        {t('market.pageOf', { page, pageCount, count: total })}
      </p>
    </nav>
  );
}
