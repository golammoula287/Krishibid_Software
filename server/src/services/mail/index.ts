import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { serviceUnavailable } from '../../utils/errors.js';
import { sendViaBrevo } from './brevo.js';
import { sendViaResend } from './resend.js';
import { sendViaSmtp } from './smtp.js';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text. Every template ships text — HTML-only mail lands in spam far more often. */
  text: string;
  html?: string;
}

export interface SendResult {
  delivered: boolean;
  /** Populated when delivery was skipped or failed, for logging and for the dev OTP path. */
  reason?: string;
}

/**
 * Outgoing mail, behind one function.
 *
 * Same shape as `services/ai/` — the transport is a single file and swapping it is one env var, so
 * moving from Resend to Brevo or SMTP later is configuration rather than a refactor.
 *
 * `MAIL_PROVIDER=none` is the default, and that matters: the server must boot, register buyers and
 * approve farmers on a deployment with no mail configured at all, exactly as it already runs
 * without the ONNX model or SSLCOMMERZ credentials.
 */
export async function sendMail(message: MailMessage): Promise<SendResult> {
  const e = env();

  if (e.MAIL_PROVIDER === 'none') {
    // Logged rather than silent, so a missing provider is visible in the logs instead of looking
    // like mail that vanished.
    logger.warn(
      { to: maskEmail(message.to), subject: message.subject },
      'MAIL_PROVIDER=none — email not sent',
    );
    return { delivered: false, reason: 'no mail provider configured' };
  }

  /**
   * Development redirect.
   *
   * Chiefly for Resend, whose free tier only delivers to the address that owns the Resend account
   * until a domain is verified, so mail to anyone else is silently dropped. Redirecting everything
   * to one inbox with the intended recipient in the subject makes that visible instead of looking
   * like a bug — and it means a development run cannot accidentally email a real farmer, which is
   * worth having under SMTP too, where delivery to strangers actually works.
   */
  const redirect = e.MAIL_REDIRECT_TO;
  const outgoing: MailMessage = redirect
    ? {
        ...message,
        to: redirect,
        subject: `[→ ${message.to}] ${message.subject}`,
      }
    : message;

  try {
    // One line per transport, and nothing above or below this switch knows which one ran.
    if (e.MAIL_PROVIDER === 'smtp') {
      await sendViaSmtp(outgoing, e.MAIL_FROM);
    } else if (e.MAIL_PROVIDER === 'brevo') {
      await sendViaBrevo(outgoing, e.BREVO_API_KEY, e.MAIL_FROM);
    } else {
      await sendViaResend(outgoing, e.RESEND_API_KEY, e.MAIL_FROM);
    }

    logger.info(
      {
        provider: e.MAIL_PROVIDER,
        to: maskEmail(outgoing.to),
        redirected: Boolean(redirect),
        subject: message.subject,
      },
      'email sent',
    );
    return { delivered: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown mail error';
    logger.error({ err, to: maskEmail(outgoing.to) }, 'email delivery failed');
    return { delivered: false, reason };
  }
}

/**
 * Fire-and-forget notification.
 *
 * For mail that *reports* something which already happened — an approval, a welcome. Delivery
 * failure must never roll back the action: an approved farmer stays approved even if the mail
 * server was unreachable, because the decision is the fact and the email is the courtesy.
 */
export function notify(message: MailMessage): void {
  void sendMail(message).catch((err: unknown) => {
    logger.error({ err }, 'notify() threw — swallowed so it cannot fail the caller');
  });
}

/**
 * Mail that the flow depends on — an OTP code.
 *
 * The opposite policy to `notify`: this throws. A step that reports success while the code was
 * never dispatched leaves someone waiting for an email that is not coming, which is worse than an
 * error they can act on.
 */
export async function sendOrThrow(message: MailMessage): Promise<void> {
  const result = await sendMail(message);
  if (!result.delivered) {
    throw serviceUnavailable(
      'mail_send_failed',
      'could not send the verification email — please try again shortly',
    );
  }
}

/** a***@gmail.com — enough to recognise your own address, not enough to leak someone else's. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

export { renderTemplate } from './templates.js';
