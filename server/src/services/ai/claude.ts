import { AiProviderError, AiQuotaError } from './errors.js';
import { estimateCostUsd, estimateTokens } from './pricing.js';
import { withRetry } from './retry.js';
import type {
  AiProvider,
  CompleteOptions,
  CompleteResult,
  EmbedResult,
} from './types.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type: string; message: string };
}

/**
 * Claude provider — the paid upgrade path.
 *
 * Not the default: the Claude API has no free tier, and this project's
 * deployment budget is free tiers only. Selected with AI_PROVIDER=claude when
 * answer quality matters more than cost.
 *
 * Note this class implements generation only. Anthropic has no embeddings
 * endpoint, so `embed()` deliberately throws and the factory keeps embeddings on
 * Gemini even when chat runs on Claude — see `createAiProvider`.
 */
export class ClaudeProvider implements AiProvider {
  readonly name = 'claude' as const;
  readonly embedModel = 'unsupported';

  constructor(
    private readonly apiKey: string,
    readonly chatModel: string,
    readonly embeddingDimensions: number,
  ) {
    if (!apiKey) {
      throw new AiProviderError('ANTHROPIC_API_KEY is not set', 'claude');
    }
  }

  embed(): Promise<EmbedResult> {
    return Promise.reject(
      new AiProviderError(
        'Anthropic has no embeddings endpoint; use the Gemini embedder (see createAiProvider)',
        'claude',
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
    const payload: Record<string, unknown> = {
      model: this.chatModel,
      max_tokens: options.maxOutputTokens ?? 4096,
      messages: [{ role: 'user', content: prompt }],
    };

    if (options.system) payload.system = options.system;

    // Structured outputs: constrains the response to the schema so the caller
    // gets a parseable object rather than prose it has to scrape.
    if (options.jsonSchema) {
      payload.output_config = {
        format: { type: 'json_schema', schema: options.jsonSchema },
      };
    }

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(payload),
      signal: options.signal ?? null,
    });

    const body = (await response.json().catch(() => ({}))) as AnthropicResponse;

    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      throw this.toError(
        response.status,
        body.error?.message ?? 'messages request failed',
        retryAfter ? Number(retryAfter) * 1000 : undefined,
      );
    }

    const text =
      body.content
        ?.filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('') ?? '';

    const inputTokens = body.usage?.input_tokens ?? estimateTokens(prompt);
    const outputTokens = body.usage?.output_tokens ?? estimateTokens(text);

    return {
      text,
      stopReason: body.stop_reason ?? 'unknown',
      usage: {
        inputTokens,
        outputTokens,
        costUsd: estimateCostUsd(this.chatModel, inputTokens, outputTokens),
      },
    };
  }

  private toError(status: number, message: string, retryAfterMs?: number): AiProviderError {
    if (status === 429) return new AiQuotaError(message, 'claude', retryAfterMs);
    const retryable = status >= 500 || status === 408 || status === 529;
    return new AiProviderError(message, 'claude', status, retryable);
  }
}
