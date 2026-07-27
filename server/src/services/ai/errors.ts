export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/**
 * The free tier's daily/minute cap has been hit.
 *
 * Distinguished from a generic error because the caller's correct response is
 * different: fall back to a degraded (retrieval-only) answer rather than
 * surfacing a 500. `retryAfterMs` is honoured by the retry helper when present.
 */
export class AiQuotaError extends AiProviderError {
  constructor(
    message: string,
    provider: string,
    readonly retryAfterMs?: number,
  ) {
    super(message, provider, 429, true);
    this.name = 'AiQuotaError';
  }
}

export class AiSchemaError extends AiProviderError {
  constructor(
    message: string,
    provider: string,
    readonly raw: string,
  ) {
    super(message, provider, undefined, false);
    this.name = 'AiSchemaError';
  }
}
