import { AiQuotaError } from '../services/ai/index.js';
import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { isAppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'route_not_found', message: `${req.method} ${req.path} not found` },
  });
}

/**
 * Terminal error handler.
 *
 * Two deliberate choices:
 *  - 4xx are logged at `warn`, 5xx at `error`. Bidding conflicts (409) are the
 *    expected outcome of healthy concurrency; if they logged as errors the
 *    signal would be drowned during any demo.
 *  - Unknown errors never leak a message to the client. An internal message can
 *    contain a connection string or a stack fragment.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (isAppError(err)) {
    const log = err.status >= 500 ? logger.error : logger.warn;
    log.call(
      logger,
      { code: err.code, status: err.status, path: req.path, reqId: req.id },
      err.message,
    );
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  // Duplicate key — surfaces as a conflict, not a 500. The unique indexes on
  // orders.listingId and payments.tranId are load-bearing race guards, so
  // hitting them is a legitimate concurrent-request outcome.
  if (err instanceof mongoose.mongo.MongoServerError && err.code === 11000) {
    logger.warn({ keyPattern: err.keyPattern, path: req.path }, 'duplicate key');
    res.status(409).json({
      error: {
        code: 'duplicate_resource',
        message: 'that resource already exists',
        details: err.keyPattern,
      },
    });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'request validation failed',
        details: Object.fromEntries(
          Object.entries(err.errors).map(([k, v]) => [k, v.message]),
        ),
      },
    });
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({
      error: { code: 'invalid_id', message: `invalid value for ${err.path}` },
    });
    return;
  }

  if (err instanceof AiQuotaError) {
    logger.warn({ provider: err.provider }, 'AI provider quota exhausted');
    res.status(503).json({
      error: {
        code: 'ai_quota_exhausted',
        message: 'the advisory service is busy right now; please try again shortly',
      },
    });
    return;
  }

  logger.error({ err, path: req.path, reqId: req.id }, 'unhandled error');
  res.status(500).json({
    error: { code: 'internal_error', message: 'internal server error' },
  });
}
