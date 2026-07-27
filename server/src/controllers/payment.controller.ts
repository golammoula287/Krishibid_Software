import { sslczIpnSchema } from '@krishibid/shared';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import * as ledger from '../services/ledger.service.js';
import * as payments from '../services/payment.service.js';

// ---- buyer-driven ---------------------------------------------------------

export async function initiate(req: Request, res: Response): Promise<void> {
  res.json(await payments.initiatePayment(req.user!.id, req.body.orderId));
}

export async function confirmDelivery(req: Request, res: Response): Promise<void> {
  res.json(
    await payments.releaseEscrow(
      req.body.orderId,
      { userId: req.user!.id, kind: 'buyer' },
      req.body.note,
    ),
  );
}

export async function dispute(req: Request, res: Response): Promise<void> {
  await payments.raiseDispute(req.user!.id, req.body.orderId, req.body.reason);
  res.status(202).json({ status: 'disputed' });
}

// ---- gateway callbacks ----------------------------------------------------

/**
 * IPN — the authoritative payment notification.
 *
 * Unauthenticated by necessity: SSLCOMMERZ's servers call it, not our users. All
 * trust is established inside `handleIpn` (signature check, then a
 * server-to-server re-validation, then an amount comparison).
 *
 * Always returns 200. A non-2xx makes SSLCOMMERZ retry, and for a permanently bad
 * callback (unknown tran_id, forged signature) retrying forever helps nobody. The
 * outcome goes in the response body and the logs instead.
 */
export async function ipn(req: Request, res: Response): Promise<void> {
  const parsed = sslczIpnSchema.safeParse(req.body);

  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'malformed IPN payload');
    res.status(200).json({ received: true, handled: false, reason: 'malformed' });
    return;
  }

  try {
    const outcome = await payments.handleIpn(parsed.data);
    res.status(200).json({ received: true, ...outcome });
  } catch (err) {
    // Swallow and 200: an exception here is our bug, and letting the gateway retry
    // into the same bug adds load without changing the outcome. The payment stays
    // `pending` and is visible in the admin view.
    logger.error({ err, tranId: parsed.data.tran_id }, 'IPN handler threw');
    res.status(200).json({ received: true, handled: false, reason: 'internal_error' });
  }
}

/**
 * Browser redirect targets — **advisory only**.
 *
 * A buyer can navigate to /success directly, so nothing here writes payment state.
 * They simply bounce the user back into the PWA, which then polls the real status.
 */
function redirectToApp(res: Response, outcome: string, tranId?: string): void {
  const url = new URL('/payment/return', env().WEB_PUBLIC_URL);
  url.searchParams.set('outcome', outcome);
  if (tranId) url.searchParams.set('tran', tranId);
  res.redirect(302, url.toString());
}

export function callbackSuccess(req: Request, res: Response): void {
  redirectToApp(res, 'success', (req.body as { tran_id?: string })?.tran_id);
}
export function callbackFail(req: Request, res: Response): void {
  redirectToApp(res, 'fail', (req.body as { tran_id?: string })?.tran_id);
}
export function callbackCancel(req: Request, res: Response): void {
  redirectToApp(res, 'cancel', (req.body as { tran_id?: string })?.tran_id);
}
export function callbackGet(req: Request, res: Response): void {
  redirectToApp(res, String(req.params.outcome ?? 'unknown'));
}

// ---- status & ledger ------------------------------------------------------

export async function forOrder(req: Request, res: Response): Promise<void> {
  res.json(await payments.getPaymentForOrder(String(req.params.orderId), req.user!.id));
}

export async function balance(req: Request, res: Response): Promise<void> {
  res.json(await ledger.getBalance(req.user!.id));
}

export async function statement(req: Request, res: Response): Promise<void> {
  res.json(await ledger.getStatement(req.user!.id));
}

// ---- admin ---------------------------------------------------------------

export async function resolveDispute(req: Request, res: Response): Promise<void> {
  res.json(
    await payments.resolveDispute(
      req.user!.id,
      req.body.orderId,
      req.body.resolution,
      req.body.adminNote,
    ),
  );
}

/**
 * Ledger integrity audit. Returns any transaction whose legs don't sum to zero.
 * An empty array is the only healthy answer, so a non-empty one is a 500.
 */
export async function auditLedger(_req: Request, res: Response): Promise<void> {
  const imbalances = await ledger.auditLedger();
  res.status(imbalances.length === 0 ? 200 : 500).json({
    balanced: imbalances.length === 0,
    imbalances,
  });
}
