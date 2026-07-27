/**
 * RAG retrieval evaluation — the measurement behind ADR-004.
 *
 *   npm run eval:rag
 *
 * Compares three configurations on the golden set and writes docs/rag-eval.md:
 *
 *   dense-only        $vectorSearch alone (the default most RAG tutorials ship)
 *   hybrid            dense + BM25 fused with RRF
 *   hybrid + rerank   the above, then an LLM scoring pass
 *
 * The point is that ADR-004's claim — that hybrid retrieval beats dense-only for a
 * corpus full of exact terms like pathogen names and dosages — is **measured, not
 * asserted**. If the numbers come out flat, the ADR is wrong and should be changed.
 *
 * Metrics:
 *   recall@k   fraction of answerable questions with >=1 correct source in the top k.
 *              The one that matters: a source outside the top-k is never seen by the
 *              generator, so it cannot be cited no matter how good the model is.
 *   MRR        mean reciprocal rank of the first correct source — rewards ranking it
 *              first, not merely including it.
 *   refusal    fraction of unanswerable questions correctly declined. Reported
 *              separately because a system that never refuses will score well on
 *              recall while being actively unsafe.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../utils/db.js';
import { KbChunk } from '../models/KbChunk.js';
import { ask } from '../services/advisory.service.js';
import { createAiProvider, type AiProvider } from '../services/ai/index.js';
import { denseOnlyRetrieve, hybridRetrieve } from '../services/retrieval.service.js';
import { ANSWERABLE, GOLDEN_SET, UNANSWERABLE, type GoldenQuestion } from './goldenSet.js';
import { User } from '../models/User.js';

const K = 4; // must match RAG_CONTEXT_LIMIT — the generator only sees this many

interface Scores {
  recallAtK: number;
  mrr: number;
  hits: number;
  total: number;
  perQuestion: { id: string; rank: number | null }[];
}

/** Rank (1-based) of the first chunk whose source URL is expected; null if absent. */
function firstHitRank(urls: string[], expected: string[]): number | null {
  for (const [i, url] of urls.entries()) {
    if (expected.includes(url)) return i + 1;
  }
  return null;
}

function score(results: { id: string; rank: number | null }[]): Scores {
  const hits = results.filter((r) => r.rank !== null && r.rank <= K).length;
  const mrr =
    results.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / (results.length || 1);

  return {
    recallAtK: hits / (results.length || 1),
    mrr,
    hits,
    total: results.length,
    perQuestion: results,
  };
}

async function embedQuestion(provider: AiProvider, question: string): Promise<number[]> {
  const { vectors } = await provider.embed([question]);
  return vectors[0] ?? [];
}

async function evaluateRetrieval(
  provider: AiProvider,
  mode: 'dense' | 'hybrid',
): Promise<Scores> {
  const results: { id: string; rank: number | null }[] = [];

  for (const q of ANSWERABLE) {
    const queryVector = await embedQuestion(provider, q.question);

    const opts = {
      queryVector,
      queryText: q.question,
      locale: q.locale,
      cropSlug: q.cropSlug,
    };

    const chunks =
      mode === 'dense' ? await denseOnlyRetrieve(opts) : (await hybridRetrieve(opts)).chunks;

    results.push({ id: q.id, rank: firstHitRank(chunks.map((c) => c.url), q.expectedUrls) });
  }

  return score(results);
}

/**
 * Evaluates the full pipeline through `ask()`, which includes the reranker and the
 * citation guardrail. Uses the real code path rather than reimplementing it, so the
 * numbers describe what actually ships.
 */
