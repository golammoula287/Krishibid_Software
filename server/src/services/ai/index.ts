import { ClaudeProvider } from './claude.js';
import { AiProviderError } from './errors.js';
import { GeminiProvider } from './gemini.js';
import { FailoverProvider } from './failover.js';
import { GroqProvider } from './groq.js';
import type {
  AiProvider,
  CompleteOptions,
  CompleteResult,
  EmbedResult,
  ProviderConfig,
  ProviderName,
} from './types.js';

export * from './types.js';
export * from './errors.js';
export { withRetry, extractJson, sleep } from './retry.js';
export { estimateCostUsd, estimateTokens } from './pricing.js';
export { GeminiProvider } from './gemini.js';
export { ClaudeProvider } from './claude.js';
export { GroqProvider } from './groq.js';
export { FailoverProvider } from './failover.js';

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

/**
 * Builds the chain: the chosen provider first, then whatever else has a key, as reserve.
 *
 * Every one of these is a free tier with a daily cap, and the caps get hit — a busy afternoon
 * exhausts Gemini's requests and the advisor stops answering until midnight UTC. Two accounts
 * with different limits do not run out at the same moment, so configuring both means one covers
 * the other. Nothing has to be switched by hand.
 *
 * Order is preference, not capability: whichever `AI_PROVIDER` names leads, and the rest fall in
 * behind it. Configuring one key is still perfectly valid — the chain is then one long and
 * behaves exactly as it did before failover existed.
 */
function chatProvidersFor(config: ProviderConfig): AiProvider[] {
  const { embeddingDimensions } = config;

  const built: Partial<Record<ProviderName, AiProvider>> = {};

  if (config.groq?.apiKey) {
    built.groq = new GroqProvider(config.groq.apiKey, config.groq.chatModel, embeddingDimensions);
  }
  if (config.claude?.apiKey) {
    built.claude = new ClaudeProvider(
      config.claude.apiKey,
      config.claude.chatModel,
      embeddingDimensions,
    );
  }
  if (config.gemini?.apiKey) {
    built.gemini = new GeminiProvider(
      config.gemini.apiKey,
      config.gemini.chatModel,
      config.gemini.embedModel,
      embeddingDimensions,
    );
  }

  const preferred = built[config.provider];
  if (!preferred) {
    /**
     * Named per provider, not one generic line.
     *
     * "requires its API key" tells somebody staring at a boot failure nothing they can act on;
     * the variable to set is the entire useful content of this message.
     */
    const required: Record<ProviderName, string> = {
      groq: 'GROQ_API_KEY',
      claude: 'ANTHROPIC_API_KEY',
      gemini: 'GEMINI_API_KEY',
    };
    throw new AiProviderError(
      `AI_PROVIDER=${config.provider} requires ${required[config.provider]}`,
      config.provider,
    );
  }

  const reserves = (['groq', 'gemini', 'claude'] as const)
    .filter((name) => name !== config.provider)
    .map((name) => built[name])
    .filter((p): p is AiProvider => Boolean(p));

  return [preferred, ...reserves];
}

export function createAiProvider(config: ProviderConfig): AiProvider {
  const { provider, embeddingDimensions } = config;

  /**
   * Only Gemini offers embeddings, so every non-Gemini provider is composed with the
   * Gemini embedder rather than being used alone. Building it here — and failing loudly
   * on a missing Gemini key — means selecting a different chat provider can never
   * silently break retrieval, which would show up as a RAG system that quietly stops
   * finding anything.
   */
  const geminiEmbedder = (forProvider: ProviderName): GeminiProvider => {
    if (!config.gemini?.apiKey) {
      throw new AiProviderError(
        `AI_PROVIDER=${forProvider} still requires GEMINI_API_KEY for embeddings ` +
          `(${forProvider} has no embeddings endpoint)`,
        forProvider,
      );
    }
    return new GeminiProvider(
      config.gemini.apiKey,
      config.gemini.chatModel,
      config.gemini.embedModel,
      embeddingDimensions,
    );
  };

  const chat = chatProvidersFor(config);
  const chatChain = chat.length > 1 ? new FailoverProvider(chat) : chat[0]!;

  /**
   * Gemini alone needs no composition — it is its own embedder.
   *
   * For anything else, generation goes through the failover chain and embeddings stay pinned to
   * Gemini, because it is the only provider with an embeddings endpoint. Routing them separately
   * is what stops a chat-provider outage from also taking retrieval down.
   */
  if (provider === 'gemini' && chat.length === 1) return chatChain;

  return new CompositeProvider(chatChain, geminiEmbedder(provider));
}
