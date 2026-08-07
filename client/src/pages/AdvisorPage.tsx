import type { AnswerDto, Citation } from '@krishibid/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/icons.js';
import { ErrorNote } from '../components/ui.js';
import { api } from '../lib/api.js';
import { currentLocale } from '../lib/i18n.js';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  sufficient?: boolean;
  degraded?: boolean;
  cached?: boolean;
}

/** Openers, in both languages, so the first question does not have to be invented. */
const STARTERS = [
  'advisor.starter1',
  'advisor.starter2',
  'advisor.starter3',
  'advisor.starter4',
] as const;

/**
 * Renders citation markers as clickable superscripts.
 *
 * Making [n] a real link to the source is the visible half of the grounding guarantee: an answer
 * the farmer can check is an answer they can trust, and it is what distinguishes this from a
 * chatbot that sounds confident.
 */
function AnswerText({ text, citations }: { text: string; citations: Citation[] }) {
  const parts = text.split(/(\[\d+])/g);

  return (
    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">
      {parts.map((part, i) => {
        const match = /^\[(\d+)]$/.exec(part);
        if (!match) return <span key={i}>{part}</span>;

        const n = Number(match[1]);
        const citation = citations.find((c) => c.n === n);
        if (!citation) return null;

        return (
          <a
            key={i}
            href={citation.url}
            target="_blank"
            rel="noreferrer noopener"
            title={citation.title}
            className="mx-0.5 rounded bg-brand-100 px-1 align-super text-[10px] font-bold text-brand-800 hover:bg-brand-200"
          >
            {n}
          </a>
        );
      })}
    </p>
  );
}

/**
 * Sources, folded away.
 *
 * They were always open, which put a list of URLs between every answer and the next question and
 * made a two-line reply look like a document. Collapsed, with the count on the summary, so the
 * fact that an answer IS sourced stays visible while the list itself is opt-in.
 */
function Sources({ citations }: { citations: Citation[] }) {
  const { t } = useTranslation();
  if (citations.length === 0) return null;

  return (
    <details className="mt-3 border-t border-slate-100 pt-2.5">
      <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-brand-700">
        {t('advisor.sources')} · {citations.length}
      </summary>
      <ul className="mt-2 space-y-1">
        {citations.map((c) => (
          <li key={c.n} className="text-xs">
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-brand-700 underline hover:text-brand-900"
            >
              [{c.n}] {c.title}
              {c.section ? ` — ${c.section}` : ''}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The Bangla farming advisor.
 *
 * Laid out as a conversation that owns the screen: the thread scrolls, the composer is pinned to
 * the bottom, and neither depends on a hardcoded viewport arithmetic. It previously used
 * `h-[calc(100vh-14rem)]` — a number guessed against a header that has since changed height and a
 * footer that no longer renders here — which is why the page had a screen of dead space in the
 * middle and the composer floated in it.
 *
 * The answer is only ever as good as the knowledge base behind it, and the interface says so:
 * "not enough in the sources" is shown as its own state rather than dressed up as an answer.
 */
export default function AdvisorPage() {
  const { t } = useTranslation();
  const locale = currentLocale();

  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const ask = useMutation({
    mutationFn: (q: string) =>
      api.post<AnswerDto>('/advisory/ask', { question: q, locale, sessionId }),
    onSuccess: (answer) => {
      setSessionId(answer.sessionId);
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: answer.answer,
          citations: answer.citations,
          sufficient: answer.sufficient,
          degraded: answer.degraded,
          cached: answer.cached,
        },
      ]);
    },
  });

  const send = (raw: string): void => {
    const q = raw.trim();
    if (!q || ask.isPending) return;
    setTurns((prev) => [...prev, { role: 'user', content: q }]);
    setQuestion('');
    ask.mutate(q);
  };

  return (
    /**
     * Fills the viewport below the header, whatever that header happens to be.
     *
     * `100dvh` rather than `100vh`: on mobile Safari and Chrome the address bar makes `vh` taller
     * than what is actually visible, so the composer sat below the fold until you scrolled — on
     * the page whose entire job is a text box.
     */
    <div className="-mt-5 flex h-[calc(100dvh-4rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 py-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Icon name="advisor" className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-bold text-slate-900">{t('advisor.title')}</h1>
          <p className="text-xs text-slate-500">{t('advisor.subtitle')}</p>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto py-5">
        {turns.length === 0 && (
          <div className="mx-auto max-w-lg py-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              <Icon name="advisor" className="h-7 w-7" />
            </span>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">{t('advisor.intro')}</p>

            {/* Openers rather than a blank box. The hardest question to ask an assistant is the
                first one, and these also demonstrate that Bangla is understood. */}
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
                <Icon name="advisor" className="h-4 w-4" />
              </span>

              <div className="min-w-0 max-w-[85%] rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3">
                {/* Degraded and insufficient states are labelled, never disguised as a normal
                    answer. An advisor that hides how sure it is, is worse than no advisor. */}
                {turn.degraded && (
                  <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                    {t('advisor.degraded')}
                  </p>
                )}
                {turn.sufficient === false && !turn.degraded && (
                  <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                    {t('advisor.insufficient')}
                  </p>
                )}
                {turn.cached && (
                  <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
                    {t('advisor.cached')}
                  </p>
                )}

                <AnswerText text={turn.content} citations={turn.citations ?? []} />
                <Sources citations={turn.citations ?? []} />
              </div>
            </div>
          ),
        )}

        {ask.isPending && (
          <div className="flex gap-2.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <Icon name="advisor" className="h-4 w-4" />
            </span>
            {/* Three dots rather than a spinner with a label: it reads as the other side typing,
                which is what is actually happening. */}
            <div className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-4">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-2 w-2 animate-bounce rounded-full bg-brand-400"
                  style={{ animationDelay: `${delay}ms` }}
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
          placeholder={t('advisor.placeholder')}
          className="field flex-1"
          aria-label={t('advisor.placeholder')}
          maxLength={1000}
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
  );
}
