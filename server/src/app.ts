import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { sanitizeInput } from './middleware/sanitize.js';
import { apiRoutes } from './routes/index.js';
import { isModelReady } from './services/diagnosis.service.js';
import { auditLedger } from './services/ledger.service.js';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1); // behind Render/Cloudflare — required for correct req.ip
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header means same-origin, curl, or a server-to-server call such
        // as the SSLCOMMERZ IPN. Must be allowed or payments break.
        if (!origin) return callback(null, true);
        if (env().corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`origin ${origin} is not allowed`));
      },
      credentials: true,
    }),
  );

  app.use(cookieParser());

  // The gateway posts IPN and browser callbacks as form-encoded, not JSON.
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(express.json({ limit: '1mb' }));

  // Request id for correlating a request's many log lines.
  app.use((req: Request, res: Response, next) => {
    req.id = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });

  app.use(sanitizeInput);

  // ---- health & metrics (unauthenticated, before the rate limiter) ----

  app.get('/health', (_req: Request, res: Response) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({
      status: dbUp ? 'ok' : 'degraded',
      db: dbUp ? 'up' : 'down',
      diseaseModel: isModelReady() ? 'ready' : 'unavailable',
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  /**
   * Ops surface, deliberately small and text-based.
   *
   * The ledger imbalance count is here because it is the single most important
   * number in the system: anything other than 0 means the books disagree with
   * themselves and payments cannot be trusted.
   */
  app.get('/metrics', async (_req: Request, res: Response) => {
    const imbalances = await auditLedger().catch(() => []);
    const mem = process.memoryUsage();

    res.type('text/plain').send(
      [
        `krishibid_uptime_seconds ${Math.round(process.uptime())}`,
        `krishibid_db_up ${mongoose.connection.readyState === 1 ? 1 : 0}`,
        `krishibid_disease_model_ready ${isModelReady() ? 1 : 0}`,
        `krishibid_ledger_imbalanced_transactions ${imbalances.length}`,
        `krishibid_heap_used_bytes ${mem.heapUsed}`,
        `krishibid_rss_bytes ${mem.rss}`,
      ].join('\n'),
    );
  });

  app.use(globalLimiter);
  app.use('/api', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.debug('express app constructed');
  return app;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
    }
  }
}
