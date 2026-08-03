import nodemailer, { type Transporter } from 'nodemailer';
import dns from 'node:dns/promises';
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
let transporter: Promise<Transporter> | null = null;

/**
 * Pins the connection to IPv4.
 *
 * Render's containers have an IPv6 interface but no IPv6 route to the internet. Nodemailer
 * resolves the hostname itself and hands the literal address to `tls.connect`, so when it picked
 * Gmail's AAAA record every send died with:
 *
 *   smtp: connect ENETUNREACH 2404:6800:4003:c01::6c:465
 *
 * Resolving the A record here removes the choice. The hostname is kept as `tls.servername` so the
 * certificate is still validated against `smtp.gmail.com` and not against an IP — connecting to a
 * literal address without that would either fail the handshake or, worse, invite someone to turn
 * off certificate checking to make it work.
 *
 * If a host has no A record (IPv6-only), this falls back to the hostname and lets nodemailer
 * resolve as before, which is the right behaviour for a network where IPv6 is the working path.
 */
async function resolveIpv4(host: string): Promise<string | null> {
  try {
    const [address] = await dns.resolve4(host);
    return address ?? null;
  } catch {
    return null;
  }
}

/**
 * The ports worth trying, configured one first.
 *
 * Gmail listens on exactly two: 465 (implicit TLS) and 587 (STARTTLS). Hosts that block outbound
 * SMTP do not always block both — 465 is the more commonly filtered of the pair — so trying the
 * other before giving up is the difference between "this host cannot send mail" and "this host
 * needed the other port". Guessing which one a platform allows is not something to leave to a
 * human reading a timeout.
 */
function candidatePorts(configured: number): number[] {
  return [configured, ...[465, 587].filter((port) => port !== configured)];
}

function buildTransport(host: string, port: number, servername: string): Transporter {
  const e = env();

  return nodemailer.createTransport({
    host,
    port,
    // Derived rather than configured, because getting the pair inconsistent fails with a TLS
    // error that names neither setting.
    secure: port === 465,
    // The certificate is checked against the real hostname even when connecting to an IP.
    tls: { servername },
    auth: { user: e.SMTP_USER, pass: e.SMTP_PASS },
    pool: true,
    maxConnections: 2,
    /**
     * Tighter than a single-port setup would need, because a blocked port fails by silence: the
     * packets are dropped and nothing answers until the timeout. With two ports to try, a
     * generous timeout on the first turns a working configuration into a request that takes most
     * of a minute before it succeeds on the second.
     */
    connectionTimeout: 8_000,
    greetingTimeout: 6_000,
    socketTimeout: 20_000,
  });
}

/**
 * One pooled transporter, not one per message.
 *
 * Each `createTransport` opens a fresh TLS handshake to Gmail; doing that per email would put a
 * multi-second connection setup inside the signup request, which is already the slowest thing a
 * new user does. Cached as the promise, so concurrent first sends share one setup instead of
 * racing to build two.
 *
 * `verify()` is what makes the port fallback real: it opens the connection and authenticates, so
 * a blocked port or a bad App Password is discovered here rather than on the first message.
 */
function getTransporter(): Promise<Transporter> {
  transporter ??= (async () => {
    const e = env();
    const ipv4 = await resolveIpv4(e.SMTP_HOST);
    const host = ipv4 ?? e.SMTP_HOST;
    const failures: string[] = [];

    for (const port of candidatePorts(e.SMTP_PORT)) {
      const candidate = buildTransport(host, port, e.SMTP_HOST);

      try {
        await candidate.verify();
        logger.info(
          { host: e.SMTP_HOST, port, ipv4: ipv4 ?? 'unresolved — using hostname' },
          'smtp transport ready',
        );
        return candidate;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failures.push(`${port}: ${reason}`);
        candidate.close();

        /**
         * A rejected login is not a reason to try another port.
         *
         * The credentials are wrong on every port, and retrying would bury the one error that
         * actually tells the operator what to fix under a second, misleading timeout.
         */
        if (/invalid login|username and password not accepted|badcredentials/i.test(reason)) break;

        logger.warn({ port, reason }, 'smtp port unusable — trying the next one');
      }
    }

    // Cleared so the next send retries rather than being stuck with a rejected promise forever —
    // a blocked port can be unblocked, and a password can be corrected, without a restart.
    transporter = null;
    throw new Error(`no usable SMTP port — ${failures.join(' | ')}`);
  })();

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
    const transport = await getTransporter();
    await transport.sendMail({
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
      : /ENETUNREACH|EHOSTUNREACH/i.test(reason)
        ? ' — the host has no route to that address family; the transport pins IPv4, so if this ' +
          'persists the platform is likely blocking outbound SMTP (try SMTP_PORT=587)'
        : /ETIMEDOUT|ECONNREFUSED/i.test(reason)
          ? ` — nothing answered on port ${e.SMTP_PORT}; many hosts block outbound SMTP, try 587`
          : '';

    throw new Error(`smtp: ${reason}${hint}`);
  }
}

/**
 * Opens and authenticates a connection, without sending anything.
 *
 * Called at boot so a host that blocks outbound SMTP is identified in the startup log rather
 * than by a farmer whose code never arrived. This is the difference between evaluating a new
 * host in thirty seconds and evaluating it by attempting a signup and inferring from a timeout.
 */
export async function verifySmtp(): Promise<void> {
  await getTransporter();
}

/** Test-only: forces a new transport after the environment changes. */
export function resetTransporter(): void {
  void transporter?.then((t) => t.close()).catch(() => undefined);
  transporter = null;
}
