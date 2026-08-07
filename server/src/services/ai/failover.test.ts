import { describe, expect, it } from 'vitest';
import { AiProviderError, AiQuotaError, AiSchemaError } from './errors.js';
import { FailoverProvider } from './failover.js';
import type { AiProvider, CompleteResult, EmbedResult } from './types.js';

/** A provider that does whatever the test tells it to, and counts how often it was asked. */
function fake(name: string, behaviour: () => Promise<CompleteResult>): AiProvider & { calls: number } {
  const provider = {
    calls: 0,
    name,
    chatModel: `${name}-model`,
    embedModel: `${name}-embed`,
    embeddingDimensions: 1536,
    async complete() {
      provider.calls++;
      return behaviour();
    },
    async embed(): Promise<EmbedResult> {
      provider.calls++;
      await behaviour();
      return { vectors: [[0]], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
    },
  };
  return provider as AiProvider & { calls: number };
}

const ok = (text: string): (() => Promise<CompleteResult>) => async () => ({
  text,
  usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
  stopReason: 'stop',
});

const fails = (error: Error): (() => Promise<CompleteResult>) => async () => {
  throw error;
};

/**
 * Failing over when a free tier runs dry.
 *
 * Every provider here has a daily cap and the caps get hit — a busy afternoon exhausts one and
 * the advisor stops answering for everybody until it resets. The value of a second key is
 * entirely in this switching happening by itself, so it is worth testing that it does, and worth
 * testing just as hard that it does NOT happen for failures a second provider cannot fix.
 */
describe('the provider failover chain', () => {
  it('uses the primary and never touches the reserve while it works', async () => {
    const primary = fake('groq', ok('from groq'));
    const reserve = fake('gemini', ok('from gemini'));

    const result = await new FailoverProvider([primary, reserve]).complete('q');

    expect(result.text).toBe('from groq');
    expect(reserve.calls).toBe(0);
  });

  it('moves to the reserve when the primary is out of quota', async () => {
    const primary = fake('groq', fails(new AiQuotaError('daily cap reached', 'groq')));
    const reserve = fake('gemini', ok('from gemini'));

    const result = await new FailoverProvider([primary, reserve]).complete('q');

    expect(result.text).toBe('from gemini');
    expect(primary.calls).toBe(1);
  });

  it('moves on when a provider is up but unwell', async () => {
    // A 5xx or a timeout: the provider is not out of quota, it is just not answering.
    const primary = fake('groq', fails(new AiProviderError('502', 'groq', 502, true)));
    const reserve = fake('gemini', ok('from gemini'));

    expect((await new FailoverProvider([primary, reserve]).complete('q')).text).toBe(
      'from gemini',
    );
  });

  it('walks the whole chain rather than stopping at the second', async () => {
    const first = fake('groq', fails(new AiQuotaError('out', 'groq')));
    const second = fake('gemini', fails(new AiQuotaError('out', 'gemini')));
    const third = fake('claude', ok('from claude'));

    expect((await new FailoverProvider([first, second, third]).complete('q')).text).toBe(
      'from claude',
    );
  });

  /**
   * The reserve exists for availability, and spending it on content problems is how it is not
   * there when quota actually runs out.
   */
  it('does NOT fail over when the model returned unusable output', async () => {
    const primary = fake('groq', fails(new AiSchemaError('not json', 'groq', '{oops')));
    const reserve = fake('gemini', ok('from gemini'));

    await expect(new FailoverProvider([primary, reserve]).complete('q')).rejects.toThrow(
      AiSchemaError,
    );
    // Untouched: the next provider would almost certainly produce the same shape of failure,
    // and the caller already has salvage logic for it.
    expect(reserve.calls).toBe(0);
  });

  it('does NOT fail over on a bad request', async () => {
    // Identical failure on the next provider, twice as slowly, for two providers' worth of quota.
    const primary = fake('groq', fails(new AiProviderError('bad request', 'groq', 400, false)));
    const reserve = fake('gemini', ok('from gemini'));

    await expect(new FailoverProvider([primary, reserve]).complete('q')).rejects.toThrow();
    expect(reserve.calls).toBe(0);
  });

  it('surfaces the last failure when everything is exhausted', async () => {
    const first = fake('groq', fails(new AiQuotaError('groq out', 'groq')));
    const second = fake('gemini', fails(new AiQuotaError('gemini out', 'gemini')));

    // The advisory service turns this into a degraded, retrieval-only answer rather than a 500.
    await expect(new FailoverProvider([first, second]).complete('q')).rejects.toThrow(
      'gemini out',
    );
  });

  it('reports the primary’s identity, not the chain’s', async () => {
    const chain = new FailoverProvider([fake('groq', ok('x')), fake('gemini', ok('y'))]);

    // Callers use this for logging and the cost estimate, and both want what is normally in use.
    expect(chain.name).toBe('groq');
    expect(chain.chatModel).toBe('groq-model');
  });

  it('fails over on embeddings too', async () => {
    const primary = fake('a', fails(new AiQuotaError('out', 'a')));
    const reserve = fake('b', ok('unused'));

    await new FailoverProvider([primary, reserve]).embed(['text']);

    expect(reserve.calls).toBe(1);
  });

  it('refuses to be constructed empty', () => {
    expect(() => new FailoverProvider([])).toThrow();
  });

});