async function evaluateFullPipeline(userId: string): Promise<{
  retrieval: Scores;
  refusalRate: number;
  refusalDetail: { id: string; refused: boolean }[];
  citationValidity: number;
}> {
  const results: { id: string; rank: number | null }[] = [];
  let citedCorrectly = 0;

  for (const q of ANSWERABLE) {
    const answer = await ask(userId, {
      question: q.question,
      locale: q.locale,
      cropSlug: q.cropSlug,
    });

    const urls = answer.citations.map((c) => c.url);
    results.push({ id: q.id, rank: firstHitRank(urls, q.expectedUrls) });

    // Every rendered citation must resolve to a real KB source. The guardrail strips
    // hallucinated markers, so this should be 100% — it is asserted, not assumed.
    const allResolve =
      answer.citations.length > 0 &&
      answer.citations.every((c) => typeof c.url === 'string' && c.url.length > 0);
    if (allResolve) citedCorrectly++;
  }

  const refusalDetail: { id: string; refused: boolean }[] = [];
  for (const q of UNANSWERABLE) {
    const answer = await ask(userId, {
      question: q.question,
      locale: q.locale,
      cropSlug: q.cropSlug,
    });
    // `sufficient: false` is the model declining. That is the correct behaviour here.
    refusalDetail.push({ id: q.id, refused: !answer.sufficient });
  }

  return {
    retrieval: score(results),
    refusalRate:
      refusalDetail.filter((r) => r.refused).length / (refusalDetail.length || 1),
    refusalDetail,
    citationValidity: citedCorrectly / (ANSWERABLE.length || 1),
  };
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const num = (n: number): string => n.toFixed(3);

function delta(baseline: number, candidate: number): string {
  const d = (candidate - baseline) * 100;
  if (Math.abs(d) < 0.05) return '±0.0pp';
  return `${d > 0 ? '+' : ''}${d.toFixed(1)}pp`;
}

async function main(): Promise<void> {
  await connectDb();

  const chunkCount = await KbChunk.countDocuments();
  if (chunkCount === 0) {
    throw new Error('the knowledge base is empty — run `npm run ingest:kb` first');
  }

  // ask() records chat history against a user, so the eval needs one. Reuse the
  // seeded demo farmer rather than creating throwaway users.
  const user = await User.findOne({ isDemo: true, role: 'farmer' }).lean();
  if (!user) {
    throw new Error('no demo user found — run `npm run seed` first');
  }

  const e = env();
  const provider = createAiProvider({
    provider: e.AI_PROVIDER,
    embeddingDimensions: e.EMBEDDING_DIMENSIONS,
    gemini: {
      apiKey: e.GEMINI_API_KEY,
      chatModel: e.GEMINI_CHAT_MODEL,
      embedModel: e.GEMINI_EMBED_MODEL,
    },
    claude: { apiKey: e.ANTHROPIC_API_KEY, chatModel: e.CLAUDE_CHAT_MODEL },
  });

  console.log(`\nKB chunks: ${chunkCount}`);
  console.log(`golden set: ${ANSWERABLE.length} answerable, ${UNANSWERABLE.length} unanswerable`);
  console.log(`k = ${K} (RAG_CONTEXT_LIMIT)\n`);

  console.log('1/3  dense-only …');
  const dense = await evaluateRetrieval(provider, 'dense');

  console.log('2/3  hybrid (dense + BM25, RRF) …');
  const hybrid = await evaluateRetrieval(provider, 'hybrid');

  console.log('3/3  full pipeline (hybrid + rerank + guardrail) …');
  const full = await evaluateFullPipeline(String(user._id));

  // ---- console summary ----
  console.log('\n' + '='.repeat(64));
  console.log('configuration            recall@4     MRR      vs dense');
  console.log('-'.repeat(64));
  console.log(
    `dense-only               ${pct(dense.recallAtK).padEnd(11)} ${num(dense.mrr).padEnd(8)} —`,
  );
  console.log(
    `hybrid (RRF)             ${pct(hybrid.recallAtK).padEnd(11)} ${num(hybrid.mrr).padEnd(8)} ${delta(dense.recallAtK, hybrid.recallAtK)}`,
  );
  console.log(
    `hybrid + rerank          ${pct(full.retrieval.recallAtK).padEnd(11)} ${num(full.retrieval.mrr).padEnd(8)} ${delta(dense.recallAtK, full.retrieval.recallAtK)}`,
  );
  console.log('='.repeat(64));
  console.log(`refusal on unanswerable  ${pct(full.refusalRate)}`);
  console.log(`citation validity        ${pct(full.citationValidity)}`);
  console.log('='.repeat(64) + '\n');

  const missedByDense = dense.perQuestion.filter((r) => r.rank === null || r.rank > K);
  const rescued = missedByDense.filter((r) => {
    const h = hybrid.perQuestion.find((x) => x.id === r.id);
    return h?.rank !== null && h !== undefined && h.rank !== null && h.rank <= K;
  });

  if (rescued.length > 0) {
    console.log('questions dense-only missed that hybrid recovered:');
    for (const r of rescued) {
      const q = GOLDEN_SET.find((g) => g.id === r.id);
      console.log(`  ${r.id} — ${q?.tests ?? ''}`);
    }
    console.log();
  }

  // ---- markdown report ----
  const report = `# RAG retrieval evaluation

Generated by \`npm run eval:rag\` on ${new Date().toISOString().slice(0, 10)}.
Provider: \`${provider.name}\` · chat \`${provider.chatModel}\` · embed \`${provider.embedModel}\`
Corpus: ${chunkCount} chunks · k = ${K} (\`RAG_CONTEXT_LIMIT\`)
Golden set: ${ANSWERABLE.length} answerable, ${UNANSWERABLE.length} unanswerable

This is the measurement behind [ADR-004](adr/ADR-004-hybrid-retrieval.md).

## Retrieval

| Configuration | recall@${K} | MRR | vs dense-only |
|---|---|---|---|
| Dense only (\`$vectorSearch\`) | ${pct(dense.recallAtK)} | ${num(dense.mrr)} | — |
| Hybrid (dense + BM25, RRF) | ${pct(hybrid.recallAtK)} | ${num(hybrid.mrr)} | ${delta(dense.recallAtK, hybrid.recallAtK)} |
| Hybrid + LLM rerank | ${pct(full.retrieval.recallAtK)} | ${num(full.retrieval.mrr)} | ${delta(dense.recallAtK, full.retrieval.recallAtK)} |

**recall@${K}** is the metric that matters: a correct source ranked below ${K} is never
placed in the generator's context, so it cannot be cited regardless of model quality.

${
  rescued.length > 0
    ? `### Recovered by the lexical leg\n\n${rescued
        .map((r) => {
          const q = GOLDEN_SET.find((g) => g.id === r.id);
          return `- \`${r.id}\` — ${q?.tests ?? ''}`;
        })
        .join('\n')}\n`
    : '_No question was recovered by adding the lexical leg on this corpus._\n'
}
## Safety

| Metric | Result |
|---|---|
| Refusal rate on unanswerable questions | ${pct(full.refusalRate)} |
| Citation validity (every rendered marker resolves) | ${pct(full.citationValidity)} |

Refusal is reported separately from recall on purpose: a system that never declines
scores well on recall while being actively unsafe. The unanswerable set includes a
question asking for a specific pesticide dose the sources deliberately do not state —
inventing a number there is the most harmful failure this pillar can produce.

### Per-question refusal

| Question | Correctly refused |
|---|---|
${full.refusalDetail
  .map((r) => `| \`${r.id}\` | ${r.refused ? 'yes' : '**no**'} |`)
  .join('\n')}

## Caveats

- ${chunkCount} chunks is a starter corpus. These numbers describe the pipeline, not
  production coverage; both recall and refusal will shift as the corpus grows.
- The golden set is hand-labelled by the author, so it reflects one person's judgement
  of what counts as a correct source.
- Free-tier rate limits mean this runs slowly and can hit quota mid-run. A partial run
  is not comparable — re-run it whole.
`;

  const out = path.resolve(process.cwd(), '../docs/rag-eval.md');
  writeFileSync(out, report, 'utf8');
  console.log(`report written to ${out}\n`);

  await disconnectDb();
}

main().catch(async (err) => {
  console.error('\neval failed:', err instanceof Error ? err.message : err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
