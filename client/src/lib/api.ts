import type { ApiError } from '@krishibid/shared';

const BASE = '/api';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    /** Stable machine-readable code — branch on this, never on the message. */
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Access token lives in memory only.
 *
 * Deliberately NOT localStorage: a token readable from JS is a token stealable by
 * any XSS. The long-lived refresh token is an httpOnly cookie the JS never sees, so
 * a page reload silently re-authenticates via /auth/refresh instead.
 */
let accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};
export const getAccessToken = (): string | null => accessToken;

/**
 * Single-flight refresh.
 *
 * Without this, a screen that fires several queries at once would send N parallel
 * refresh requests on expiry. Since refresh tokens ROTATE, the first would succeed
 * and the rest would present an already-rotated token — which the server correctly
 * treats as theft and responds to by revoking every session. Sharing one in-flight
 * promise is what stops a normal page load from logging the user out.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Internal: prevents infinite refresh recursion. */
  _retried?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, _retried, headers, ...rest } = options;

  const isFormData = body instanceof FormData;

  const response = await fetch(`${BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Access token expired — refresh once, then replay the original request.
  if (response.status === 401 && !_retried) {
    if (await refreshAccessToken()) {
      return apiRequest<T>(path, { ...options, _retried: true });
    }
    accessToken = null;
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const err = payload as ApiError | null;
    throw new ApiRequestError(
      response.status,
      err?.error?.code ?? 'unknown_error',
      err?.error?.message ?? `request failed with ${response.status}`,
      err?.error?.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
  refresh: refreshAccessToken,
};
