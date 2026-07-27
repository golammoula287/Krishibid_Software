import type { AnswerDto, Citation } from '@krishibid/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorNote, Spinner } from '../components/ui.js';
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

/**
 * Renders citation markers as clickable superscripts.
 *
 * Making [n] a real link to the source is the visible half of the grounding
 * guarantee: an answer the farmer can check is an answer they can trust, and it is
 * what distinguishes this from a chatbot that sounds confident.
 */
function AnswerText({ text, citations }: { text: string; citations: Citation[] }) {
  const parts = text.split(/(\[\d+])/g);

  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
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

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;

    setTurns((prev) => [...prev, { role: 'user', content: q }]);
    setQuestion('');
    ask.mutate(q);
  };

  return (
    <div className="flex h-[calc(100vh-14rem)] flex-col md:h-[calc(100vh-16rem)]">
      <h1 className="mb-3 text-2xl font-bold text-brand-900">{t('advisor.title')}</h1>

      <div className="flex-1 space-y-3 overflow-y-auto pb-3">
        {turns.length === 0 && (
          <div className="card text-center text-sm text-slate-600">{t('advisor.intro')}</div>
        )}

        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-700 px-3.5 py-2.5 text-sm text-white">
                {turn.content}
              </p>
            </div>
          ) : (
            <div key={i} className="card max-w-[95%] space-y-2">
              {/* Degraded and insufficient states are labelled, never disguised as a
                  normal answer. */}
              {turn.degraded && (
                <p className="badge bg-amber-100 text-amber-800">{t('advisor.degraded')}</p>
              )}
              {turn.sufficient === false && !turn.degraded && (
                <p className="badge bg-slate-200 text-slate-700">{t('advisor.insufficient')}</p>
              )}
              {turn.cached && (
                <p className="badge bg-brand-100 text-brand-700">{t('advisor.cached')}</p>
              )}

              <AnswerText text={turn.content} citations={turn.citations ?? []} />

              {turn.citations && turn.citations.length > 0 && (
                <div className="border-t border-brand-50 pt-2">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t('advisor.sources')}
                  </p>
                  <ul className="space-y-0.5">
                    {turn.citations.map((c) => (
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
                </div>
              )}
            </div>
          ),
        )}

        {ask.isPending && <Spinner label={t('advisor.thinking')} />}
        {ask.isError && <ErrorNote error={ask.error} />}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t border-brand-100 bg-brand-50 pt-3">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('advisor.placeholder')}
          className="field flex-1"
          aria-label={t('advisor.placeholder')}
          maxLength={1000}
        />
        <button type="submit" className="btn-primary" disabled={ask.isPending || !question.trim()}>
          {t('advisor.send')}
        </button>
      </form>
    </div>
  );
}
