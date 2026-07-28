import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDb, disconnectDb } from './utils/db.js';
import { logger } from './utils/logger.js';
import { startJobs, stopJobs } from './jobs/index.js';
import { loadModel } from './services/diagnosis.service.js';
import { closeSocket, initSocket } from './sockets/index.js';

async function main(): Promise<void> {
  const e = env();

  await connectDb();

  // Model load is intentionally non-fatal on failure — the marketplace and payment
  // paths must come up even if the ONNX artifact is missing.
  await loadModel();

  const app = createApp();
  const server = createServer(app);
  initSocket(server);
  startJobs();

  server.listen(e.PORT, () => {
    logger.info(
      { port: e.PORT, env: e.NODE_ENV, aiProvider: e.AI_PROVIDER },
      `KrishiBid API listening on :${e.PORT}`,
    );
    // Accurate per mode: in mock mode payments DO work, so the old unconditional
    // "payment routes will return 503" warning was actively misleading in the logs.
    if (e.PAYMENT_MODE === 'mock') {
      logger.warn(
        'PAYMENT_MODE=mock — checkout is SIMULATED, no gateway is contacted and no real money moves',
      );
    } else if (!e.SSLCZ_STORE_ID) {
      logger.warn('SSLCOMMERZ is not configured — payment routes will return 503');
    }
    if (!e.API_PUBLIC_URL.startsWith('https://')) {
      logger.warn(
        { apiPublicUrl: e.API_PUBLIC_URL },
        'API_PUBLIC_URL is not https — SSLCOMMERZ cannot deliver IPN callbacks; use a tunnel in development',
      );
    }
  });

  /**
   * Graceful shutdown.
   *
   * Order matters: stop accepting connections, then stop the jobs, then close the
   * DB. Closing the DB first would make an in-flight payment capture fail
   * mid-ledger-write — precisely the moment we least want to be interrupted.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const force = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 15_000);
    force.unref();

    server.close();
    stopJobs();
    await closeSocket();
    await disconnectDb();

    clearTimeout(force);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception; exiting');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
});
