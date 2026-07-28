import {
  groundedAnswerSchema,
  type AnswerDto,
  type AskInput,
  type Citation,
  type RetrievedChunk,
} from '@krishibid/shared';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ChatSession, RagCache } from '../models/ChatSession.js';
import { AiQuotaError, createAiProvider, extractJson, type AiProvider } from './ai/index.js';
import {
  ANSWER_SCHEMA,
  RERANK_SCHEMA,
  RERANK_SYSTEM,
  SYSTEM_PROMPT,
  buildAnswerPrompt,
  buildRerankPrompt,
} from './prompts.js';
import { hybridRetrieve } from './retrieval.service.js';

let provider: AiProvider | null = null;

function getProvider(): AiProvider {
  const e = env();
  provider ??= createAiProvider({
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
  return provider;
}

/** Test seam. */
export function setProvider(p: AiProvider | null): void {
  provider = p;
}

/**
 * Cache key.
 *
 * Normalising (lowercase, collapse whitespace, strip terminal punctuation) means
 * "ধানের পাতা পোড়া রোগ" and "ধানের পাতা পোড়া রোগ?" share an entry. Against a
 * 1,500-request/day free tier, that difference is what keeps the chatbot answering
 * by evening.
 */
function cacheKey(question: string, locale: string, cropSlug?: string): string {
  const normalised = question
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?।!.]+$/u, '')
    .trim();
  return crypto
    .createHash('sha256')
    .update(`${normalised}|${locale}|${cropSlug ?? ''}`)
    .digest('hex');
}

/**
 * Reranks the fused candidates and keeps the top N.
 *
 * Failure here is non-fatal by design: if the call errors or returns junk we keep
 * the RRF order. A degraded ordering is far better than failing a question the
 * retrieval already answered.
 */
async function rerank(
  question: string,
  chunks: RetrievedChunk[],
  limit: number,
): Promise<RetrievedChunk[]> {
  if (!env().RAG_ENABLE_RERANK || chunks.length <= limit) return chunks.slice(0, limit);

  const candidates = chunks.slice(0, 10);

  try {
    const result = await getProvider().complete(buildRerankPrompt(question, candidates), {
      system: RERANK_SYSTEM,
      jsonSchema: RERANK_SCHEMA as unknown as Record<string, unknown>,
      maxOutputTokens: 512,
      signal: AbortSignal.timeout(15_000),
    });

    const parsed = extractJson(result.text) as { scores?: { n: number; score: number }[] } | null;
    if (!parsed?.scores?.length) return chunks.slice(0, limit);

    const scoreByIndex = new Map(parsed.scores.map((s) => [s.n, s.score]));

    return [...candidates]
      .map((chunk, i) => ({ chunk, score: scoreByIndex.get(i + 1) ?? 0 }))
      // Tie-break on the original RRF order so equal scores stay stable.
      .sort((a, b) => b.score - a.score || b.chunk.rrfScore - a.chunk.rrfScore)
      .slice(0, limit)
      .map((x) => x.chunk);
  } catch (err) {
    logger.warn({ err }, 'rerank failed; keeping RRF order');
    return chunks.slice(0, limit);
  }
}

/**
 * Validates the model's citations against what was actually retrieved.
 *
 * This is the guardrail that makes "grounded" a verified property rather than a
 * hopeful instruction. A marker pointing outside the retrieved set is a
 * hallucination: it is stripped from the text and logged, so a fabricated source
 * can never be rendered to a farmer as if it were real.
 */
