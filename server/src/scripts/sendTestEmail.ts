/**
 * Sends one real email through the configured provider, to prove the setup works.
 *
 *   npm run mail:test                      # to ADMIN_NOTIFY_EMAIL
 *   npm run mail:test -- you@example.com   # to a specific address
 *   npm run mail:test -- you@example.com otp_signup
 *
 * Uses the same `sendMail` the application does — same adapter, same redirect rule, same error
 * handling — so a pass here means signup mail will work, not merely that the key is syntactically
 * valid. Touches no database and creates no account.
 *
 * The failure this exists to catch: with MAIL_PROVIDER unset the server logs codes instead of
 * sending them, and in production it does not return the dev code either (handing a live
 * credential to whoever called the endpoint would be worse). Signup then fails silently — the
 * user simply waits for an email that was never dispatched. This says so in one command.
 */
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { maskEmail } from '../utils/mask.js';
import { sendMail } from '../services/mail/index.js';
import { renderTemplate, type TemplateName } from '../services/mail/templates.js';

const TEMPLATES: TemplateName[] = [
  'otp_signup',
  'otp_reset',
  'otp_status',
  'welcome_buyer',
  'application_received',
  'admin_new_application',
  'kyc_approved',
  'kyc_rejected',
];

async function main(): Promise<void> {
  const e = env();

  const to = process.argv[2] ?? e.ADMIN_NOTIFY_EMAIL;
  const template = (process.argv[3] ?? 'otp_signup') as TemplateName;

  if (!to) {
    throw new Error(
      'no recipient — pass one as an argument, or set ADMIN_NOTIFY_EMAIL in .env',
    );
  }
  if (!TEMPLATES.includes(template)) {
    throw new Error(`unknown template "${template}" — one of: ${TEMPLATES.join(', ')}`);
  }

  if (e.MAIL_PROVIDER === 'none') {
    throw new Error(
      'MAIL_PROVIDER=none, so nothing would be sent. Set MAIL_PROVIDER=resend and ' +
        'RESEND_API_KEY in .env first — this script exists to prove real delivery.',
    );
  }

  logger.info(
    {
      provider: e.MAIL_PROVIDER,
      from: e.MAIL_FROM,
      to: maskEmail(to),
      redirectedTo: e.MAIL_REDIRECT_TO ? maskEmail(e.MAIL_REDIRECT_TO) : null,
      template,
    },
    'sending a test email',
  );

  const body = renderTemplate(template, {
    code: '123456',
    minutes: 10,
    name: 'Test User',
    district: 'Rangpur',
    reason: 'This is a test — the NID photo was not legible.',
    bidLimit: 'BDT 25,000',
  });

  const result = await sendMail({ to, ...body });

  if (!result.delivered) {
    /**
     * The most likely reason by far, and the one whose message is least self-explanatory: on the
     * free tier Resend refuses to deliver anywhere except the address that owns the Resend
     * account until a domain is verified.
     */
    logger.error({ reason: result.reason }, 'NOT delivered');
    throw new Error(result.reason ?? 'delivery failed');
  }

  logger.info(
    { subject: body.subject },
    e.MAIL_REDIRECT_TO
      ? 'sent — check the MAIL_REDIRECT_TO inbox; the real recipient is in the subject line'
      : 'sent — check the inbox (and the spam folder)',
  );
}

main().catch((err: unknown) => {
  logger.fatal({ err: err instanceof Error ? err.message : err }, 'test email failed');
  process.exit(1);
});
