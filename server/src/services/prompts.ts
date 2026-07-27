import type { RetrievedChunk } from '@krishibid/shared';

/**
 * The grounding contract.
 *
 * Every clause exists because its absence produces a specific failure:
 *  - "only from context"  without it the model answers from parametric memory and
 *                         cites a passage that doesn't support the claim.
 *  - "cite every claim"   makes the answer auditable; a claim with no marker is a
 *                         claim we can detect and reject.
 *  - "say when unsure"    the `sufficient: false` path. Recommending an extension
 *                         officer is a correct answer; inventing a pesticide dose
 *                         is a harmful one.
 *  - "reply in <locale>"  the corpus is bilingual, so the model would otherwise
 *                         answer in whichever language the top chunk happened to be.
 */
export const SYSTEM_PROMPT = `You are KrishiBid AI, an agricultural advisor for smallholder farmers in Bangladesh.

STRICT RULES:
1. Answer ONLY using the numbered CONTEXT passages provided. Never use outside knowledge.
2. Cite the passage number in square brackets after every factual claim, e.g. "Apply once at flowering [2]."
3. If the CONTEXT does not contain enough information to answer, set "sufficient" to false, do not guess, and tell the farmer to consult a local agricultural extension officer.
4. Never invent pesticide names, chemical dosages, prices or dates. If a specific quantity is not in the CONTEXT, say it is not specified.
5. Write in the farmer's language. Keep it practical and plain — short sentences, concrete steps, no jargon.
6. If the question is not about agriculture, set "sufficient" to false and say you can only help with farming questions.

Return ONLY a JSON object with these keys:
  "answer"       - your reply, in the requested language, with [n] citation markers
  "citedMarkers" - array of the passage numbers you actually cited
  "sufficient"   - true only if the CONTEXT genuinely answered the question`;

export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    citedMarkers: { type: 'array', items: { type: 'integer' } },
    sufficient: { type: 'boolean' },
  },
  required: ['answer', 'citedMarkers', 'sufficient'],
} as const;

export function buildAnswerPrompt(
  question: string,
  chunks: RetrievedChunk[],
  locale: 'bn' | 'en',
): string {
  const language = locale === 'bn' ? 'Bengali (বাংলা)' : 'English';

  const context = chunks
    .map((c, i) => {
      const heading = c.section ? `${c.title} — ${c.section}` : c.title;
      return `[${i + 1}] (${heading})\n${c.text}`;
    })
    .join('\n\n');

  return `CONTEXT:
${context.length > 0 ? context : '(no passages retrieved)'}

QUESTION: ${question}

Reply in ${language}.`;
}

/**
 * Rerank prompt.
 *
 * Scores passages individually rather than asking for a sorted list: a model asked
 * to "return the best 4 in order" tends to drop or duplicate ids, whereas
 * per-passage scores are trivially validatable and let us keep our own tie-break.
 */
export const RERANK_SYSTEM = `You score how well each passage answers a question. Respond ONLY with JSON: {"scores":[{"n":1,"score":0.0}]} where score is 0.0 (irrelevant) to 1.0 (directly answers it). Score every passage you are given.`;

export const RERANK_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, score: { type: 'number' } },
        required: ['n', 'score'],
      },
    },
  },
  required: ['scores'],
} as const;

export function buildRerankPrompt(question: string, chunks: RetrievedChunk[]): string {
  const passages = chunks.map((c, i) => `[${i + 1}] ${c.text.slice(0, 600)}`).join('\n\n');
  return `QUESTION: ${question}\n\nPASSAGES:\n${passages}`;
}
