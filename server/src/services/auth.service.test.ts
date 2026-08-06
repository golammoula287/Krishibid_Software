import { describe, expect, it } from 'vitest';
import { FIXTURE_PASSWORD, makeUser } from '../test/factories.js';
import { User } from '../models/User.js';
import { demoLogin, login } from './auth.service.js';

/**
 * Whether somebody can actually sign in.
 *
 * This is the least interesting behaviour in the system and the one most worth a test, because
 * every other feature is behind it and because it has broken twice for reasons the type checker
 * could not see: once when the fixture password hash turned out to be a hash of nothing, and once
 * when the login schema demanded a phone number while the accounts people had been given were
 * email addresses.
 */
describe('signing in', () => {
  it('accepts an email address', async () => {
    await makeUser('buyer', { email: 'buyer@example.test' });

    const session = await login({ identifier: 'buyer@example.test', password: FIXTURE_PASSWORD });

    expect(session.auth.user.role).toBe('buyer');
  });

  it('accepts the phone number on the same account', async () => {
    const user = await makeUser('farmer');

    const session = await login({ identifier: user.phone, password: FIXTURE_PASSWORD });

    expect(session.auth.user.id).toBe(String(user._id));
  });

  it('matches an email regardless of the case it was typed in', async () => {
    await makeUser('buyer', { email: 'shouty@example.test' });

    const session = await login({ identifier: 'Shouty@Example.Test', password: FIXTURE_PASSWORD });

    expect(session.auth.user.role).toBe('buyer');
  });

  it('refuses a wrong password', async () => {
    const user = await makeUser('buyer');

    await expect(login({ identifier: user.phone, password: 'not-it' })).rejects.toThrow();
  });

  /**
   * The refusal an unapproved supplier sees.
   *
   * It must be distinguishable from a wrong password — somebody waiting on a reviewer needs to be
   * told that, not left retyping a password that was correct all along.
   */
  it('tells an unapproved supplier that they are waiting, not that they got it wrong', async () => {
    const user = await makeUser('farmer', { accountStatus: 'pending_approval' });

    await expect(
      login({ identifier: user.phone, password: FIXTURE_PASSWORD }),
    ).rejects.toMatchObject({ code: 'account_pending_approval' });
  });

  it('gives a suspended account its reason', async () => {
    const user = await makeUser('buyer', { accountStatus: 'suspended' });
    await User.findByIdAndUpdate(user._id, { suspensionReason: 'chargeback fraud' });

    await expect(
      login({ identifier: user.phone, password: FIXTURE_PASSWORD }),
    ).rejects.toMatchObject({ code: 'account_suspended' });
  });
});

/**
 * The one-click demo login skips `login()` entirely, so every check that lives there has to be
 * repeated or deliberately dropped. The status check is not one that may be dropped: the seed
 * leaves a supplier in the review queue on purpose, and that account carries the same role and the
 * same demo flag as the one the button is meant to hand out.
 */
describe('the demo login', () => {
  it('never hands out an account that is still awaiting approval', async () => {
    // The pending one first, deliberately. An unfiltered `findOne` returns whichever the
    // collection offers first, so a test that inserted the approved account first would pass
    // against the broken version and prove nothing.
    await makeUser('farmer', { isDemo: true, accountStatus: 'pending_approval' });
    const approved = await makeUser('farmer', { isDemo: true });

    const session = await demoLogin('farmer');

    expect(session.auth.user.id).toBe(String(approved._id));
  });

  it('says the seed has not been run rather than failing obscurely', async () => {
    await expect(demoLogin('buyer')).rejects.toThrow(/seed/);
  });
});
