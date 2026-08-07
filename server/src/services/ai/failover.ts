import { AiProviderError, AiQuotaError } from './errors.js';
import { logger } from '../../utils/logger.js';
import type { AiProvider, CompleteOptions, CompleteResult, EmbedResult } from './types.js';

/**
 * Runs a chain of providers, moving to the next when one is out of quota.
 *
 * Every provider here is on a free tier with a daily cap, and the caps are hit — a busy afternoon
 * exhausts Gemini's 1,500 requests and the advisor stops answering for everybody until midnight
 * UTC. Two accounts with different limits do not run out at the same moment, so the second one
 * covers the first.
 *
 * The failover is deliberately narrow. It triggers on quota and on transient availability
 * failures, and on nothing else:
 *
 *  - `AiQuotaError` — the whole point. This provider is done for now; the next one is not.
 *  - retryable `AiProviderError` (5xx, timeouts) — the provider is up but unwell.
 *  - `AiSchemaError` is NOT retried elsewhere. The model returned text that did not match the
 *    schema, which is a content problem rather than an availability one; the caller already has
 *    salvage logic for it, and burning the reserve provider's quota on every flaky response would
 *    exhaust the thing being held in reserve.
 *  - A bad request is not retried either. It will fail identically on the next provider, twice as
 *    slowly, for two providers' worth of quota.
 *
 * Which provider actually served a request is logged, because "the advisor got worse this
 * afternoon" is otherwise impossible to explain.
 */
export class FailoverProvider implements AiProvider {
  /**
   * @param chain Ordered by preference. The first is the primary; the rest are reserves.
   */
  constructor(private readonly chain: AiProvider[]) {
    if (chain.length === 0) {
      throw new AiProviderError('a failover chain needs at least one provider', 'failover');
    }
  }

  private get primary(): AiProvider {
    return this.chain[0]!;
  }

  /**
   * Reports the primary's identity, not "failover".
   *
   * Callers use `name` and `chatModel` for logging and for the cost estimate, and both want to
   * know what is normally in use. The per-request log line below says what actually served it.
   */
  get name() {
    return this.primary.name;
  }
  get chatModel() {
    return this.primary.chatModel;
  }
  get embedModel() {
    return this.primary.embedModel;
  }
  get embeddingDimensions() {
    return this.primary.embeddingDimensions;
  }

  private shouldFailover(error: unknown): boolean {
    if (error instanceof AiQuotaError) return true;
    // `retryable` is set by each provider for 5xx and network failures. `AiSchemaError`
    // constructs with retryable false, so it is excluded here without naming it.
    return error instanceof AiProviderError && error.retryable;
  }

  private async run<T>(
    operation: string,
    call: (provider: AiProvider) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (const [index, provider] of this.chain.entries()) {
      try {
        const result = await call(provider);

        if (index > 0) {
          logger.warn(
            { operation, served: provider.name, primary: this.primary.name, position: index },
            'primary AI provider unavailable; a reserve served this request',
          );
        }
        return result;
      } catch (err) {
        lastError = err;

        if (!this.shouldFailover(err)) throw err;

        const next = this.chain[index + 1];
        logger.warn(
          {
            operation,
            provider: provider.name,
            reason: err instanceof Error ? err.message : String(err),
            fallingBackTo: next?.name ?? '(none left)',
          },
          'AI provider exhausted or unavailable',
        );
      }
    }

    // Everything in the chain is down or out of quota. The advisory service turns this into a
    // degraded, retrieval-only answer rather than a 500 — see `ask()`.
    throw lastError;
  }

  complete(prompt: string, options?: CompleteOptions): Promise<CompleteResult> {
    return this.run('complete', (provider) => provider.complete(prompt, options));
  }

  /**
   * Embeddings failover over whichever providers can actually embed.
   *
   * Only Gemini has an embeddings endpoint today, so in practice this chain has one entry and
   * this is a passthrough. It is written as a chain anyway because the alternative — special-
   * casing embeddings to the primary — is what breaks the day a second embedding provider is
   * added and nobody remembers this file.
   */
  embed(texts: string[]): Promise<EmbedResult> {
    return this.run('embed', (provider) => provider.embed(texts));
  }
}
