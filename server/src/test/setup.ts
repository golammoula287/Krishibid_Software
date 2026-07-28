import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';
import { connectDb, disconnectDb } from '../utils/db.js';

/**
 * Environment is set at MODULE TOP LEVEL, not inside `beforeAll`.
 *
 * setupFiles are evaluated before the test file is imported, but a test file's own
 * imports are hoisted above its `beforeAll`. Any module that read config during
 * import would therefore see an unconfigured environment if these assignments lived
 * in a hook.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = inject('mongoUri');
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-long-enough-000000';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-00000';
process.env.GEMINI_API_KEY = 'test-key';
// SSLCZ_STORE_PASSWORD must match the password the signature test signs with.
process.env.SSLCZ_STORE_ID = 'testbox';
process.env.SSLCZ_STORE_PASSWORD = 'testpass';
process.env.DEMO_PASSWORD = 'demo-password';

/**
 * Connects through the application's own `connectDb`, not a bare `mongoose.connect`.
 *
 * The distinction matters: an earlier version connected directly, so every setting
 * applied inside `connectDb` was exercised only in production. That let a global
 * `sanitizeFilter` ship untested — it silently rewrote legitimate `$in` filters and
 * broke KB ingest and payment capture while the whole suite stayed green.
 *
 * Tests should share the production connection path so configuration is covered too.
 */
beforeAll(async () => {
  await connectDb(inject('mongoUri'));
}, 60_000);

afterEach(async () => {
  // Truncate rather than drop: dropping would also drop the indexes, and several
  // tests depend on unique indexes (orders.listingId, payments.tranId, the ledger's
  // partial unique index) being live.
  const db = mongoose.connection.db;
  if (!db) return;
  const collections = await db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await disconnectDb();
});
