import type { RetrievedChunk } from '@krishibid/shared';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { KbChunk } from '../models/KbChunk.js';

interface Candidate {
  id: string;
  text: string;
  title: string;
  url: string;
  section?: string;
}

export interface RetrieveOptions {
  queryVector: number[];
  queryText: string;
  locale: 'bn' | 'en';
  cropSlug?: string;
  limit?: number;
}

/**
 * Reciprocal Rank Fusion.
 *
 *   score(d) = Σ over legs of  1 / (k + rank_leg(d))
 *
 * Chosen over score normalisation because the two legs produce incomparable
 * scales: cosine similarity is bounded [-1,1] while BM25 is unbounded and
 * corpus-dependent. Min-max normalising them would let one leg's score spread
 * dominate for reasons unrelated to relevance. RRF consumes only *ranks*, so it
 * sidesteps the calibration problem entirely.
 *
 * k = 60 (the original Cormack et al. value) damps top-rank influence just enough
 * that a document must do well in both legs to beat one that dominates a single leg.
 */
export function reciprocalRankFusion(
  legs: { name: 'dense' | 'lexical'; results: Candidate[] }[],
  k: number,
): RetrievedChunk[] {
  const fused = new Map<string, RetrievedChunk>();

  for (const leg of legs) {
    leg.results.forEach((doc, index) => {
      const rank = index + 1;
      const contribution = 1 / (k + rank);

      const existing = fused.get(doc.id);
      if (existing) {
        existing.rrfScore += contribution;
        if (leg.name === 'dense') existing.denseRank = rank;
        else existing.lexicalRank = rank;
        return;
      }

      fused.set(doc.id, {
        id: doc.id,
        text: doc.text,
        title: doc.title,
        url: doc.url,
        section: doc.section,
        denseRank: leg.name === 'dense' ? rank : undefined,
        lexicalRank: leg.name === 'lexical' ? rank : undefined,
        rrfScore: contribution,
      });
    });
  }

  return [...fused.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Dense leg — Atlas Vector Search over the embedding field.
 *
 * Filters go through the index's declared `filter` fields so narrowing happens
 * *inside* the ANN traversal. Post-filtering would silently shrink the result set:
 * ask about a rice disease and 20 candidates get pruned to 2, with no signal that
 * recall collapsed.
 */
async function denseSearch(opts: RetrieveOptions): Promise<Candidate[]> {
  const e = env();
  const filter: Record<string, unknown> = { locale: { $eq: opts.locale } };
  if (opts.cropSlug) filter.cropTags = { $eq: opts.cropSlug };

  try {
    const docs = await KbChunk.aggregate([
      {
        $vectorSearch: {
          index: e.RAG_VECTOR_INDEX,
          path: 'embedding',
          queryVector: opts.queryVector,
          numCandidates: e.RAG_NUM_CANDIDATES,
          limit: opts.limit ?? e.RAG_RETRIEVE_LIMIT,
          filter,
        },
      },
      {
        $project: {
          text: 1,
          'source.title': 1,
          'source.url': 1,
          'source.section': 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ]);

    return docs.map((d) => ({
      id: String(d._id),
      text: d.text as string,
      title: (d.source as { title: string }).title,
      url: (d.source as { url: string }).url,
      section: (d.source as { section?: string }).section,
    }));
  } catch (err) {
    // $vectorSearch does not exist on a local mongod or before the index is built.
    // Degrade rather than fail so tests and fresh clusters still work.
    logger.warn({ err }, '$vectorSearch unavailable; dense leg skipped');
    return [];
  }
}

/**
 * Lexical leg — Atlas Search BM25.
 *
 * The reason hybrid exists: a farmer asking about a specific pesticide, cultivar
 * code or dosage is asking about an exact token. Dense embeddings smear those into
 * "roughly agrochemical" and the precise number they needed never comes back.
 * BM25 matches them literally.
 */
async function lexicalSearch(opts: RetrieveOptions): Promise<Candidate[]> {
  const e = env();

  try {
    const must: Record<string, unknown>[] = [
      { text: { query: opts.queryText, path: 'text' } },
    ];
    const filter: Record<string, unknown>[] = [
      { equals: { path: 'locale', value: opts.locale } },
    ];
    if (opts.cropSlug) filter.push({ equals: { path: 'cropTags', value: opts.cropSlug } });

    const docs = await KbChunk.aggregate([
      { $search: { index: e.RAG_TEXT_INDEX, compound: { must, filter } } },
      { $limit: opts.limit ?? e.RAG_RETRIEVE_LIMIT },
      {
        $project: {
          text: 1,
          'source.title': 1,
          'source.url': 1,
          'source.section': 1,
          score: { $meta: 'searchScore' },
        },
      },
    ]);

    return docs.map((d) => ({
      id: String(d._id),
      text: d.text as string,
      title: (d.source as { title: string }).title,
      url: (d.source as { url: string }).url,
      section: (d.source as { section?: string }).section,
    }));
  } catch (err) {
    logger.warn({ err }, '$search unavailable; falling back to regex lexical leg');
    return regexFallback(opts);
  }
}

/**
 * Last-resort lexical leg for environments without Atlas Search.
 *
 * Deliberately crude — it exists so tests and a local mongod produce *some* lexical
 * signal rather than silently running dense-only, which would make the RAG eval
 * numbers a lie about what the deployed system does.
 */
async function regexFallback(opts: RetrieveOptions): Promise<Candidate[]> {
  const terms = opts.queryText
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 6)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (terms.length === 0) return [];

  const filter: Record<string, unknown> = {
    locale: opts.locale,
    $or: terms.map((t) => ({ text: { $regex: t, $options: 'i' } })),
  };
  if (opts.cropSlug) filter.cropTags = opts.cropSlug;

  const docs = await KbChunk.find(filter)
    .select('text source')
    .limit(opts.limit ?? env().RAG_RETRIEVE_LIMIT)
    .lean();

  return docs.map((d) => ({
    id: String(d._id),
    text: d.text,
    title: d.source?.title ?? 'Untitled',
    url: d.source?.url ?? '',
    // Normalise null -> undefined: Mongoose returns null for an unset optional
    // subfield, but the Citation contract treats absent as undefined.
    section: d.source?.section ?? undefined,
  }));
}

export interface HybridResult {
  chunks: RetrievedChunk[];
  denseCount: number;
  lexicalCount: number;
}

/** Runs both legs concurrently and fuses them. */
export async function hybridRetrieve(opts: RetrieveOptions): Promise<HybridResult> {
  const [dense, lexical] = await Promise.all([denseSearch(opts), lexicalSearch(opts)]);

  const chunks = reciprocalRankFusion(
    [
      { name: 'dense', results: dense },
      { name: 'lexical', results: lexical },
    ],
    env().RAG_RRF_K,
  );

  logger.debug(
    { dense: dense.length, lexical: lexical.length, fused: chunks.length },
    'hybrid retrieval complete',
  );

  return { chunks, denseCount: dense.length, lexicalCount: lexical.length };
}

/** Dense-only retrieval, used by the eval script for the A/B comparison. */
export async function denseOnlyRetrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  const dense = await denseSearch(opts);
  return dense.map((d, i) => ({
    id: d.id,
    text: d.text,
    title: d.title,
    url: d.url,
    section: d.section,
    denseRank: i + 1,
    rrfScore: 1 / (env().RAG_RRF_K + i + 1),
  }));
}
