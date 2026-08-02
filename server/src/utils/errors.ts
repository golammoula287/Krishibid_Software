/**
 * Application error taxonomy.
 *
 * Every thrown error carries a stable machine-readable `code` alongside the HTTP
 * status. Clients branch on the code, never on the message — so message wording
 * (and its Bangla translation) can change without breaking the frontend.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);

export const unauthorized = (message = 'authentication required') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'not permitted') =>
  new AppError(403, 'forbidden', message);

/**
 * 403 carrying a specific code.
 *
 * For refusals the client must render differently rather than as one generic "not allowed" —
 * an account awaiting approval is not a mistake the user made, and showing it in the same red
 * box as a permission error tells them they did something wrong when they did not.
 */
export const refused = (code: string, message: string, details?: unknown) =>
  new AppError(403, code, message, details);

export const notFound = (resource: string) =>
  new AppError(404, 'not_found', `${resource} not found`);

/**
 * 409 — the caller's view of the world is stale.
 *
 * Used heavily by the bidding engine: outbid, listing closed, version mismatch.
 * These are expected outcomes of healthy concurrency, not server faults, and
 * must never be logged as errors or reported as 500s.
 */
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, details);

export const tooManyRequests = (message = 'rate limit exceeded') =>
  new AppError(429, 'rate_limited', message);

export const internal = (message = 'internal server error') =>
  new AppError(500, 'internal_error', message);

export const serviceUnavailable = (code: string, message: string) =>
  new AppError(503, code, message);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
