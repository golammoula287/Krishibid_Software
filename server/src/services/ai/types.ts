/**
 * Provider-agnostic AI interface.
 *
 * Why this layer exists: the deployment budget is free tiers only, and the
 * Claude API has no free tier — so Gemini's free tier is the shipped default.
 * But free tiers have hard daily caps, and a demo that dies on quota is worse
 * than one that costs a few cents. Keeping every model call behind this
 * interface means switching providers is one env var, not a refactor, and it
 * makes cost-per-query measurable across providers.
 */

export type ProviderName = 'gemini' | 'claude' | 'groq';

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  /** Estimated, using the per-provider rate table in `pricing.ts`. */
  costUsd: number;
}

export interface EmbedResult {
  /** One vector per input, in the same order. */
  vectors: number[][];
  usage: UsageInfo;
}

export interface CompleteOptions {
  system?: string;
  /** Constrains output to this JSON Schema. Providers enforce natively. */
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  /** Abort signal so a slow provider cannot hold an HTTP handler open. */
  signal?: AbortSignal;
  /**
   * Ask the provider to skip internal reasoning where it supports doing so.
   *
   * Gemini 3.x models think by default, and **thinking tokens are drawn from the same
   * `maxOutputTokens` budget as the answer**. For a grounded extraction task — restate
   * what the retrieved passages say, with citations — reasoning buys little and can
   * consume the whole budget, yielding truncated or empty output.
   */
  disableThinking?: boolean;
}

export interface CompleteResult {
  text: string;
  usage: UsageInfo;
  /** Provider-reported stop reason, normalised where possible. */
  stopReason: string;
}

export interface AiProvider {
  readonly name: ProviderName;
  readonly chatModel: string;
  readonly embedModel: string;
  readonly embeddingDimensions: number;

  /** Batch-embeds texts. Implementations must preserve input order. */
  embed(texts: string[]): Promise<EmbedResult>;

  complete(prompt: string, options?: CompleteOptions): Promise<CompleteResult>;
}

export interface ProviderConfig {
  provider: ProviderName;
  embeddingDimensions: number;
  gemini?: {
    apiKey: string;
    chatModel: string;
    embedModel: string;
  };
  claude?: {
    apiKey: string;
    chatModel: string;
  };
  groq?: {
    apiKey: string;
    chatModel: string;
  };
}
