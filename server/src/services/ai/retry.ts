import { AiProviderError, AiQuotaError } from './errors.js';

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Exponential backoff with full jitter.
 *
 * Jitter matters here specifically: the KB ingest script embeds in batches in a
 * tight loop, and synchronised retries against a 10-requests-per-minute free
 * tier would produce a thundering herd that never drains.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 4, baseDelayMs = 500, maxDelayMs = 20_000 }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const retryable = error instanceof AiProviderError ? error.retryable : false;
      if (!retryable || attempt === attempts - 1) throw error;

      // Honour a server-provided delay over our own guess.
      const serverDelay = error instanceof AiQuotaError ? error.retryAfterMs : undefined;
      const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const delay = serverDelay ?? Math.random() * backoff;

      await sleep(delay);
    }
  }

  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts a JSON object from model output.
 *
 * Even in JSON mode, providers occasionally wrap output in ```json fences or
 * emit a leading prose sentence. Rather than fail the whole request on that, we
 * take the outermost balanced object. Returns null if nothing parses — callers
 * treat that as a schema error, never as an empty answer.
 */
export function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim();

  const direct = tryParse(trimmed);
  if (direct !== null) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed !== null) return parsed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return tryParse(trimmed.slice(start, end + 1));
  }

  return null;
}

function tryParse(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
