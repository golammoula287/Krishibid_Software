import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let connected = false;

export async function connectDb(uri = env().MONGODB_URI): Promise<void> {
  if (connected) return;

  mongoose.set('strictQuery', true);

  /**
   * `sanitizeFilter` is deliberately NOT enabled.
   *
   * It wraps any filter value containing `$` keys in `$eq`, which does block query
   * selector injection — but it cannot distinguish untrusted input from the
   * application's own operators. It therefore breaks every legitimate `$in`, `$lte`
   * and `$ne` this codebase relies on, including the `status: { $in: [...] }` guard
   * that makes payment capture idempotent. Turning it on trades a defended attack for
   * a broken payment path.
   *
   * NoSQL injection is instead closed at the boundary where untrusted data actually
   * enters: `sanitizeInput` (middleware/sanitize.ts) rejects any request whose body,
   * query or params contain an operator-shaped key, before it can reach a query at
   * all. That keeps user input safe while leaving trusted server code free to use
   * operators normally.
   */

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    // M0 is a shared tier with a low connection ceiling; a large pool here
    // exhausts it and produces confusing timeouts under trivial load.
    maxPoolSize: 10,
    minPoolSize: 1,
    retryWrites: true,
  });

  connected = true;
  logger.info({ db: mongoose.connection.name }, 'mongodb connected');

  mongoose.connection.on('disconnected', () => {
    connected = false;
    logger.warn('mongodb disconnected');
  });
  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'mongodb error');
  });
}

export async function disconnectDb(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

/**
 * True when the deployment supports multi-document transactions.
 *
 * Atlas (even M0) is a replica set, so transactions work. A bare standalone
 * `mongod` — which some contributors run locally — does not. The payment path
 * needs to know: without transactions it must refuse to write a partial ledger
 * rather than silently produce an unbalanced one.
 */
export async function supportsTransactions(): Promise<boolean> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return false;
    const info = await admin.command({ hello: 1 });
    return Boolean(info.setName ?? info.msg === 'isdbgrid');
  } catch {
    return false;
  }
}

export { mongoose };
