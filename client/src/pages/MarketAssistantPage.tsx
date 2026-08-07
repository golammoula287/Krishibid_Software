import type { MarketAnswerDto } from '@krishibid/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/icons.js';
import { ErrorNote } from '../components/ui.js';
import { api } from '../lib/api.js';
import { formatBdt } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  degraded?: boolean;
}

const STARTERS = ['market.q1', 'market.q2', 'market.q3', 'market.q4'] as const;

/**
 * A chat over the marketplace's own numbers.
 *
 * The farming advisor answers from a knowledge base of agronomy; this answers from the database.
 * They are different questions with different sources, and one assistant guessing which you meant
 * would answer both worse.
 *
 * The figures behind every answer are on the page, not hidden. An assistant quoting a price is
 * asking to be trusted; an assistant quoting a price next to the live table it came from is
 * showing its work — and the table is useful on its own to somebody who would rather read than
 * ask.
 */
export default function MarketAssistantPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  const snapshot = useQuery({
    queryKey: ['market-snapshot'],
    queryFn: () => api.get<MarketAnswerDto['snapshot']>('/market/snapshot'),
    // These are live prices. Two minutes is short enough to be true and long enough that a
    // conversation does not re-query on every turn.
    staleTime: 2 * 60_000,
  });

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const ask = useMutation({
    mutationFn: (q: string) => api.post<MarketAnswerDto>('/market/ask', { question: q }),
    onSuccess: (result) =>
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: result.answer, degraded: result.degraded },
      ]),
  });

  const send = (raw: string): void => {
    const q = raw.trim();
    if (!q || ask.isPending) return;
    setTurns((prev) => [...prev, { role: 'user', content: q }]);
    setQuestion('');
    ask.mutate(q);
  };

  const snap = snapshot.data;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="flex h-[calc(100dvh-9rem)] flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 pb-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Icon name="insights" className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-bold text-slate-900">{t('market.assistantTitle')}</h1>
            <p className="text-xs text-slate-500">{t('market.assistantSubtitle')}</p>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto py-5">
          {turns.length === 0 && (
            <div className="mx-auto max-w-lg py-6 text-center">
              <p className="text-sm leading-relaxed text-slate-600">{t('market.assistantIntro')}</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {STARTERS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => send(t(key))}
                    className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm text-slate-700 transition hover:border-brand-300 hover:text-brand-800"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, i) =>
            turn.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-700 px-4 py-2.5 text-[15px] text-white">
                  {turn.content}
                </p>
              </div>
            ) : (
              <div key={i} className="flex gap-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Icon name="insights" className="h-4 w-4" />
                </span>
                <div className="min-w-0 max-w-[85%] rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3">
                  {/* When generation fails the figures are still the answer to most of these
                      questions, so the raw snapshot is returned — labelled, not disguised. */}
                  {turn.degraded && (
                    <p className="mb-2 inline-block rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                      {t('market.figuresOnly')}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">
                    {turn.content}
                  </p>
                </div>
              </div>
            ),
          )}

          {ask.isPending && (
            <div className="flex gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <Icon name="insights" className="h-4 w-4" />
              </span>
              <div className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-4">
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="h-2 w-2 animate-bounce rounded-full bg-brand-400"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </div>
            </div>
          )}

          {ask.isError && <ErrorNote error={ask.error} />}
          <div ref={bottom} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(question);
          }}
          className="flex gap-2 border-t border-slate-200 bg-surface py-3"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('market.askPlaceholder')}
            aria-label={t('market.askPlaceholder')}
            className="field flex-1"
            maxLength={500}
          />
          <button
            type="submit"
            className="btn-primary px-5"
            disabled={ask.isPending || !question.trim()}
            aria-label={t('advisor.send')}
          >
            <Icon name="arrowRight" className="h-5 w-5" />
          </button>
        </form>
      </div>

      {/* The numbers the answers come from. An assistant quoting a price is asking to be
          trusted; one quoting it beside the live table is showing its work. */}
      <aside className="space-y-3 lg:sticky lg:top-20">
        <div className="card">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t('market.rightNow')}
          </h2>
          {snap && (
            <dl className="mt-3 space-y-2 text-sm">
              {(
                [
                  ['liveListings', snap.totals.liveListings],
                  ['auctions', snap.totals.auctions],
                  ['fixed', snap.totals.fixed],
                  ['suppliers', snap.totals.suppliers],
                  ['districts', snap.totals.districts],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex justify-between">
                  <dt className="text-slate-500">{t(`market.stat.${key}`)}</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {snap && snap.categories.length > 0 && (
          <div className="card">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t('market.priceRange')}
            </h2>
            <ul className="mt-3 space-y-2.5">
              {snap.categories.slice(0, 6).map((c) => (
                <li key={c.slug}>
                  <p className="text-sm font-medium text-slate-800">{c.name}</p>
                  <p className="text-xs tabular-nums text-slate-500">
                    {formatBdt(c.lowPoisha, locale)} – {formatBdt(c.highPoisha, locale)} /{' '}
                    {t(`units.${c.unit}`)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
