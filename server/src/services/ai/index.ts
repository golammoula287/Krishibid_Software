import { ClaudeProvider } from './claude.js';
import { AiProviderError } from './errors.js';
import { GeminiProvider } from './gemini.js';
import type {
  AiProvider,
  CompleteOptions,
  CompleteResult,
  EmbedResult,
  ProviderConfig,
} from './types.js';

export * from './types.js';
export * from './errors.js';
export { withRetry, extractJson, sleep } from './retry.js';
export { estimateCostUsd, estimateTokens } from './pricing.js';
export { GeminiProvider } from './gemini.js';
export { ClaudeProvider } from './claude.js';

/**
 * Chat on one provider, embeddings on another.
 *
 * Anthropic has no embeddings endpoint, so selecting Claude for generation must
 * not silently break retrieval. This composite keeps embeddings on Gemini (whose
 * free tier is generous for embeddings specifically) while routing generation to
 * Claude — which is the actually-useful configuration, not a compromise.
 */
class CompositeProvider implements AiProvider {
  constructor(
    private readonly chat: AiProvider,
    private readonly embedder: AiProvider,
  ) {}

  get name() {
    return this.chat.name;
  }
  get chatModel() {
    return this.chat.chatModel;
  }
  get embedModel() {
    return this.embedder.embedModel;
  }
  get embeddingDimensions() {
    return this.embedder.embeddingDimensions;
  }

  embed(texts: string[]): Promise<EmbedResult> {
    return this.embedder.embed(texts);
  }

  complete(prompt: string, options?: CompleteOptions): Promise<CompleteResult> {
    return this.chat.complete(prompt, options);
  }
}

export function createAiProvider(config: ProviderConfig): AiProvider {
  const { provider, embeddingDimensions } = config;

  if (provider === 'claude') {
    if (!config.claude?.apiKey) {
      throw new AiProviderError(
        'AI_PROVIDER=claude requires ANTHROPIC_API_KEY',
        'claude',
      );
    }
    // Embeddings still need a Gemini key even on the Claude path.
    if (!config.gemini?.apiKey) {
      throw new AiProviderError(
        'AI_PROVIDER=claude still requires GEMINI_API_KEY for embeddings (Anthropic has no embeddings endpoint)',
        'claude',
      );
    }

    return new CompositeProvider(
      new ClaudeProvider(
        config.claude.apiKey,
        config.claude.chatModel,
        embeddingDimensions,
      ),
      new GeminiProvider(
        config.gemini.apiKey,
        config.gemini.chatModel,
        config.gemini.embedModel,
        embeddingDimensions,
      ),
    );
  }

  if (!config.gemini?.apiKey) {
    throw new AiProviderError('AI_PROVIDER=gemini requires GEMINI_API_KEY', 'gemini');
  }

  return new GeminiProvider(
    config.gemini.apiKey,
    config.gemini.chatModel,
    config.gemini.embedModel,
    embeddingDimensions,
  );
}
