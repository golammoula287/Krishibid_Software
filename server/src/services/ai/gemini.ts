import { AiProviderError, AiQuotaError } from './errors.js';
import { estimateCostUsd, estimateTokens } from './pricing.js';
import { withRetry } from './retry.js';
import type {
  AiProvider,
  CompleteOptions,
  CompleteResult,
  EmbedResult,
} from './types.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini caps batch embed requests; keep well under it. */
const EMBED_BATCH_SIZE = 100;

interface GeminiEmbedResponse {
  embeddings?: { values: number[] }[];
  error?: { message: string; status?: string };
}

interface GeminiGenerateResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message: string; status?: string };
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;

  constructor(
    private readonly apiKey: string,
    readonly chatModel: string,
    readonly embedModel: string,
    readonly embeddingDimensions: number,
  ) {
    if (!apiKey) {
      throw new AiProviderError('GEMINI_API_KEY is not set', 'gemini');
    }
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) {
      return { vectors: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
    }

    const vectors: number[][] = [];
    let inputTokens = 0;

    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const batchVectors = await withRetry(() => this.embedBatch(batch));
      vectors.push(...batchVectors);
      inputTokens += batch.reduce((sum, t) => sum + estimateTokens(t), 0);
    }

    // Order must match input order — retrieval correctness depends on the
    // vector at index i belonging to the chunk at index i.
    if (vectors.length !== texts.length) {
      throw new AiProviderError(
        `embedding count mismatch: expected ${texts.length}, got ${vectors.length}`,
        'gemini',
      );
    }

    return {
      vectors,
      usage: {
        inputTokens,
        outputTokens: 0,
        costUsd: estimateCostUsd(this.embedModel, inputTokens, 0),
      },
    };
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    const url = `${BASE_URL}/models/${this.embedModel}:batchEmbedContents?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${this.embedModel}`,
          content: { parts: [{ text }] },
          outputDimensionality: this.embeddingDimensions,
        })),
      }),
    });

    const body = (await response.json().catch(() => ({}))) as GeminiEmbedResponse;

    if (!response.ok) {
      throw this.toError(response.status, body.error?.message ?? 'embed request failed');
    }

    const embeddings = body.embeddings;
    if (!embeddings) {
      throw new AiProviderError('embed response missing embeddings', 'gemini');
    }

    return embeddings.map((e) => e.values);
  }

  async complete(prompt: string, options: CompleteOptions = {}): Promise<CompleteResult> {
    return withRetry(() => this.completeOnce(prompt, options));
  }

  private async completeOnce(
    prompt: string,
    options: CompleteOptions,
  ): Promise<CompleteResult> {
    const url = `${BASE_URL}/models/${this.chatModel}:generateContent?key=${this.apiKey}`;

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: options.maxOutputTokens ?? 2048,
    };

    // Native JSON mode. Constraining the shape server-side is what lets the
    // caller treat `sufficient` as a real signal instead of grepping prose.
    if (options.jsonSchema) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = toGeminiSchema(options.jsonSchema);
    }

    const payload: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig,
    };

    if (options.system) {
      payload.systemInstruction = { parts: [{ text: options.system }] };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options.signal ?? null,
    });

    const body = (await response.json().catch(() => ({}))) as GeminiGenerateResponse;

    if (!response.ok) {
      throw this.toError(
        response.status,
        body.error?.message ?? 'generateContent request failed',
      );
    }

    const candidate = body.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

    const inputTokens = body.usageMetadata?.promptTokenCount ?? estimateTokens(prompt);
    const outputTokens = body.usageMetadata?.candidatesTokenCount ?? estimateTokens(text);

    return {
      text,
      stopReason: candidate?.finishReason ?? 'unknown',
      usage: {
        inputTokens,
        outputTokens,
        costUsd: estimateCostUsd(this.chatModel, inputTokens, outputTokens),
      },
    };
  }

  private toError(status: number, message: string): AiProviderError {
    // 429 is the free tier's daily/minute cap. The caller degrades to
    // retrieval-only rather than 500-ing, so it needs to be distinguishable.
    if (status === 429) return new AiQuotaError(message, 'gemini');
    const retryable = status >= 500 || status === 408;
    return new AiProviderError(message, 'gemini', status, retryable);
  }
}

/**
 * Gemini's responseSchema is OpenAPI-flavoured: it wants uppercase type names
 * and rejects several JSON Schema keywords. Translate rather than hand-maintain
 * two copies of every schema.
 */
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties' || key === '$schema') continue;

    if (key === 'type' && typeof value === 'string') {
      out.type = value.toUpperCase();
      continue;
    }

    if (key === 'properties' && isRecord(value)) {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          isRecord(v) ? toGeminiSchema(v) : v,
        ]),
      );
      continue;
    }

    if (key === 'items' && isRecord(value)) {
      out.items = toGeminiSchema(value);
      continue;
    }

    out[key] = value;
  }

  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
