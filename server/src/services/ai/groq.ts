import { AiProviderError, AiQuotaError } from './errors.js';
import { estimateCostUsd, estimateTokens } from './pricing.js';
import { withRetry } from './retry.js';
import type { AiProvider, CompleteOptions, CompleteResult, EmbedResult } from './types.js';

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface GroqResponse {
  choices?: {
    message?: { content?: string };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message: string; type?: string; code?: string };
}

/**
 * Groq provider — generation only, on an OpenAI-compatible API.
 *
 * Why it is worth having as an option: Groq's LPU inference is dramatically faster
 * than a typical GPU endpoint (often sub-second for a full answer), and its free tier
 * is a *separate* quota from Gemini's. On a free-tier-only deployment, a second
 * independent quota is a real resilience win — when one is exhausted the other is not.
 *
 * Why it is NOT the default: the open models Groq hosts (Llama, Qwen class) handle
 * Bengali noticeably less well than Gemini for agricultural terminology, and this is a
 * Bangla-first advisor. Speed does not compensate for a wrong crop-disease name.
 *
 * Like Claude, Groq has no embeddings endpoint, so `embed()` throws and the factory
 * keeps retrieval on Gemini — see `createAiProvider`.
 */
export class GroqProvider implements AiProvider {
  readonly name = 'groq' as const;
  readonly embedModel = 'unsupported';

  constructor(
    private readonly apiKey: string,
    readonly chatModel: string,
    readonly embeddingDimensions: number,
  ) {
    if (!apiKey) {
      throw new AiProviderError('GROQ_API_KEY is not set', 'groq');
    }
  }

  embed(): Promise<EmbedResult> {
    return Promise.reject(
      new AiProviderError(
        'Groq has no embeddings endpoint; use the Gemini embedder (see createAiProvider)',
        'groq',
      ),
    );
  }

  async complete(prompt: string, options: CompleteOptions = {}): Promise<CompleteResult> {
    return withRetry(() => this.completeOnce(prompt, options));
  }

  private async completeOnce(
    prompt: string,
    options: CompleteOptions,
  ): Promise<CompleteResult> {
    const messages: { role: string; content: string }[] = [];

    /**
     * Groq's `json_object` mode requires the word "JSON" to appear in the prompt and,
     * unlike Gemini and Claude, does not enforce a schema. So the shape is described in
     * the system message instead and the caller's Zod parse remains the real guard —
     * `advisory.service.ts` already treats a shape violation as a soft failure rather
     * than trusting the model, which is what makes this acceptable.
     */
    const wantsJson = Boolean(options.jsonSchema);
    let system = options.system ?? '';

    if (wantsJson) {
      system = [
        system,
        '',
        'Respond with a single valid JSON object and nothing else — no prose, no markdown fences.',
        `It must conform to this JSON Schema: ${JSON.stringify(options.jsonSchema)}`,
      ]
        .join('\n')
        .trim();
    }

    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const payload: Record<string, unknown> = {
      model: this.chatModel,
      messages,
      max_tokens: options.maxOutputTokens ?? 2048,
      // Low but non-zero: deterministic enough for grounded answers without the
      // degenerate repetition that temperature 0 sometimes produces on open models.
      temperature: 0.2,
    };

    if (wantsJson) payload.response_format = { type: 'json_object' };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: options.signal ?? null,
    });

    const body = (await response.json().catch(() => ({}))) as GroqResponse;

    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      throw this.toError(
        response.status,
        body.error?.message ?? 'chat completion request failed',
        retryAfter ? Number(retryAfter) * 1000 : undefined,
      );
    }

    const choice = body.choices?.[0];
    const text = choice?.message?.content ?? '';

    const inputTokens = body.usage?.prompt_tokens ?? estimateTokens(prompt);
    const outputTokens = body.usage?.completion_tokens ?? estimateTokens(text);

    return {
      text,
      stopReason: choice?.finish_reason ?? 'unknown',
      usage: {
        inputTokens,
        outputTokens,
        costUsd: estimateCostUsd(this.chatModel, inputTokens, outputTokens),
      },
    };
  }

  private toError(status: number, message: string, retryAfterMs?: number): AiProviderError {
    // Groq returns 429 both for the free tier's rate limit and its daily token cap.
    // Either way the caller's correct response is to degrade, not to 500.
    if (status === 429) return new AiQuotaError(message, 'groq', retryAfterMs);
    const retryable = status >= 500 || status === 408;
    return new AiProviderError(message, 'groq', status, retryable);
  }
}
