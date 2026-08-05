import {
  completeFarmerRegistrationSchema,
  registerSchema,
  startRegistrationSchema,
} from '@krishibid/shared';
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../config/env.js';
import { OtpChallenge } from '../models/OtpChallenge.js';
import { PendingRegistration } from '../models/PendingRegistration.js';
import { User, makeUser } from '../test/factories.js';
import type { AppError } from '../utils/errors.js';

/**
 * Spied on at the `notify` boundary rather than sent.
 *
 * `notify` is where a receipt or a decision leaves the system, so counting calls to it is what
 * "an email was queued" actually means. Sending would need a provider and would make the suite
 * depend on somebody's inbox. `vi.hoisted` because the mock factory runs before the module body.
 */
const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('./mail/index.js', () => ({
  notify,
  sendMail: vi.fn(async () => ({ delivered: true })),
  sendOrThrow: vi.fn(async () => undefined),
  maskEmail: (email: string) => email,
}));

/**
 * Document storage is stubbed, not exercised.
 *
 * Uploading for real needs Cloudinary credentials the suite deliberately does not have — and
 * what is under test is the state machine around the upload (who may upload, when, and what it
 * does to the registration), not Cloudinary's behaviour.
 */
vi.mock('./kyc.service.js', () => ({
  uploadPrivateDocument: vi.fn(async (_buffer: Buffer, folderKey: string, kind: string) => ({
    publicId: `kyc/${folderKey}/${kind}`,
    bytes: 2048,
  })),
  scoreDocuments: vi.fn(async () => null),
}));

import { confirmPasswordReset, login, requestPasswordReset } from './auth.service.js';
import { consumeCode, issueCode } from './otp.service.js';
import {
  checkStatus,
  completeRegistration,
  requestStatusCode,
  startRegistration,
  uploadRegistrationDocument,
  verifyRegistration,
} from './registration.service.js';

/**
 * The code the service hands back when no mail provider is configured.
 *
 * Gated on NODE_ENV rather than on delivery, so this is a development and test affordance only —
 * in production a missing provider yields a user who cannot verify, not a code returned to
 * whoever called the endpoint.
 */
const code = (result: { devCode?: string }): string => {
  expect(result.devCode, 'devCode must be returned outside production').toBeDefined();
  return result.devCode!;
};

/**
 * Clears the resend cooldown between steps.
 *
 * `issueCode` refuses a second code for the same destination inside 60 seconds, which is correct
 * — it stops the endpoint being used to flood an inbox — but it makes "ask for a code twice"
 * untestable without either waiting a minute or clearing the trail.
 */
const clearOtpCooldown = () => OtpChallenge.deleteMany({});

const startInput = (over: Record<string, unknown> = {}) => ({
  name: 'করিম মিয়া',
  phone: '01712345678',
  email: 'farmer@example.test',
  district: 'Rangpur',
  role: 'farmer',
  password: 'password123',
  locale: 'bn',
  ...over,
});

const farmerDetails = {
  nidNumber: '1234567890',
  fullNameOnNid: 'Karim Mia',
  farmSizeAcres: 2,
  cropsGrown: ['rice'],
};

/** Walks a registration from step 1 to the point where only completion is left. */
async function upToCompletion(over: Record<string, unknown> = {}) {
  const input = startRegistrationSchema.parse(startInput(over));
  const started = await startRegistration(input);
  const verified = await verifyRegistration(input.email, code(started));

  if (input.role === 'farmer') {
    for (const kind of ['nid_front', 'nid_back', 'selfie'] as const) {
      await uploadRegistrationDocument(verified.signupToken, kind, Buffer.from('image'));
    }
  }

  return { input, token: verified.signupToken };
}

beforeEach(() => {
  notify.mockClear();
});