export function validateCitations(
  answerText: string,
  claimedMarkers: number[],
  chunks: RetrievedChunk[],
): { answer: string; citations: Citation[]; strippedCount: number } {
  const valid = new Set<number>();
  for (let i = 1; i <= chunks.length; i++) valid.add(i);

  // Markers in the prose are what matter — the model's own `citedMarkers` list is
  // advisory and sometimes disagrees with its own text.
  const inText = [...answerText.matchAll(/\[(\d+)]/g)].map((m) => Number(m[1]));
  const referenced = new Set([...inText, ...claimedMarkers].filter((n) => valid.has(n)));

  const bogus = [...new Set(inText)].filter((n) => !valid.has(n));
  let answer = answerText;

  for (const n of bogus) answer = answer.replaceAll(`[${n}]`, '');
  if (bogus.length > 0) {
    logger.warn({ bogus, retrieved: chunks.length }, 'stripped hallucinated citation markers');
    answer = answer.replace(/\s{2,}/g, ' ').trim();
  }

  const citations: Citation[] = [...referenced]
    .sort((a, b) => a - b)
    .map((n) => {
      const chunk = chunks[n - 1]!;
      return { n, title: chunk.title, url: chunk.url, section: chunk.section };
    });

  return { answer, citations, strippedCount: bogus.length };
}

