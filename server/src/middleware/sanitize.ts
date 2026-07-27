import type { NextFunction, Request, Response } from 'express';
import { badRequest } from '../utils/errors.js';

/**
 * Rejects operator-shaped keys in user input.
 *
 * Without this, a JSON body of `{"phone": {"$ne": null}}` reaches a Mongoose
 * query as an operator and matches an arbitrary user. Mongoose's
 * `sanitizeFilter` is also enabled in db.ts; this is the outer layer so the
 * request is refused loudly at the edge rather than silently neutered deeper in.
 */
const FORBIDDEN_KEY = /^\$|\./;

function scan(value: unknown, path: string, depth = 0): string | null {
  // Bound recursion — a deliberately deep payload should not blow the stack.
  if (depth > 12) return path;

  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const hit = scan(item, `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(key)) return path ? `${path}.${key}` : key;
      const hit = scan(child, path ? `${path}.${key}` : key, depth + 1);
      if (hit) return hit;
    }
  }

  return null;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  for (const source of ['body', 'query', 'params'] as const) {
    const offending = scan(req[source], '');
    if (offending) {
      return next(
        badRequest(
          'illegal_key',
          `request contains a disallowed key: ${offending}`,
        ),
      );
    }
  }
  next();
}
