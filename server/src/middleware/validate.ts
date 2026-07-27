import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { badRequest } from '../utils/errors.js';

type Source = 'body' | 'query' | 'params';

/**
 * Validates and *replaces* the request segment with the parsed result.
 *
 * Replacing rather than merely checking matters: Zod transforms (phone
 * normalisation, string→number coercion for query params) only take effect
 * downstream if the parsed value is what the handler reads.
 */
export function validate<S extends ZodTypeAny>(schema: S, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[source]) as z.infer<S>;
      Object.defineProperty(req, source, {
        value: parsed,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        next(
          badRequest(
            'validation_failed',
            'request validation failed',
            e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          ),
        );
        return;
      }
      next(e);
    }
  };
}
