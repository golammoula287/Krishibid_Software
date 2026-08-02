import type { MailMessage } from './index.js';

const API_URL = 'https://api.resend.com/emails';

interface ResendError {
  message?: string;
  name?: string;
}

/**
 * Resend transport.
 *
 * A single authenticated POST, so this uses `fetch` and adds **no dependency**. The official SDK
 * wraps the same call; on a 512 MB free dyno a package that saves four lines is not worth its
 * install weight.
 *
 * Throws on failure. The caller decides whether that matters — `notify()` swallows it, and
 * `sendOrThrow()` propagates it for codes the flow depends on.
 */
export async function sendViaResend(
  message: MailMessage,
  apiKey: string,
  from: string,
): Promise<void> {
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    }),
    // Bounded, so a hanging mail API cannot hold an HTTP handler open — signup waits on this.
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string } & ResendError;
    /**
     * 403 here almost always means the same thing: the free tier refuses to deliver to any address
     * other than the one owning the Resend account until a domain is verified. Saying so beats
     * surfacing a bare status code, because the fix is not obvious from the number.
     */
    const hint =
      response.status === 403
        ? ' — on the free tier Resend only delivers to the account owner’s address until you verify a domain; set MAIL_REDIRECT_TO in development'
        : '';
    throw new Error(`resend ${response.status}: ${body.message ?? 'send failed'}${hint}`);
  }
}
