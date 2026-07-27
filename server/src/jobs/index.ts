import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { Listing } from '../models/Listing.js';
import { Order } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { emitToListing } from '../sockets/index.js';
import { transitionOrder } from '../services/order.service.js';
import { releaseEscrow } from '../services/payment.service.js';

/**
 * Background sweeps.
 *
 * All three are written to be **idempotent and safe to run concurrently**. On a
 * free tier the dyno sleeps and wakes unpredictably, so a job may fire late, twice,
 * or from two instances at once. Every update is therefore filtered on the state it
 * expects to change, so a duplicate run matches nothing.
 */

/** Closes auctions whose deadline has passed. */
export async function closeExpiredListings(): Promise<number> {
  const now = new Date();

  const expiring = await Listing.find({ status: 'open', bidClosesAt: { $lte: now } })
    .select('_id')
    .limit(200)
    .lean();

  if (expiring.length === 0) return 0;

  let closed = 0;
  for (const { _id } of expiring) {
    // Filtered on `status: 'open'` so a listing sold in the meantime is untouched.
    const updated = await Listing.findOneAndUpdate(
      { _id, status: 'open', bidClosesAt: { $lte: now } },
      { $set: { status: 'expired' }, $inc: { version: 1 } },
    );
    if (updated) {
      closed++;
      emitToListing(String(_id), 'listing:closed', { listingId: String(_id) });
    }
  }

  if (closed > 0) logger.info({ closed }, 'closed expired listings');
  return closed;
}

/**
 * Releases escrow on delivered orders the buyer never confirmed.
 *
 * Without this, a buyer who simply stops responding strands the farmer's money
 * forever — which would make escrow worse for farmers than taking cash.
 * `autoReleaseAt` is nulled when a dispute is raised, so disputed orders are
 * structurally excluded rather than filtered out by hand.
 */
export async function autoReleaseEscrow(): Promise<number> {
  const now = new Date();

  const due = await Payment.find({
    status: 'held',
    autoReleaseAt: { $ne: null, $lte: now },
  })
    .select('orderId')
    .limit(50)
    .lean();

  if (due.length === 0) return 0;

  let released = 0;
  for (const payment of due) {
    try {
      await releaseEscrow(
        String(payment.orderId),
        { userId: null, kind: 'system' },
        `auto-released after ${env().ESCROW_AUTO_RELEASE_DAYS} days without buyer confirmation`,
      );
      released++;
    } catch (err) {
      // One bad order must not stall the sweep for everyone else.
      logger.error({ err, orderId: String(payment.orderId) }, 'auto-release failed');
    }
  }

  if (released > 0) logger.info({ released }, 'auto-released escrow payments');
  return released;
}

/**
 * Cancels orders the buyer never paid for, and relists the lot.
 *
 * The listing is marked `sold` at accept time, so without this an unpaid order
 * would permanently retire a lot that was never actually sold.
 */
export async function cancelUnpaidOrders(): Promise<number> {
  const now = new Date();

  const stale = await Order.find({
    status: 'awaiting_payment',
    paymentDeadline: { $lte: now },
  })
    .select('_id')
    .limit(100)
    .lean();

  if (stale.length === 0) return 0;

  let cancelled = 0;
  for (const { _id } of stale) {
    try {
      // transitionOrder also flips the listing back out of `sold`.
      await transitionOrder(String(_id), 'cancelled', null, 'payment window expired without payment');
      cancelled++;
    } catch (err) {
      logger.error({ err, orderId: String(_id) }, 'unpaid-order cancellation failed');
    }
  }

  if (cancelled > 0) logger.info({ cancelled }, 'cancelled unpaid orders');
  return cancelled;
}

const INTERVALS = {
  // Auctions close on a 30s granularity — tight enough that the UI countdown does
  // not visibly lie, loose enough to be nearly free.
  closeListings: 30_000,
  // Escrow release and unpaid cancellation are day-scale deadlines; five minutes is
  // ample and keeps a sleeping dyno cheap.
  escrow: 5 * 60_000,
} as const;

let timers: NodeJS.Timeout[] = [];

export function startJobs(): void {
  const safely = (name: string, fn: () => Promise<number>) => () => {
    fn().catch((err) => logger.error({ err, job: name }, 'job failed'));
  };

  timers.push(setInterval(safely('closeListings', closeExpiredListings), INTERVALS.closeListings));
  timers.push(setInterval(safely('autoReleaseEscrow', autoReleaseEscrow), INTERVALS.escrow));
  timers.push(setInterval(safely('cancelUnpaidOrders', cancelUnpaidOrders), INTERVALS.escrow));

  // Run once at boot: a sleeping free-tier dyno may have missed hours of deadlines,
  // and users should not wait for the next tick to see reality.
  void closeExpiredListings().catch(() => undefined);
  void autoReleaseEscrow().catch(() => undefined);
  void cancelUnpaidOrders().catch(() => undefined);

  logger.info('background jobs started');
}

export function stopJobs(): void {
  for (const timer of timers) clearInterval(timer);
  timers = [];
}