describe('signup — step 1', () => {
  it('creates a pending registration and no user at all', async () => {
    const result = await startRegistration(startRegistrationSchema.parse(startInput()));

    expect(result.resumed).toBe(false);
    expect(await PendingRegistration.countDocuments({})).toBe(1);
    // The account must not exist yet: it is not loginable, not in the review queue, and — most
    // importantly — does not occupy the phone number while the signup is unfinished.
    expect(await User.countDocuments({})).toBe(0);
  });

  it('resumes rather than conflicting when the same address starts again', async () => {
    await startRegistration(startRegistrationSchema.parse(startInput()));
    await clearOtpCooldown();

    const again = await startRegistration(
      startRegistrationSchema.parse(startInput({ name: 'করিম মিয়া' + ' (corrected)' })),
    );

    expect(again.resumed).toBe(true);
    expect(await PendingRegistration.countDocuments({})).toBe(1);

    const pending = await PendingRegistration.findOne({ email: 'farmer@example.test' }).lean();
    expect(pending?.name).toBe('করিম মিয়া (corrected)');
  });

  it('reports a taken phone against the phone field', async () => {
    const other = await makeUser('buyer', { email: 'someone@example.test' });
    await User.updateOne({ _id: other._id }, { $set: { phone: '01712345678' } });

    const error = (await startRegistration(startRegistrationSchema.parse(startInput())).catch(
      (e: unknown) => e,
    )) as AppError;

    expect(error.code).toBe('phone_taken');
    expect(error.details).toEqual({ field: 'phone' });
  });

  it('reports a taken email against the email field, separately', async () => {
    await makeUser('buyer', { email: 'farmer@example.test' });

    const error = (await startRegistration(startRegistrationSchema.parse(startInput())).catch(
      (e: unknown) => e,
    )) as AppError;

    expect(error.code).toBe('email_taken');
    expect(error.details).toEqual({ field: 'email' });
  });

  it('refuses a registration with no email address', () => {
    // Every code and every notification travels by email, so an account without one is an
    // account nobody could verify, recover, or tell anything at all.
    expect(startRegistrationSchema.safeParse({ ...startInput(), email: undefined }).success).toBe(
      false,
    );
  });

  it('gives no registration schema a way to mint an admin', () => {
    // Worth an explicit test rather than an assumption: this is exactly the kind of enum a
    // later refactor widens by accident, and an admin can approve sellers and move escrow.
    for (const schema of [startRegistrationSchema, registerSchema]) {
      expect(schema.safeParse({ ...startInput(), role: 'admin' }).success).toBe(false);
    }
  });
});

