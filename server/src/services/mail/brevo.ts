import type { MailMessage } from './index.js';

const API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Brevo transport, over HTTPS.
 *
 * Exists because SMTP does not work from every host. On Render, a connection to
 * smtp.gmail.com:465 is silently dropped rather than refused — a 41-second timeout instead of an
 * error — which is what a firewall blocking outbound SMTP looks like. Providers block those ports
 * routinely to stop their address space being used for spam, and no amount of correct SMTP code
 * gets through one.
 *
 * This is HTTPS on 443, which is never blocked, so it sidesteps the problem rather than fighting
 * it. And unlike Resend's free tier, Brevo delivers to **any** recipient without first verifying a
 * domain — the property that actually matters here, since every one-time code now travels by
 * email and a farmer whose code is silently dropped simply cannot sign up.
 *
 * 300 messages a day on the free tier, against Resend's 100. A single POST, so no dependency.
 */
export async function sendViaBrevo(
  message: MailMessage,
  apiKey: string,
  from: string,
): Promise<void> {
  if (!apiKey) throw new Error('BREVO_API_KEY is not set');

  /**
   * `MAIL_FROM` is "Name <address>" everywhere else, but Brevo wants the two parts separately.
   * Parsed rather than demanded as two variables, so one sender setting works for every transport.
   */
  const match = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(from);
  const sender = match
    ? { name: match[1] || 'KrishiBid', email: match[2]! }
    : { name: 'KrishiBid', email: from.trim() };

  if (!sender.email) throw new Error('MAIL_FROM has no email address in it');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender,
      to: [{ email: message.to }],
      subject: message.subject,
      textContent: message.text,
      ...(message.html ? { htmlContent: message.html } : {}),
    }),
    // Bounded, so a hanging mail API cannot hold an HTTP handler open — signup waits on this.
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };

    /**
     * 401 here means the key is wrong. 400 with `invalid_parameter` on the sender almost always
     * means the From address is not one Brevo has verified — it will not send as an arbitrary
     * address, which is the one setup step people miss.
     */
    const hint =
      response.status === 401
        ? ' — check BREVO_API_KEY (Brevo → SMTP & API → API keys)'
        : /sender/i.test(body.message ?? '')
          ? ' — the MAIL_FROM address must be added and verified under Brevo → Senders'
          : '';

    throw new Error(`brevo ${response.status}: ${body.message ?? 'send failed'}${hint}`);
  }
}
