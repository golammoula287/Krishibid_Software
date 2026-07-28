import { beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../config/env.js';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { Order } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { makeOrder, makeUser } from '../test/factories.js';
import { getBalance } from './ledger.service.js';
import { completeMockPayment, initiatePayment } from './payment.service.js';

/**
 * The mock gateway exists so the escrow flow can be demonstrated without SSLCOMMERZ
 * credentials. These tests hold it to the standard that makes it worth having: it must
 * drive the *same* ledger and order transitions as a real capture, and it must be
 * impossible to reach when the server is configured for a real gateway.
 */
async function scaffold() {
  const farmer = await makeUser('farmer');
  const buyer = await makeUser('buyer');
  const order = await makeOrder({
    listingId: farmer._id,
    farmerId: farmer._id,
    buyerId: buyer._id,
    agreedAmountPoisha: 150_000,
  });
  return { farmer, buyer, order };
}

describe('mock payments — mode gating', () => {
  beforeEach(() => {
    process.env.PAYMENT_MODE = 'mock';
    process.env.SSLCZ_IS_LIVE = 'false';
    resetEnvCache();
  });

  it('refuses to complete a simulated payment when the real gateway is configured', async () => {
    const { buyer, order } = await scaffold();

    process.env.PAYMENT_MODE = 'mock';
    resetEnvCache();
    const session = await initiatePayment(String(buyer._id), String(order._id));

    // Flip to the real gateway: the simulated completion must no longer be honoured,
    // even for a payment that was created while mock mode was on.
    process.env.PAYMENT_MODE = 'sslcommerz';
    resetEnvCache();

    await expect(
      completeMockPayment(String(buyer._id), session.tranId, 'success'),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // Nothing may have been credited.
    expect(await LedgerEntry.countDocuments()).toBe(0);
  });

  it('returns an in-app checkout URL rather than contacting a gateway', async () => {
    const { buyer, order } = await scaffold();
    const session = await initiatePayment(String(buyer._id), String(order._id));

    expect(session.gatewayUrl).toContain('/payment/mock');
    expect(session.gatewayUrl).toContain(session.tranId);
    expect(session.amountPoisha).toBe(150_000);

    const payment = await Payment.findOne({ tranId: session.tranId }).lean();
    // Marked simulated from the moment the session is created, not only on capture.
    expect(payment?.simulated).toBe(true);
    expect(payment?.status).toBe('pending');
  });
});

describe('mock payments — successful capture', () => {
  beforeEach(() => {
    process.env.PAYMENT_MODE = 'mock';
    process.env.SSLCZ_IS_LIVE = 'false';
    resetEnvCache();
  });

  it('runs the same ledger and order transitions as a real capture', async () => {
    const { farmer, buyer, order } = await scaffold();
    const session = await initiatePayment(String(buyer._id), String(order._id));

    const result = await completeMockPayment(String(buyer._id), session.tranId, 'success');
    expect(result.status).toBe('held');

    // Escrow credited to the farmer, and the order advanced out of awaiting_payment.
    const balance = await getBalance(String(farmer._id));
    expect(balance.escrowPoisha).toBe(150_000);
    expect(balance.availablePoisha).toBe(0);

    const updated = await Order.findById(order._id).lean();
    expect(updated?.status).toBe('confirmed');

    // Balanced double-entry, exactly as the real path produces.
    const entries = await LedgerEntry.find({ type: 'capture' }).lean();
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, e) => sum + e.amountPoisha, 0)).toBe(0);

    // Permanently traceable as simulated from the ledger alone, without needing to
    // join back to the payment record.
    expect(entries.every((e) => e.memo.includes('[SIMULATED]'))).toBe(true);
  });

  it('is idempotent — a repeated completion does not double-credit escrow', async () => {
    const { farmer, buyer, order } = await scaffold();
    const session = await initiatePayment(String(buyer._id), String(order._id));

    await completeMockPayment(String(buyer._id), session.tranId, 'success');
    const again = await completeMockPayment(String(buyer._id), session.tranId, 'success');

    expect(again.status).toBe('held');
    expect((await getBalance(String(farmer._id))).escrowPoisha).toBe(150_000);
    expect(await LedgerEntry.countDocuments({ type: 'capture' })).toBe(2);
  });

  it('refuses completion by anyone other than the order’s buyer', async () => {
    const { buyer, order } = await scaffold();
    const stranger = await makeUser('buyer');
    const session = await initiatePayment(String(buyer._id), String(order._id));

    // The real IPN cannot require auth because a gateway calls it; the mock has no
    // external source of truth, so identity is the only guard against anyone marking
    // any order paid.
    await expect(
      completeMockPayment(String(stranger._id), session.tranId, 'success'),
    ).rejects.toMatchObject({ code: 'forbidden' });

    expect(await LedgerEntry.countDocuments()).toBe(0);
  });
});

describe('mock payments — failed capture', () => {
  beforeEach(() => {
    process.env.PAYMENT_MODE = 'mock';
    process.env.SSLCZ_IS_LIVE = 'false';
    resetEnvCache();
  });

  /**
   * The most important test here. A demo that only shows the happy path proves nothing
   * about correctness — the claim worth defending is that a failed payment credits
   * nothing and leaves the order unshippable.
   */
  it('credits nothing and leaves the order awaiting payment', async () => {
    const { farmer, buyer, order } = await scaffold();
    const session = await initiatePayment(String(buyer._id), String(order._id));

    const result = await completeMockPayment(String(buyer._id), session.tranId, 'fail');
    expect(result.status).toBe('failed');

    expect(await LedgerEntry.countDocuments()).toBe(0);
    expect((await getBalance(String(farmer._id))).escrowPoisha).toBe(0);

    const updated = await Order.findById(order._id).lean();
    // Still awaiting_payment: a farmer must not be able to ship against a failed payment.
    expect(updated?.status).toBe('awaiting_payment');

    const payment = await Payment.findOne({ tranId: session.tranId }).lean();
    expect(payment?.status).toBe('failed');
  });

  it('allows a fresh attempt after a failure', async () => {
    const { farmer, buyer, order } = await scaffold();

    const first = await initiatePayment(String(buyer._id), String(order._id));
    await completeMockPayment(String(buyer._id), first.tranId, 'fail');

    // A new attempt gets a new tran_id, which is what keeps the unique index from
    // rejecting a legitimate retry.
    const second = await initiatePayment(String(buyer._id), String(order._id));
    expect(second.tranId).not.toBe(first.tranId);

    await completeMockPayment(String(buyer._id), second.tranId, 'success');
    expect((await getBalance(String(farmer._id))).escrowPoisha).toBe(150_000);
  });
});
