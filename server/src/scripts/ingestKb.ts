/**
 * Ingests the knowledge base for RAG.
 *
 *   npm run ingest:kb
 *
 * Idempotent: chunks are keyed by sha256(url + section + text), so rerunning
 * updates in place rather than duplicating the corpus. That matters because the
 * embedding step costs quota — a script that doubles the corpus on every run
 * would burn the free tier and quietly halve retrieval precision.
 */
import { createAiProvider } from '../services/ai/index.js';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../utils/db.js';
import { logger } from '../utils/logger.js';
import { KbChunk } from '../models/KbChunk.js';
import { KB_DOCUMENTS, type KbDocument } from './kbSources.js';

const TARGET_CHARS = 1800; // ≈500 tokens for mixed Bangla/English
const OVERLAP_CHARS = 270; // 15%

/**
 * Splits text into overlapping chunks on semantic boundaries.
 *
 * Paragraph-first, then sentence, then a hard grapheme-safe cut. Bengali is
 * written with combining marks, so slicing by UTF-16 code unit can split a
 * grapheme cluster and corrupt a character — `Intl.Segmenter` avoids that.
 * Cutting mid-sentence also measurably hurts retrieval: the embedding of half a
 * sentence sits nowhere useful in vector space.
 */
export function chunkText(text: string): string[] {
  const normalised = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (normalised.length <= TARGET_CHARS) return [normalised];

  const paragraphs = normalised.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    if (current.trim().length > 0) chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > TARGET_CHARS) {
      flush();
      chunks.push(...splitLongParagraph(paragraph));
      continue;
    }
    if (current.length + paragraph.length + 2 > TARGET_CHARS) {
      flush();
      // Carry a tail of the previous chunk so a fact spanning the seam is
      // retrievable from either side.
      const previous = chunks.at(-1);
      if (previous) current = `${tail(previous, OVERLAP_CHARS)}\n\n`;
    }
    current += (current ? '\n\n' : '') + paragraph;
  }
  flush();

  return chunks.filter((c) => c.length > 50);
}

function splitLongParagraph(paragraph: string): string[] {
  const sentences = segmentSentences(paragraph);
  const out: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > TARGET_CHARS && current.length > 0) {
      out.push(current.trim());
      current = tail(current, OVERLAP_CHARS);
    }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function segmentSentences(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('bn', { granularity: 'sentence' });
    return [...segmenter.segment(text)].map((s) => s.segment);
  }
  // '।' is the Bengali danda — the sentence terminator in Bangla prose.
  return text.split(/(?<=[.।!?])\s+/);
}

/** Grapheme-safe tail slice. */
function tail(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const slice = text.slice(-chars);
  if (typeof Intl.Segmenter === 'function') {
    const graphemes = [...new Intl.Segmenter('bn', { granularity: 'grapheme' }).segment(slice)];
    return graphemes.map((g) => g.segment).join('');
  }
  return slice;
}

const contentHash = (doc: KbDocument, text: string): string =>
  crypto.createHash('sha256').update(`${doc.url}|${doc.section ?? ''}|${text}`).digest('hex');

async function ingest(): Promise<void> {
  await connectDb();
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
    groq: { apiKey: e.GROQ_API_KEY, chatModel: e.GROQ_CHAT_MODEL },
  });

  logger.info(
    { documents: KB_DOCUMENTS.length, embedModel: provider.embedModel },
    'starting knowledge base ingest',
  );

  interface Pending {
    doc: KbDocument;
    text: string;
    hash: string;
  }

  const pending: Pending[] = [];

  for (const doc of KB_DOCUMENTS) {
    for (const text of chunkText(doc.text)) {
      pending.push({ doc, text, hash: contentHash(doc, text) });
    }
  }

  logger.info({ chunks: pending.length }, 'chunked');

  // Skip anything already embedded with the same model — the point of the hash.
  const existing = await KbChunk.find({
    contentHash: { $in: pending.map((p) => p.hash) },
    embedModel: provider.embedModel,
  })
    .select('contentHash')
    .lean();

  const known = new Set(existing.map((d) => d.contentHash));
  const todo = pending.filter((p) => !known.has(p.hash));

  logger.info({ skipped: known.size, toEmbed: todo.length }, 'deduplicated against existing');

  if (todo.length === 0) {
    logger.info('nothing to do');
    await disconnectDb();
    return;
  }

  const BATCH = 50;
  let embedded = 0;

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const { vectors, usage } = await provider.embed(batch.map((b) => b.text));

    const ops = batch.map((item, j) => {
      const vector = vectors[j];
      if (!vector) throw new Error(`missing embedding for chunk ${i + j}`);

      return {
        updateOne: {
          filter: { contentHash: item.hash },
          update: {
            $set: {
              contentHash: item.hash,
              text: item.text,
              embedding: vector,
              source: {
                title: item.doc.title,
                url: item.doc.url,
                section: item.doc.section,
              },
              cropTags: item.doc.cropTags,
              locale: item.doc.locale,
              tokenCount: Math.ceil(item.text.length / 3),
              embedModel: provider.embedModel,
            },
          },
          upsert: true,
        },
      };
    });

    await KbChunk.bulkWrite(ops);
    embedded += batch.length;

    logger.info(
      { embedded, total: todo.length, costUsd: usage.costUsd },
      'batch embedded',
    );
  }

  const total = await KbChunk.countDocuments();
  logger.info({ embedded, corpusSize: total }, 'ingest complete');

  logger.warn(
    { vectorIndex: e.RAG_VECTOR_INDEX, textIndex: e.RAG_TEXT_INDEX },
    'reminder: create the Atlas Search indexes with `npm run create:indexes` (or via the Atlas UI) before querying',
  );

  await disconnectDb();
}

ingest().catch((err) => {
  logger.fatal({ err }, 'ingest failed');
  process.exit(1);
});
