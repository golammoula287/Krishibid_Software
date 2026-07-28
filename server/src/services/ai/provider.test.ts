import { describe, expect, it } from 'vitest';
import { AiProviderError } from './errors.js';
import { createAiProvider } from './index.js';

const DIMS = 1536;

const base = {
  embeddingDimensions: DIMS,
  gemini: { apiKey: 'g-key', chatModel: 'gemini-3.6-flash', embedModel: 'gemini-embedding-001' },
  claude: { apiKey: 'c-key', chatModel: 'claude-opus-5' },
  groq: { apiKey: 'q-key', chatModel: 'llama-3.3-70b-versatile' },
};

describe('AI provider factory', () => {
  it('defaults to Gemini for both chat and embeddings', () => {
    const p = createAiProvider({ ...base, provider: 'gemini' });
    expect(p.name).toBe('gemini');
    expect(p.chatModel).toBe('gemini-3.6-flash');
    expect(p.embedModel).toBe('gemini-embedding-001');
  });

  /**
   * The invariant that keeps a provider swap from silently breaking RAG: only Gemini
   * offers embeddings, so every other provider must be composed with the Gemini
   * embedder rather than used alone.
   */
  it.each([
    ['claude', 'claude-opus-5'],
    ['groq', 'llama-3.3-70b-versatile'],
  ] as const)('routes %s chat but keeps embeddings on Gemini', (provider, chatModel) => {
    const p = createAiProvider({ ...base, provider });
    expect(p.name).toBe(provider);
    expect(p.chatModel).toBe(chatModel);
    expect(p.embedModel).toBe('gemini-embedding-001');
    expect(p.embeddingDimensions).toBe(DIMS);
  });

  it.each(['claude', 'groq'] as const)(
    'refuses %s without a Gemini key, since retrieval would break',
    (provider) => {
      // Failing loudly at construction is the point. Without this the app would boot
      // fine and every question would silently return nothing.
      expect(() =>
        createAiProvider({ ...base, provider, gemini: undefined }),
      ).toThrowError(/requires GEMINI_API_KEY for embeddings/);
    },
  );

  it('refuses groq without a Groq key', () => {
    expect(() => createAiProvider({ ...base, provider: 'groq', groq: undefined })).toThrowError(
      /requires GROQ_API_KEY/,
    );
  });

  it('refuses claude without an Anthropic key', () => {
    expect(() =>
      createAiProvider({ ...base, provider: 'claude', claude: undefined }),
    ).toThrowError(/requires ANTHROPIC_API_KEY/);
  });

  it('refuses gemini without a Gemini key', () => {
    expect(() =>
      createAiProvider({ ...base, provider: 'gemini', gemini: undefined }),
    ).toThrowError(AiProviderError);
  });

  it.each(['claude', 'groq'] as const)(
    'rejects a direct embed() call on the %s provider',
    async (provider) => {
      // Documents the limitation rather than leaving it to be discovered: these classes
      // throw on embed(), which is safe only because the factory never routes
      // embeddings to them.
      const { ClaudeProvider } = await import('./claude.js');
      const { GroqProvider } = await import('./groq.js');

      const direct =
        provider === 'claude'
          ? new ClaudeProvider('c-key', 'claude-opus-5', DIMS)
          : new GroqProvider('q-key', 'llama-3.3-70b-versatile', DIMS);

      await expect(direct.embed()).rejects.toThrowError(/no embeddings endpoint/);
    },
  );
});
