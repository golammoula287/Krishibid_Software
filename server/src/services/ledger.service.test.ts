import { describe, expect, it } from 'vitest';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { makeOrder, makePayment, makeUser } from '../test/factories.js';
import { auditLedger, getBalance, postTransaction } from './ledger.service.js';

async function scaffold() {
  const farmer = await makeUser('farmer');
  const buyer = await makeUser('buyer');
  const order = await makeOrder({
    listingId: farmer._id, // any ObjectId is fine for ledger-only tests
    farmerId: farmer._id,
    buyerId: buyer._id,
  });
  const payment = await makePayment({
    orderId: order._id,
    buyerId: buyer._id,
    farmerId: farmer._id,
    amountPoisha: 150_000,
  });
  return { farmer, buyer, order, payment };
}

describe('ledger — the balance invariant', () => {
  it('refuses to post an unbalanced transaction', async () => {
    const { farmer, order, payment } = await scaffold();

    await expect(
      postTransaction({
        type: 'capture',
        paymentId: String(payment._id),
        orderId: String(order._id),
        legs: [
          { account: 'gateway_clearing', amountPoisha: -150_000, memo: 'in' },
          // Deliberately 1 poisha short.
          {
            account: 'farmer_escrow',
            amountPoisha: 149_999,
            userId: String(farmer._id),
            memo: 'out',
          },
        ],
      }),
    ).rejects.toThrow(/unbalanced/i);

    // Nothing at all may be written — a partial post is worse than a refusal.
    expect(await LedgerEntry.countDocuments()).toBe(0);
  });

  it('refuses a single-leg transaction', async () => {
    const { order, payment } = await scaffold();

    await expect(
      postTransaction({
        type: 'capture',
        paymentId: String(payment._id),
        orderId: String(order._id),
        legs: [{ account: 'gateway_clearing', amountPoisha: 0, memo: 'nope' }],
      }),
    ).rejects.toThrow(/>= 2 legs/);
  });

  it('refuses a zero-amount leg', async () => {
    const { farmer, order, payment } = await scaffold();

    await expect(
      postTransaction({
        type: 'release',
        paymentId: String(payment._id),
        orderId: String(order._id),
        legs: [
          { account: 'farmer_escrow', amountPoisha: 0, userId: String(farmer._id), memo: 'a' },
          { account: 'farmer_available', amountPoisha: 0, userId: String(farmer._id), memo: 'b' },
        ],
      }),
    ).rejects.toThrow(/non-zero/);
  });

  it('refuses non-integer amounts', async () => {
    const { farmer, order, payment } = await scaffold();

    await expect(
      postTransaction({
        type: 'capture',
        paymentId: String(payment._id),
        orderId: String(order._id),
        legs: [
          { account: 'gateway_clearing', amountPoisha: -100.5, memo: 'a' },
          { account: 'farmer_escrow', amountPoisha: 100.5, userId: String(farmer._id), memo: 'b' },
        ],
      }),
    ).rejects.toThrow(/integer poisha/);
  });

  it('posts a balanced transaction and stays balanced under audit', async () => {
    const { farmer, order, payment } = await scaffold();

    await postTransaction({
      type: 'capture',
      paymentId: String(payment._id),
      orderId: String(order._id),
      legs: [
        { account: 'gateway_clearing', amountPoisha: -150_000, memo: 'capture' },
        {
          account: 'farmer_escrow',
          amountPoisha: 150_000,
          userId: String(farmer._id),
          memo: 'escrow',
        },
      ],
    });

    expect(await LedgerEntry.countDocuments()).toBe(2);
    expect(await auditLedger()).toEqual([]);
  });

  it('keeps a three-leg release balanced (net + commission)', async () => {
    const { farmer, order, payment } = await scaffold();

    // 150,000 poisha at 2.5% -> 3,750 commission, 146,250 net.
    await postTransaction({
      type: 'release',
      paymentId: String(payment._id),
      orderId: String(order._id),
      legs: [
        {
          account: 'farmer_escrow',
          amountPoisha: -150_000,
          userId: String(farmer._id),
          memo: 'a',
        },
        {
          account: 'farmer_available',
          amountPoisha: 146_250,
          userId: String(farmer._id),
          memo: 'b',
        },
        { account: 'platform_revenue', amountPoisha: 3_750, userId: null, memo: 'c' },
      ],
    });

    expect(await auditLedger()).toEqual([]);
  });
});

describe('ledger — immutability', () => {
  it('rejects updates and deletes on posted entries', async () => {
    const { farmer, order, payment } = await scaffold();

    await postTransaction({
      type: 'capture',
      paymentId: String(payment._id),
      orderId: String(order._id),
      legs: [
        { account: 'gateway_clearing', amountPoisha: -1000, memo: 'a' },
        { account: 'farmer_escrow', amountPoisha: 1000, userId: String(farmer._id), memo: 'b' },
      ],
    });

    // History must be correctable only by a compensating entry, never by edit.
    await expect(
      LedgerEntry.updateOne({ account: 'farmer_escrow' }, { amountPoisha: 999_999 }),
    ).rejects.toThrow(/immutable/i);

    await expect(LedgerEntry.deleteMany({})).rejects.toThrow(/cannot be deleted/i);
  });

  it('blocks a duplicate capture for the same payment', async () => {
    const { farmer, order, payment } = await scaffold();

    const legs = [
      { account: 'gateway_clearing' as const, amountPoisha: -150_000, memo: 'a' },
      {
        account: 'farmer_escrow' as const,
        amountPoisha: 150_000,
        userId: String(farmer._id),
        memo: 'b',
      },
    ];

    await postTransaction({
      type: 'capture',
      paymentId: String(payment._id),
      orderId: String(order._id),
      legs,
    });

    // The partial unique index is the storage-level backstop for IPN idempotency.
    await expect(
      postTransaction({
        type: 'capture',
        paymentId: String(payment._id),
        orderId: String(order._id),
        legs,
      }),
    ).rejects.toThrow();
  });
});

describe('ledger — derived balances', () => {
  it('derives escrow, available and paid-out from entries alone', async () => {
    const { farmer, order, payment } = await scaffold();
    const farmerId = String(farmer._id);

    await postTransaction({
      type: 'capture',
      paymentId: String(payment._id),
      orderId: String(order._id),
      legs: [
        { account: 'gateway_clearing', amountPoisha: -150_000, memo: 'capture' },
        { account: 'farmer_escrow', amountPoisha: 150_000, userId: farmerId, memo: 'escrow' },
      ],
    });

    let balance = await getBalance(farmerId);
    expect(balance.escrowPoisha).toBe(150_000);
    expect(balance.availablePoisha).toBe(0);

    await postTransaction({
      type: 'release',
      paymentId: String(payment._id),
      orderId: String(order._id),
      legs: [
        { account: 'farmer_escrow', amountPoisha: -150_000, userId: farmerId, memo: 'release' },
        { account: 'farmer_available', amountPoisha: 146_250, userId: farmerId, memo: 'net' },
        { account: 'platform_revenue', amountPoisha: 3_750, userId: null, memo: 'commission' },
      ],
    });

    balance = await getBalance(farmerId);
    // Escrow drains to exactly zero — the money moved, it was not duplicated.
    expect(balance.escrowPoisha).toBe(0);
    expect(balance.availablePoisha).toBe(146_250);
    expect(balance.lifetimeEarnedPoisha).toBe(146_250);
  });
});