export async function ask(userId: string, input: AskInput): Promise<AnswerDto> {
  const started = performance.now();
  const e = env();
  const locale = input.locale ?? 'bn';
  const key = cacheKey(input.question, locale, input.cropSlug);

  // ---- 1. cache ----
  const cached = await RagCache.findOne({ key });
  if (cached) {
    await RagCache.updateOne({ key }, { $inc: { hits: 1 } });
    const sessionId = await appendToSession(userId, input.sessionId, input.question, {
      answer: cached.answer,
      citations: cached.citations as Citation[],
    });
    return {
      sessionId,
      answer: cached.answer,
      citations: cached.citations as Citation[],
      sufficient: cached.sufficient,
      degraded: false,
      cached: true,
      retrievedCount: cached.citations.length,
      tokensUsed: 0,
      costUsd: 0,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  // ---- 2. embed the question ----
  let queryVector: number[] = [];
  let embedTokens = 0;
  let embedCost = 0;

  try {
    const embedded = await getProvider().embed([input.question]);
    queryVector = embedded.vectors[0] ?? [];
    embedTokens = embedded.usage.inputTokens;
    embedCost = embedded.usage.costUsd;
  } catch (err) {
    // No embedding means no dense leg; retrieval continues lexical-only rather
    // than failing the request outright.
    logger.warn({ err }, 'query embedding failed; dense leg will be skipped');
  }

  // ---- 3. hybrid retrieve + rerank ----
  const { chunks: fused } = await hybridRetrieve({
    queryVector,
    queryText: input.question,
    locale,
    cropSlug: input.cropSlug,
  });

  if (fused.length === 0) {
    const answer =
      locale === 'bn'
        ? 'আমার তথ্যভাণ্ডারে এই প্রশ্নের উত্তর নেই। অনুগ্রহ করে আপনার স্থানীয় কৃষি সম্প্রসারণ কর্মকর্তার সঙ্গে যোগাযোগ করুন।'
        : 'I do not have information on this in my knowledge base. Please consult your local agricultural extension officer.';

    const sessionId = await appendToSession(userId, input.sessionId, input.question, {
      answer,
      citations: [],
    });

    return {
      sessionId,
      answer,
      citations: [],
      sufficient: false,
      degraded: false,
      cached: false,
      retrievedCount: 0,
      tokensUsed: embedTokens,
      costUsd: embedCost,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  const context = await rerank(input.question, fused, e.RAG_CONTEXT_LIMIT);

  // ---- 4. generate ----
  let answerText: string;
  let citedMarkers: number[] = [];
  let sufficient = true;
  let degraded = false;
  let genTokens = 0;
  let genCost = 0;

  try {
    const result = await getProvider().complete(
      buildAnswerPrompt(input.question, context, locale),
      {
        system: SYSTEM_PROMPT,
        jsonSchema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
        maxOutputTokens: 1500,
        signal: AbortSignal.timeout(30_000),
      },
    );

    genTokens = result.usage.inputTokens + result.usage.outputTokens;
    genCost = result.usage.costUsd;

    const parsed = groundedAnswerSchema.safeParse(extractJson(result.text));
    if (parsed.success) {
      answerText = parsed.data.answer;
      citedMarkers = parsed.data.citedMarkers;
      sufficient = parsed.data.sufficient;
    } else {
      // Shape violation: keep the raw text rather than discard a possibly-good
      // answer, but do not claim it was grounded.
      logger.warn({ issues: parsed.error.issues }, 'answer failed schema; using raw text');
      answerText = result.text;
      sufficient = false;
    }
  } catch (err) {
    // Quota exhausted or provider down. Return the retrieved passages with their
    // citations instead of a 500: the farmer still gets the source material, and
    // `degraded` tells the UI to say so plainly.
    const quota = err instanceof AiQuotaError;
    logger.warn({ err, quota }, 'generation failed; returning retrieval-only answer');

    degraded = true;
    sufficient = false;
    answerText =
      (locale === 'bn'
        ? 'পরামর্শ সেবা এখন ব্যস্ত। প্রাসঙ্গিক তথ্যসূত্র নিচে দেওয়া হলো:\n\n'
        : 'The advisory service is busy right now. Here are the relevant sources:\n\n') +
      context.map((c, i) => `[${i + 1}] ${c.text.slice(0, 400)}`).join('\n\n');
    citedMarkers = context.map((_, i) => i + 1);
  }

  // ---- 5. validate grounding ----
  const { answer, citations } = validateCitations(answerText, citedMarkers, context);

  // Only cache genuinely-good answers: caching a degraded or insufficient one would
  // pin the failure in place for 24 hours.
  if (!degraded && sufficient && citations.length > 0) {
    await RagCache.updateOne(
      { key },
      {
        $set: {
          key,
          answer,
          citations,
          sufficient,
          expiresAt: new Date(Date.now() + e.RAG_CACHE_TTL_HOURS * 60 * 60 * 1000),
        },
      },
      { upsert: true },
    );
  }

  const totalTokens = embedTokens + genTokens;
  const totalCost = embedCost + genCost;

  const sessionId = await appendToSession(userId, input.sessionId, input.question, {
    answer,
    citations,
    tokensUsed: totalTokens,
    costUsd: totalCost,
  });

  const latencyMs = Math.round(performance.now() - started);

  logger.info(
    {
      userId,
      retrieved: fused.length,
      context: context.length,
      citations: citations.length,
      sufficient,
      degraded,
      tokens: totalTokens,
      costUsd: totalCost,
      latencyMs,
    },
    'advisory answer generated',
  );

  return {
    sessionId,
    answer,
    citations,
    sufficient,
    degraded,
    cached: false,
    retrievedCount: fused.length,
    tokensUsed: totalTokens,
    costUsd: totalCost,
    latencyMs,
  };
}

async function appendToSession(
  userId: string,
  sessionId: string | undefined,
  question: string,
  reply: { answer: string; citations: Citation[]; tokensUsed?: number; costUsd?: number },
): Promise<string> {
  const now = new Date();
  const messages = [
    { role: 'user' as const, content: question, at: now },
    {
      role: 'assistant' as const,
      content: reply.answer,
      citations: reply.citations.length > 0 ? reply.citations : undefined,
      at: now,
    },
  ];

  if (sessionId) {
    const updated = await ChatSession.findOneAndUpdate(
      { _id: sessionId, userId },
      {
        $push: { messages: { $each: messages } },
        $inc: { tokensUsed: reply.tokensUsed ?? 0, costUsd: reply.costUsd ?? 0 },
      },
      { new: true },
    );
    if (updated) return String(updated._id);
  }

  const created = await ChatSession.create({
    userId: new mongoose.Types.ObjectId(userId),
    messages,
    tokensUsed: reply.tokensUsed ?? 0,
    costUsd: reply.costUsd ?? 0,
  });
  return String(created._id);
}

export async function getSession(userId: string, sessionId: string) {
  return ChatSession.findOne({ _id: sessionId, userId }).lean();
}

export async function listSessions(userId: string) {
  return ChatSession.find({ userId })
    .select('_id createdAt updatedAt messages')
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();
}
