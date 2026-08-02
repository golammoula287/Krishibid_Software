import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import type { MailMessage } from './index.js';

/**
 * SMTP transport, for Gmail and anything else that speaks SMTP.
 *
 * Chosen over Resend for this deployment for one decisive reason: **Resend's free tier will not
 * deliver to any address except the one owning the Resend account until a domain is verified.**
 * Since every one-time code now travels by email, that is not a cosmetic limit — it means only the
 * project owner can finish signing up, and every real farmer waits for a code that was silently
 * dropped. Gmail SMTP delivers to anybody, today, with no domain.
 *
 * What it costs, stated plainly:
 *
 *  - It needs a Google **App Password**, not the account password. Google disabled plain-password
 *    SMTP, so the account must have 2FA on and a 16-character app password generated for it.
 *  - Deliverability from a personal Gmail is worse than from a verified domain. Bulk sending will
 *    land in spam, and Google actively discourages this for application mail.
 *  - The free ceiling is roughly 500 messages a day. That is ample here and would not survive
 *    real growth.
 *
 * So this is the right call for a project that needs codes to actually arrive now, and the wrong
 * one at scale. Both adapters stay: switching back is one environment variable, which is the whole
 * point of the mail layer being one function.
 */
let transporter: Transporter | null = null;

/**
 * One pooled transporter, not one per message.
 *
 * Each `createTransport` opens a fresh TLS handshake to Gmail; doing that per email would put a
 * multi-second connection setup inside the signup request, which is already the slowest thing a
 * new user does.
 */
function getTransporter(): Transporter {
  if (transporter) return transporter;

  const e = env();

  transporter = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Derived rather than configured, because
    // getting the pair inconsistent fails with a TLS error that names neither setting.
    secure: e.SMTP_PORT === 465,
    auth: { user: e.SMTP_USER, pass: e.SMTP_PASS },
    pool: true,
    maxConnections: 2,
    // Bounded, so an unreachable mail server cannot hold an HTTP handler open — signup waits on
    // this call.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  logger.info({ host: e.SMTP_HOST, port: e.SMTP_PORT }, 'smtp transport ready');
  return transporter;
}

/**
 * Sends one message. Throws on failure — the caller decides whether that matters: `notify()`
 * swallows it, `sendOrThrow()` propagates it for codes the flow depends on.
 */
export async function sendViaSmtp(message: MailMessage, from: string): Promise<void> {
  const e = env();
  if (!e.SMTP_USER || !e.SMTP_PASS) {
    throw new Error('SMTP_USER and SMTP_PASS are required for MAIL_PROVIDER=smtp');
  }

  try {
    await getTransporter().sendMail({
      /**
       * Gmail rewrites a From that is not the authenticated account, and rejects it outright on
       * some configurations. Falling back to the SMTP user keeps a misconfigured MAIL_FROM from
       * silently breaking every send.
       */
      from: from || e.SMTP_USER,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);

    /**
     * By far the most common failure, and the one whose raw message explains nothing: Gmail
     * refuses the account password and says only "Username and Password not accepted".
     */
    const hint = /invalid login|username and password not accepted|badcredentials/i.test(reason)
      ? ' — Gmail needs a 16-character App Password (with 2-Step Verification enabled on the ' +
        'account), not your normal password: https://myaccount.google.com/apppasswords'
      : '';

    throw new Error(`smtp: ${reason}${hint}`);
  }
}

/** Test-only: forces a new transport after the environment changes. */
export function resetTransporter(): void {
  transporter?.close();
  transporter = null;
}
