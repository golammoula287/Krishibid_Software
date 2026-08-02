/**
 * One-off migration for the account-creation change: `users.email` became REQUIRED and UNIQUE.
 *
 *   npm run migrate:emails            # local / tsx
 *   npm run migrate:emails:prod       # on a deployed box, from dist/
 *   npm run migrate:emails -- --dry   # report only, change nothing
 *
 * Why this exists, and why it must run BEFORE the new code serves traffic.
 *
 * Two things break on a database whose users predate the change, and both were measured rather
 * than assumed:
 *
 *   1. Every login calls `user.save()` to store the rotated refresh-token hash. Mongoose
 *      validates the whole document on save, so a user with no email fails with
 *      "Path `email` is required" — that is not a degraded feature, it is every existing
 *      account locked out.
 *   2. The unique index cannot build over two or more documents with a missing email: they all
 *      collide on null. The index build fails with E11000 and the constraint silently never
 *      exists.
 *
 * The fix is to give every account an address before the new schema meets it.
 *
 * Placeholders use `@krishibid.invalid`. `.invalid` is reserved by RFC 2606 and can never be
 * registered by anyone, so a placeholder can never accidentally deliver mail to a real stranger —
 * which a made-up address on a real domain absolutely can.
 *
 * Placeholders are marked `emailVerified: false`, because nobody proved them. That is deliberate
 * and it has a visible cost: an already-approved farmer with a placeholder cannot list produce
 * until they supply a real address, since `requireApprovedFarmer` gates on `emailVerified`. The
 * alternative — marking an invented address as verified — would put a verified badge on something
 * nobody checked, which is exactly the lie this whole change exists to remove. Affected users fix
 * it in one screen: Account → Verify your email → "Wrong address? Change it".
 *
 * Idempotent. Running it twice changes nothing the second time.
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { connectDb, disconnectDb } from '../utils/db.js';
import { logger } from '../utils/logger.js';
import { User } from '../models/User.js';

const DRY_RUN = process.argv.includes('--dry');

/** Stable per user, so re-running produces the same address rather than a new one. */
const placeholderFor = (id: mongoose.Types.ObjectId): string =>
  `user-${String(id)}@krishibid.invalid`;

interface RawUser {
  _id: mongoose.Types.ObjectId;
  email?: string | null;
  phone?: string;
  role?: string;
  createdAt?: Date;
}

/**
 * Exported and connection-agnostic, so the test suite can run it against a real database and
 * prove it fixes the two failures rather than describing them.
 */
export async function migrateEmails(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no database handle');
  const users = db.collection<RawUser>('users');

  // Read through the driver, not the model: these documents do not satisfy the new schema, which
  // is the entire problem, and mongoose would refuse to hydrate some of them.
  const missing = await users
    .find({ $or: [{ email: { $exists: false } }, { email: null }, { email: '' }] })
    .project<RawUser>({ _id: 1, phone: 1, role: 1 })
    .toArray();

  logger.info({ count: missing.length }, 'users with no email address');

  /**
   * Duplicates, from when the field was optional AND non-unique.
   *
   * The oldest account keeps the address — it is the one most likely to be the real owner, and
   * it is the least surprising rule to explain. The others are placeholdered and logged
   * individually, so the change is auditable rather than a silent reassignment.
   */
  const duplicates = await users
    .aggregate<{ _id: string; ids: mongoose.Types.ObjectId[] }>([
      { $match: { email: { $nin: [null, ''] }, $expr: { $eq: [{ $type: '$email' }, 'string'] } } },
      { $sort: { createdAt: 1, _id: 1 } },
      { $group: { _id: '$email', ids: { $push: '$_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  const losers = duplicates.flatMap((group) => group.ids.slice(1));

  if (duplicates.length > 0) {
    logger.warn(
      { addresses: duplicates.length, accountsReassigned: losers.length },
      'duplicate email addresses found — the OLDEST account keeps each address',
    );
    for (const group of duplicates) {
      logger.warn(
        { email: group._id, keeping: String(group.ids[0]), placeholdering: group.ids.slice(1).map(String) },
        'duplicate address',
      );
    }
  }

  const targets = [...missing.map((u) => u._id), ...losers];

  if (targets.length === 0) {
    logger.info('nothing to migrate — every user already has a unique email address');
  } else if (DRY_RUN) {
    logger.info({ wouldUpdate: targets.length }, 'dry run — no changes written');
  } else {
    const operations = targets.map((id) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { email: placeholderFor(id), emailVerified: false } },
      },
    }));

    const result = await users.bulkWrite(operations, { ordered: false });
    logger.info({ updated: result.modifiedCount }, 'placeholder addresses written');
  }

  /**
   * Replace the old index.
   *
   * `email` previously carried a plain non-unique index. Mongo will not silently change an
   * existing index's options, so the stale one is dropped explicitly before the unique one is
   * built — otherwise `createIndexes` reports success while leaving the old definition in place
   * and the constraint never actually exists.
   */
  if (!DRY_RUN) {
    const existing = await users.indexes();
    const stale = existing.find((index) => index.name === 'email_1' && !index.unique);

    if (stale) {
      await users.dropIndex('email_1');
      logger.info('dropped the old non-unique email index');
    }

    try {
      await User.createIndexes();
      logger.info('unique email index built');
    } catch (err) {
      // Reported rather than swallowed: without this index two concurrent registrations can
      // both claim an address, which is the failure the index exists to prevent.
      logger.error({ err }, 'the unique email index could NOT be built — resolve before deploying');
      throw err;
    }
  }

  const remaining = await users.countDocuments({
    $or: [{ email: { $exists: false } }, { email: null }, { email: '' }],
  });
  const placeholders = await users.countDocuments({ email: /@krishibid\.invalid$/ });

  logger.info(
    { remainingWithoutEmail: remaining, placeholders },
    placeholders > 0
      ? 'migration complete — accounts on a placeholder must set a real address before they can ' +
          'verify, list produce, or raise their bid limit (Account → Verify your email → ' +
          '"Wrong address? Change it")'
      : 'migration complete',
  );
}

/**
 * Only when run as a command, never on import.
 *
 * Without the guard, importing this module from a test would connect to nothing and start
 * rewriting whichever database happened to be open.
 */
const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry!).href;
};

if (isEntryPoint()) {
  connectDb()
    .then(migrateEmails)
    .then(disconnectDb)
    .catch((err: unknown) => {
      logger.fatal({ err }, 'email migration failed');
      process.exit(1);
    });
}
