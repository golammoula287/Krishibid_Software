import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { MESSAGE_VERSION, buildMessageBundle } from '../config/messages.js';

/**
 * Serves the user-facing message catalogue for a locale.
 *
 * Unauthenticated: it contains no user data, and the client needs it before login in order
 * to report a failed login properly.
 *
 * Cached hard with an ETag. The catalogue changes only when wording changes, and
 * `MESSAGE_VERSION` is part of the ETag, so a copy edit invalidates every client's cache on
 * the next request while normal use costs a 304.
 */
export function getMessages(req: Request, res: Response): void {
  const locale = (req.query.locale === 'en' ? 'en' : 'bn') as 'bn' | 'en';
  const bundle = buildMessageBundle(locale);

  const etag = `W/"msg-${MESSAGE_VERSION}-${locale}-${crypto
    .createHash('sha1')
    .update(JSON.stringify(bundle))
    .digest('hex')
    .slice(0, 12)}"`;

  // 1h fresh, then serve stale for a day while revalidating — on a sleeping free dyno a
  // stale message beats a spinner, and wording is never urgent.
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.setHeader('ETag', etag);

  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.json(bundle);
}