describe('signup — the signup token', () => {
  it('refuses a document upload with no token', async () => {
    await expect(
      uploadRegistrationDocument(undefined, 'nid_front', Buffer.from('image')),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a document upload with an expired token', async () => {
    const input = startRegistrationSchema.parse(startInput());
    const started = await startRegistration(input);
    const verified = await verifyRegistration(input.email, code(started));

    // Expiry is part of the lookup, so a run-out token must not even identify a registration.
    await PendingRegistration.updateOne(
      { email: input.email },
      { $set: { signupTokenExpiresAt: new Date(Date.now() - 1000) } },
    );

    await expect(
      uploadRegistrationDocument(verified.signupToken, 'nid_front', Buffer.from('image')),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('tracks which documents are still outstanding', async () => {
    const input = startRegistrationSchema.parse(startInput());
    const started = await startRegistration(input);
    const verified = await verifyRegistration(input.email, code(started));

    expect(verified.state.missingDocuments).toEqual(['nid_front', 'nid_back', 'selfie']);

    const after = await uploadRegistrationDocument(
      verified.signupToken,
      'nid_front',
      Buffer.from('image'),
    );
    expect(after.missingDocuments).toEqual(['nid_back', 'selfie']);
  });
});

describe('signup — buyer completion', () => {
  it('creates an active account with a session when the optional step is skipped', async () => {
    const { input, token } = await upToCompletion({ role: 'buyer', email: 'buyer@example.test' });

    // Skipping must not block account creation — that is the entire point of it being optional.
    const { result, refreshToken } = await completeRegistration(token, {});

    expect(result.status).toBe('active');
    expect(result.next).toBe('app');
    expect(result.accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();

    const user = await User.findOne({ email: input.email }).lean();
    expect(user?.accountStatus).toBe('active');
    expect(user?.emailVerified).toBe(true);
    expect(user?.buyerTier).toBe('basic');

    // The pending row is gone; the account has replaced it.
    expect(await PendingRegistration.countDocuments({})).toBe(0);

    // One welcome email.
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('starts a buyer who filled the business step at the verified tier', async () => {
    const { input, token } = await upToCompletion({ role: 'buyer', email: 'trader@example.test' });

    await completeRegistration(token, { businessName: 'Karim Traders', buyerType: 'trader' });

    const user = await User.findOne({ email: input.email }).lean();
    expect(user?.buyerTier).toBe('verified');
  });

  it('lets a buyer log in immediately afterwards', async () => {
    const { input, token } = await upToCompletion({ role: 'buyer', email: 'login@example.test' });
    await completeRegistration(token, {});

    const session = await login({ phone: input.phone, password: 'password123' });
    expect(session.auth.user.phone).toBe(input.phone);
  });
});

describe('signup — farmer completion', () => {
  it('creates a closed account that cannot be logged into', async () => {
    const { input, token } = await upToCompletion();
    const { result, refreshToken } = await completeRegistration(token, farmerDetails);

    expect(result.status).toBe('pending_approval');
    expect(result.next).toBe('awaiting_approval');
    expect(result.accessToken).toBeUndefined();
    // No session at all: a refresh cookie for a blocked account would keep silently trying to
    // restore a session the server will always refuse.
    expect(refreshToken).toBeUndefined();

    const user = await User.findOne({ email: input.email }).lean();
    expect(user?.accountStatus).toBe('pending_approval');
    expect(user?.kyc?.status).toBe('pending_review');
    expect(user?.kyc?.documents).toHaveLength(3);

    await expect(login({ phone: input.phone, password: 'password123' })).rejects.toMatchObject({
      status: 403,
      code: 'account_pending_approval',
    });
  });

  it('refuses completion while a required document is missing', async () => {
    const input = startRegistrationSchema.parse(startInput({ email: 'partial@example.test' }));
    const started = await startRegistration(input);
    const verified = await verifyRegistration(input.email, code(started));
    await uploadRegistrationDocument(verified.signupToken, 'nid_front', Buffer.from('image'));

    await expect(completeRegistration(verified.signupToken, farmerDetails)).rejects.toMatchObject({
      code: 'documents_missing',
    });
  });

  it('emails the applicant a receipt and the admin a notification', async () => {
    process.env.ADMIN_NOTIFY_EMAIL = 'admin@example.test';
    resetEnvCache();

    try {
      const { token } = await upToCompletion({ email: 'notified@example.test' });
      await completeRegistration(token, farmerDetails);

      // Two, not one. The receipt is the only artefact the farmer keeps; the admin
      // notification is what makes approval happen rather than waiting on somebody thinking
      // to look at a queue.
      expect(notify).toHaveBeenCalledTimes(2);
      const recipients = notify.mock.calls.map(([m]) => (m as { to: string }).to);
      expect(recipients).toContain('notified@example.test');
      expect(recipients).toContain('admin@example.test');
    } finally {
      delete process.env.ADMIN_NOTIFY_EMAIL;
      resetEnvCache();
    }
  });

  it('rejects a 9-digit NID against that field, with copy that says what is wrong', () => {
    const parsed = completeFarmerRegistrationSchema.safeParse({
      ...farmerDetails,
      nidNumber: '123456789',
    });

    expect(parsed.success).toBe(false);
    const issue = parsed.error!.issues[0]!;
    expect(issue.path).toEqual(['nidNumber']);
    expect(issue.message).toBe('NID must be 10, 13 or 17 digits');
  });
});

describe('signup — the concurrent completion race', () => {
  it('creates exactly one user and leaves the loser able to correct it', async () => {
    // Two registrations, different emails, deliberately the same phone number. Neither reserves
    // it, so both arrive at completion believing the number is free.
    const first = await upToCompletion({ email: 'first@example.test' });
    const second = await upToCompletion({ email: 'second@example.test' });

    const results = await Promise.allSettled([
      completeRegistration(first.token, farmerDetails),
      completeRegistration(second.token, farmerDetails),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await User.countDocuments({ phone: '01712345678' })).toBe(1);

    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    const error = rejected.reason as AppError;
    // Told which field collided, not handed a generic conflict...
    expect(error.code).toBe('phone_taken');
    expect(error.details).toEqual({ field: 'phone' });

    // ...and the losing registration survives with its uploads, so the number can be fixed
    // without photographing three documents again.
    const survivor = await PendingRegistration.findOne({}).lean();
    expect(survivor, 'the losing registration must survive').not.toBeNull();
    expect(survivor!.documents).toHaveLength(3);
  });
});

describe('approval status lookup', () => {
  it('answers the same way for a registered and an unregistered address', async () => {
    await makeUser('farmer', { email: 'known@example.test' });

    const known = await requestStatusCode('known@example.test');
    const unknown = await requestStatusCode('nobody@example.test');

    /**
     * Same shape, or the endpoint becomes a way to test which addresses have accounts.
     *
     * `devCode` is excluded from the comparison because it exists only outside production with
     * no mail provider — in production it is never present for either case, so the guard holds
     * where it matters.
     */
    const shape = (r: object) => Object.keys(r).filter((k) => k !== 'devCode');
    expect(known.sent).toBe(true);
    expect(unknown.sent).toBe(true);
    expect(shape(unknown)).toEqual(shape(known));
  });

  it('reports the pending state and issues no session', async () => {
    const { input, token } = await upToCompletion({ email: 'waiting@example.test' });
    await completeRegistration(token, farmerDetails);

    const requested = await requestStatusCode(input.email);
    const status = await checkStatus(input.email, code(requested));

    expect(status.status).toBe('pending_approval');
    expect(status.submittedAt).toBeTruthy();
    // Nothing token-shaped comes back: the account stays genuinely closed until it is approved.
    expect(Object.keys(status)).not.toContain('accessToken');
  });
});

describe('OTP codes are scoped by purpose', () => {
  it('will not let a code obtained for one action perform another', async () => {
    const destination = 'scoped@example.test';
    const reset = await issueCode(destination, 'reset_password');
    const signup = await issueCode(destination, 'signup_verify');

    // Each is invisible to the other purpose, so neither can be replayed across actions.
    await expect(consumeCode(destination, code(reset), 'signup_verify')).rejects.toMatchObject({
      code: 'otp_invalid',
    });
    await expect(consumeCode(destination, code(signup), 'reset_password')).rejects.toMatchObject({
      code: 'otp_invalid',
    });

    // The correct pairing still works.
    await expect(consumeCode(destination, code(signup), 'signup_verify')).resolves.toBeTruthy();
  });

  it('will not reset a password with a signup code', async () => {
    await makeUser('buyer', { email: 'dual@example.test' });
    const started = await startRegistration(
      startRegistrationSchema.parse(startInput({ email: 'other@example.test' })),
    );

    await expect(
      confirmPasswordReset('dual@example.test', code(started), 'newpassword123'),
    ).rejects.toMatchObject({ code: 'otp_expired' });
  });
});

describe('when the deployment does not require a verified email', () => {
  /**
   * The configuration the app actually ships with today.
   *
   * Free transactional email to arbitrary recipients turns out to need an owned domain, so
   * verification is paused and accounts are approved by hand instead. What must not happen is
   * signup asking for a code that was never sent — a dead end with no way past it.
   */
  const withVerificationOff = async (run: () => Promise<void>): Promise<void> => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
    resetEnvCache();
    try {
      await run();
    } finally {
      process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
      resetEnvCache();
    }
  };

  it('issues the signup token immediately and sends no code', async () => {
    await withVerificationOff(async () => {
      const result = await startRegistration(
        startRegistrationSchema.parse(startInput({ role: 'buyer', email: 'skip@example.test' })),
      );

      expect(result.verificationRequired).toBe(false);
      expect(result.signupToken).toBeTruthy();
      // Not merely unsent — never issued. Issuing one would fail loudly on a deployment with no
      // working mail and take the whole registration down with it.
      expect(await OtpChallenge.countDocuments({ purpose: 'signup_verify' })).toBe(0);
      expect(result.devCode).toBeUndefined();
    });
  });

  it('completes registration straight from that token', async () => {
    await withVerificationOff(async () => {
      const started = await startRegistration(
        startRegistrationSchema.parse(startInput({ role: 'buyer', email: 'skip2@example.test' })),
      );

      const { result } = await completeRegistration(started.signupToken, {});
      expect(result.status).toBe('active');

      const user = await User.findOne({ email: 'skip2@example.test' }).lean();
      // False, and honestly so: nobody proved this address. The account page says "not
      // verified", which is the truth rather than a badge on an unchecked value.
      expect(user?.emailVerified).toBe(false);
    });
  });

  it('still lets an approved farmer list produce, despite the unverified address', async () => {
    await withVerificationOff(async () => {
      const farmer = await makeUser('farmer', {
        email: 'unverified-farmer@example.test',
        emailVerified: false,
      });
      await User.updateOne({ _id: farmer._id }, { $set: { 'kyc.status': 'approved' } });

      const { requireApprovedFarmer } = await import('../middleware/gate.js');
      let passed: unknown = 'not called';
      await requireApprovedFarmer(
        { user: { id: String(farmer._id) } } as never,
        {} as never,
        ((err?: unknown) => {
          passed = err;
        }) as never,
      );

      // Gating on a check the deployment does not perform would leave an admin-approved farmer
      // with an account that refuses to work and no explanation on screen.
      expect(passed).toBeUndefined();
    });
  });
});

describe('mail disabled in production', () => {
  /**
   * The failure this pins down was found on the deployed site: a signup reported success and
   * delivered nothing, because the mail credentials were missing from the deployment. Telling
   * somebody a code is on its way and dispatching nothing is the worst available outcome — they
   * wait indefinitely with nothing to act on. An error they can see is strictly better.
   */
  it('refuses to report a code as sent when it reaches nobody', async () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      apiUrl: process.env.API_PUBLIC_URL,
    };

    process.env.NODE_ENV = 'production';
    // Production additionally demands https here, and that check is not what is under test.
    process.env.API_PUBLIC_URL = 'https://api.example.test';
    resetEnvCache();

    try {
      await expect(
        startRegistration(startRegistrationSchema.parse(startInput())),
      ).rejects.toMatchObject({ code: 'mail_send_failed', status: 503 });

      // And nothing is left claiming to be in flight.
      expect(await OtpChallenge.countDocuments({ purpose: 'signup_verify' })).toBe(0);
    } finally {
      process.env.NODE_ENV = previous.nodeEnv;
      if (previous.apiUrl === undefined) delete process.env.API_PUBLIC_URL;
      else process.env.API_PUBLIC_URL = previous.apiUrl;
      resetEnvCache();
    }
  });
});

describe('password reset', () => {
  it('sets the new password and kills every existing session', async () => {
    const user = await makeUser('buyer', { email: 'reset@example.test' });
    const before = user.tokenVersion ?? 0;

    const requested = await requestPasswordReset('reset@example.test');
    await confirmPasswordReset('reset@example.test', code(requested), 'brand-new-password');

    const after = await User.findById(user._id).select('+passwordHash +refreshTokenHash');
    // A reset is what someone does AFTER losing control of an account, so leaving the
    // attacker's session alive would defeat the point of it.
    expect(after!.tokenVersion).toBe(before + 1);
    expect(after!.refreshTokenHash).toBeNull();
    expect(await bcrypt.compare('brand-new-password', after!.passwordHash)).toBe(true);
  });

  it('says nothing about whether an address is registered', async () => {
    const result = await requestPasswordReset('stranger@example.test');

    expect(result.sent).toBe(true);
    // No code is issued for an address with no account, and the caller cannot tell.
    expect(await OtpChallenge.countDocuments({ purpose: 'reset_password' })).toBe(0);
  });
});
