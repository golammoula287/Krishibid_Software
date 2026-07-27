import type { BalanceDto, LedgerAccount, LedgerEntryType } from '@krishibid/shared';
import mongoose, { type ClientSession } from 'mongoose';
import { internal } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { LedgerEntry } from '../models/LedgerEntry.js';

export interface PostingLeg {
  account: LedgerAccount;
  /** Signed: negative debits, positive credits. */
  amountPoisha: number;
  userId?: string | null;
  memo: string;
}

export interface PostTransactionInput {
  type: LedgerEntryType;
  paymentId: string;
  orderId: string;
  legs: PostingLeg[];
  session?: ClientSession;
}

/**
 * Posts one balanced transaction.
 *
 * The balance assertion is the core invariant of the payment system: if the legs
 * do not sum to exactly zero we refuse to write anything. A ledger that can be
 * left unbalanced cannot be reconciled against the gateway's settlement report,
 * which makes it worthless at exactly the moment it matters — a dispute.
 */
export async function postTransaction({
  type,
  paymentId,
  orderId,
  legs,
  session,
}: PostTransactionInput): Promise<string> {
  if (legs.length < 2) {
    throw internal(`ledger transaction needs >= 2 legs, got ${legs.length}`);
  }

  const sum = legs.reduce((acc, leg) => acc + leg.amountPoisha, 0);
  if (sum !== 0) {
    throw internal(`unbalanced ledger transaction (${type}): legs sum to ${sum}, expected 0`);
  }

  if (legs.some((leg) => !Number.isInteger(leg.amountPoisha))) {
    throw internal('ledger amounts must be integer poisha');
  }
  if (legs.some((leg) => leg.amountPoisha === 0)) {
    throw internal('ledger legs must be non-zero');
  }

  const transactionId = new mongoose.Types.ObjectId().toString();

  const docs = legs.map((leg) => ({
    transactionId,
    type,
    account: leg.account,
    amountPoisha: leg.amountPoisha,
    userId: leg.userId ? new mongoose.Types.ObjectId(leg.userId) : null,
    paymentId: new mongoose.Types.ObjectId(paymentId),
    orderId: new mongoose.Types.ObjectId(orderId),
    memo: leg.memo,
  }));

  await LedgerEntry.insertMany(docs, { session, ordered: true });

  logger.info({ transactionId, type, paymentId, legs: legs.length }, 'ledger transaction posted');
  return transactionId;
}

/**
 * Derives a user's balances by aggregating entries.
 *
 * Never reads a stored balance — there isn't one. A single aggregation over an
 * indexed {userId, account} is cheap and cannot drift out of agreement with the
 * entries it summarises.
 */
export async function getBalance(userId: string): Promise<BalanceDto> {
  const rows = await LedgerEntry.aggregate<{ _id: LedgerAccount; total: number }>([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $group: { _id: '$account', total: { $sum: '$amountPoisha' } } },
  ]);

  const byAccount = new Map(rows.map((r) => [r._id, r.total]));
  const escrow = byAccount.get('farmer_escrow') ?? 0;
  const available = byAccount.get('farmer_available') ?? 0;
  const paidOut = byAccount.get('farmer_paid_out') ?? 0;

  return {
    escrowPoisha: escrow,
    availablePoisha: available,
    paidOutPoisha: paidOut,
    lifetimeEarnedPoisha: available + paidOut,
  };
}

export async function getStatement(userId: string, limit = 50) {
  return LedgerEntry.find({ userId: new mongoose.Types.ObjectId(userId) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Whole-ledger integrity check: every transaction must sum to zero.
 *
 * Surfaced on /api/payments/ledger/audit and in /metrics. If this ever returns
 * rows, something wrote entries outside `postTransaction` and the books cannot be
 * trusted until it is explained.
 */
export async function auditLedger(): Promise<{ transactionId: string; imbalance: number }[]> {
  return LedgerEntry.aggregate<{ transactionId: string; imbalance: number }>([
    { $group: { _id: '$transactionId', imbalance: { $sum: '$amountPoisha' } } },
    { $match: { imbalance: { $ne: 0 } } },
    { $project: { _id: 0, transactionId: '$_id', imbalance: 1 } },
  ]);
}
