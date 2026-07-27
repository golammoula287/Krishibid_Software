import type { ProviderName } from './types.js';

/**
 * USD per 1M tokens, used to estimate cost-per-query.
 *
 * These are estimates for observability, not billing. They exist so `/metrics`
 * can report cost-per-RAG-query — which is the number that tells you whether
 * the free tier is actually sustainable, and is a far more interesting metric to
 * discuss than raw latency.
 */
interface Rate {
  inputPerMTok: number;
  outputPerMTok: number;
}

const RATES: Record<string, Rate> = {
  // Gemini free tier bills nothing; kept at 0 so free-tier usage reports as $0
  // rather than a misleading synthetic cost.
  'gemini-2.5-flash': { inputPerMTok: 0, outputPerMTok: 0 },
  'gemini-2.5-flash-lite': { inputPerMTok: 0, outputPerMTok: 0 },
  'gemini-embedding-001': { inputPerMTok: 0, outputPerMTok: 0 },

  // Claude — paid tier. Rates as of the 2026 published price list.
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
};

const FALLBACK: Rate = { inputPerMTok: 0, outputPerMTok: 0 };

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = RATES[model] ?? FALLBACK;
  const cost =
    (inputTokens / 1_000_000) * rate.inputPerMTok +
    (outputTokens / 1_000_000) * rate.outputPerMTok;
  // Round to 6dp — sub-microdollar precision is noise.
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * Rough token estimate for providers that do not report usage.
 *
 * Deliberately crude and deliberately not `tiktoken` (that is OpenAI's
 * tokeniser and mis-counts other models, badly so for Bangla). Bengali script
 * costs materially more tokens per character than Latin, so we weight by the
 * share of non-ASCII characters instead of assuming a flat ratio.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let ascii = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
  }
  const nonAscii = text.length - ascii;
  // ~4 ASCII chars/token; ~1.5 chars/token for Bengali script.
  return Math.ceil(ascii / 4 + nonAscii / 1.5);
}

export function providerDefaultModels(provider: ProviderName): {
  chat: string;
  embed: string;
} {
  return provider === 'claude'
    ? { chat: 'claude-opus-5', embed: 'gemini-embedding-001' }
    : { chat: 'gemini-2.5-flash', embed: 'gemini-embedding-001' };
}
