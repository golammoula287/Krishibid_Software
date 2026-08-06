import type { NextFunction, Request, Response } from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../config/env.js';
import { requireActiveAccount, requireActiveOrRejected } from '../middleware/gate.js';
import { FIXTURE_PASSWORD, User, makeUser } from '../test/factories.js';
import type { AppError } from '../utils/errors.js';

/**
 * The transport itself is mocked — one layer below `sendMail`.
 *
 * That is deliberately deeper than the other suite: these tests are about what happens when
 * delivery *fails*, and the only honest way to test that is to let the real adapter, redirect
 * and error handling run with a transport that throws.
 */
const { sendViaResend } = vi.hoisted(() => ({ sendViaResend: vi.fn(async () => undefined) }));

vi.mock('./mail/resend.js', () => ({ sendViaResend }));

import { login } from './auth.service.js';
import { decide } from './kyc.service.js';
import { sendMail } from './mail/index.js';

/** Notifications are fire-and-forget, so the queued send lands a microtask later. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Makes a farmer who has applied and is waiting, exactly as signup leaves them.
 *
 * Built directly rather than through the signup flow: what is under test is the decision, and
 * driving four HTTP-shaped steps to reach the same row would only add ways for the test to fail
 * for unrelated reasons.
 */
async function pendingFarmer(options: { emailVerified?: boolean } = {}) {
  const farmer = await makeUser('farmer', {
    email: `applicant-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    emailVerified: options.emailVerified ?? true,
    accountStatus: 'pending_approval',
  });

  await User.updateOne(
    { _id: farmer._id },
    {
      $set: {
        'kyc.status': 'pending_review',
        'kyc.submittedAt': new Date(),
        'kyc.fullNameOnNid': 'Karim Mia',
      },
    },
  );

  return farmer;
}

/** Runs a gate middleware and reports what it passed to `next`. */
async function runGate(
  middleware: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  userId: string,
): Promise<AppError | undefined> {
  let passed: unknown;
  await middleware(
    { user: { id: userId } } as unknown as Request,
    {} as Response,
    ((err?: unknown) => {
      passed = err;
    }) as NextFunction,
  );
  return passed as AppError | undefined;
}

beforeAll(() => {
  // A configured provider, so the real adapter runs against the mocked transport.
  process.env.MAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 'test-key';
  process.env.MAIL_FROM = 'KrishiBid <test@example.test>';
  resetEnvCache();
});

afterEach(() => {
  sendViaResend.mockClear();
  sendViaResend.mockImplementation(async () => undefined);
  delete process.env.MAIL_REDIRECT_TO;
  resetEnvCache();
});

afterAll(() => {
  delete process.env.MAIL_PROVIDER;
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
  resetEnvCache();
});

describe('admin approval opens the account', () => {
  it('sets the account active and lets the farmer log in', async () => {
    const admin = await makeUser('admin');
    const farmer = await pendingFarmer();

    const application = await decide(String(admin._id), String(farmer._id), 'approve');

    expect(application.status).toBe('approved');
    const updated = await User.findById(farmer._id).lean();
    // Without this the application would be approved while its owner stayed locked out — the
    // review queue is the only thing between a farmer and a working account.
    expect(updated?.accountStatus).toBe('active');

    const session = await login({ identifier: farmer.phone, password: FIXTURE_PASSWORD });
    expect(session.auth.user.id).toBe(String(farmer._id));

    await settle();
    expect(sendViaResend).toHaveBeenCalledTimes(1);
  });

  it('lets an approved farmer past the listing gate', async () => {
    const admin = await makeUser('admin');
    const farmer = await pendingFarmer();
    await decide(String(admin._id), String(farmer._id), 'approve');

    const { requireApprovedFarmer } = await import('../middleware/gate.js');
    expect(await runGate(requireApprovedFarmer, String(farmer._id))).toBeUndefined();
  });
});

describe('admin rejection leaves a way back', () => {
  it('allows login but refuses everything except resubmitting', async () => {
    const admin = await makeUser('admin');
    const farmer = await pendingFarmer();

    await decide(String(admin._id), String(farmer._id), 'reject', 'the NID photo is not legible');

    const updated = await User.findById(farmer._id).lean();
    expect(updated?.accountStatus).toBe('rejected');

    /**
     * Login is allowed on purpose.
     *
     * Refusing it would leave someone who cannot fix what the reviewer flagged and cannot
     * re-register — their phone and email are taken — permanently locked out by our own rules.
     */
    const session = await login({ identifier: farmer.phone, password: FIXTURE_PASSWORD });
    expect(session.auth.user.id).toBe(String(farmer._id));

    // The session can do exactly one thing.
    const blocked = await runGate(requireActiveAccount, String(farmer._id));
    expect(blocked?.code).toBe('account_rejected');
    expect(blocked?.status).toBe(403);

    expect(await runGate(requireActiveOrRejected, String(farmer._id))).toBeUndefined();
  });

  it('still refuses a farmer who is waiting for a first decision', async () => {
    const farmer = await pendingFarmer();

    // A token minted moments before the status changed must not outlive it.
    const blocked = await runGate(requireActiveAccount, String(farmer._id));
    expect(blocked?.code).toBe('account_pending_approval');
  });
});

describe('notifications', () => {
  it('never fails the action it reports', async () => {
    sendViaResend.mockImplementation(async () => {
      throw new Error('mail server unreachable');
    });

    const admin = await makeUser('admin');
    const farmer = await pendingFarmer();

    // An approval that succeeded must not be rolled back because a mail server was down: the
    // decision is the fact, the email is the courtesy.
    await expect(
      decide(String(admin._id), String(farmer._id), 'approve'),
    ).resolves.toMatchObject({ status: 'approved' });

    await settle();
    expect((await User.findById(farmer._id).lean())?.accountStatus).toBe('active');
  });

  it('sends nothing actionable to an unverified address', async () => {
    const admin = await makeUser('admin');
    const farmer = await pendingFarmer({ emailVerified: false });

    await decide(String(admin._id), String(farmer._id), 'approve');
    await settle();

    // An unverified address belongs to whoever typed it, which may not be the applicant.
    expect(sendViaResend).not.toHaveBeenCalled();
  });

  it('routes every message to MAIL_REDIRECT_TO with the real recipient in the subject', async () => {
    process.env.MAIL_REDIRECT_TO = 'me@example.test';
    resetEnvCache();

    await sendMail({
      to: 'farmer@example.test',
      subject: 'Your account is approved',
      text: 'body',
    });

    // A development run must not be able to email a real farmer, and nothing may be dropped
    // silently — the intended recipient travels in the subject so it is visible.
    const [message] = sendViaResend.mock.calls[0] as unknown as [
      { to: string; subject: string },
    ];
    expect(message.to).toBe('me@example.test');
    expect(message.subject).toBe('[→ farmer@example.test] Your account is approved');
  });
});
