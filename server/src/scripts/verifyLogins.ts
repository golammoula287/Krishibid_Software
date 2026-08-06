/**
 * Proves the seeded accounts can actually log in.
 *
 *   npm run verify:logins
 *
 * A seed that reports success only proves it wrote rows. Whether somebody can sign in with those
 * rows is a different question — it depends on the password hash, the account status, the role
 * gates and, since login accepts either identifier, on the lookup picking the right field. Every
 * one of those has been wrong at some point in this project's history.
 *
 * So this drives the real `login()` for each account, by email and by phone, and reports what a
 * person would actually experience.
 */
import { connectDb, disconnectDb } from '../utils/db.js';
import { logger } from '../utils/logger.js';
import { User } from '../models/User.js';
import { login } from '../services/auth.service.js';

const PASSWORD = '12345678';

const ACCOUNTS = [
  { label: 'super admin', email: 'rakibmoula2001@gmail.com' },
  { label: 'admin', email: 'gmrakib2001@gmail.com' },
  { label: 'supplier', email: 'suplier@gmail.com' },
  { label: 'buyer', email: 'buyer@gmail.com' },
];

async function verify(): Promise<void> {
  await connectDb();

  let failures = 0;

  for (const account of ACCOUNTS) {
    const user = await User.findOne({ email: account.email }).lean();

    if (!user) {
      console.log(`FAIL  ${account.label.padEnd(12)} ${account.email} — no such account`);
      failures++;
      continue;
    }

    // Both identifiers, because accepting either is the whole point of the change that made
    // these addresses usable as credentials.
    for (const [kind, identifier] of [
      ['email', account.email],
      ['phone', user.phone],
    ] as const) {
      try {
        const session = await login({ identifier, password: PASSWORD });
        console.log(
          `PASS  ${account.label.padEnd(12)} by ${kind.padEnd(5)} ` +
            `${identifier.padEnd(26)} role=${session.auth.user.role}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`FAIL  ${account.label.padEnd(12)} by ${kind.padEnd(5)} ${identifier} — ${message}`);
        failures++;
      }
    }
  }

  // What an admin will be looking at the moment they log in.
  const pending = await User.countDocuments({ 'kyc.status': 'pending_review' });
  const suppliers = await User.countDocuments({ role: 'farmer' });
  const buyers = await User.countDocuments({ role: 'buyer' });
  console.log(
    `\nsuppliers: ${suppliers}   buyers: ${buyers}   awaiting approval: ${pending}`,
  );

  await disconnectDb();
  console.log(failures === 0 ? '\nALL LOGINS WORK' : `\n${failures} LOGIN CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

verify().catch((err) => {
  logger.fatal({ err }, 'login verification failed');
  process.exit(1);
});
