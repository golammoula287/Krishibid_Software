import { z } from 'zod';
import { localeSchema, objectId } from './common.js';

export const askSchema = z.object({
  sessionId: objectId.optional(),
  question: z.string().trim().min(3).max(1000),
  locale: localeSchema.optional(),
  /** Narrows retrieval to a crop when the UI already knows the context. */
  cropSlug: z.string().max(60).optional(),
});
export type AskInput = z.infer<typeof askSchema>;

export const citationSchema = z.object({
  /** 1-based marker matching `[n]` in the answer text. */
  n: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  section: z.string().optional(),
});
export type Citation = z.infer<typeof citationSchema>;

/**
 * The structured shape the LLM is constrained to return.
 *
 * Asking for JSON rather than parsing prose means `sufficient` is a first-class
 * signal we can act on, and citation markers can be validated against the
 * chunks we actually retrieved.
 */
export const groundedAnswerSchema = z.object({
  answer: z.string(),
  /** Markers the model claims to have used. Validated server-side. */
  citedMarkers: z.array(z.number().int().positive()).default([]),
  /** False when the retrieved context does not answer the question. */
  sufficient: z.boolean(),
});
export type GroundedAnswer = z.infer<typeof groundedAnswerSchema>;

export interface RetrievedChunk {
  id: string;
  text: string;
  title: string;
  url: string;
  section?: string;
  /** Rank from the dense leg, if it appeared there. */
  denseRank?: number;
  /** Rank from the lexical (BM25) leg, if it appeared there. */
  lexicalRank?: number;
  /** Reciprocal-rank-fusion score used for the final ordering. */
  rrfScore: number;
}

export interface AnswerDto {
  sessionId: string;
  answer: string;
  citations: Citation[];
  /** False when the KB could not answer; the UI shows a referral instead. */
  sufficient: boolean;
  /**
   * True when synthesis was skipped (provider quota/outage) and the response is
   * retrieved passages only. Degraded but still useful, and never silent.
   */
  degraded: boolean;
  cached: boolean;
  retrievedCount: number;
  tokensUsed: number;
  costUsd: number;
  latencyMs: number;
}

export interface ChatMessageDto {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  at: string;
}

export interface ChatSessionDto {
  id: string;
  messages: ChatMessageDto[];
  createdAt: string;
}
