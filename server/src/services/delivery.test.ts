import { DELIVERY_CHARGE_POISHA, deliveryChoiceSchema } from '@krishibid/shared';
import { describe, expect, it } from 'vitest';
import { splitCommission } from '../utils/money.js';

/**
 * Delivery money.
 *
 * The buyer pays goods + delivery into escrow, so the whole amount is covered by the same promise
 * — held until delivery is confirmed. A charge settled outside that would be the one part of the
 * transaction taken on trust, which is the crack people notice.
 *
 * Commission comes off the goods alone. Taking a cut of the carriage would mean the platform
 * profiting from the distance between two people, which is not a service it provides.
 */
describe('delivery charges and the commission split', () => {
  const COMMISSION_BPS = 250; // 2.5%

  it('charges commission on the goods, never on the delivery fee', () => {
    const goodsPoisha = 100_000; // ৳1,000
    const deliveryPoisha = DELIVERY_CHARGE_POISHA.platform; // ৳150

    const { commissionPoisha, netPoisha: goodsNet } = splitCommission(goodsPoisha, COMMISSION_BPS);

    // 2.5% of the goods, and of nothing else.
    expect(commissionPoisha).toBe(2_500);
    expect(commissionPoisha).toBe(Math.floor((goodsPoisha * COMMISSION_BPS) / 10_000));

    const total = goodsPoisha + deliveryPoisha;
    const supplierNet = goodsNet + deliveryPoisha;

    // The three parts sum to exactly what was captured — no poisha appears or vanishes.
    expect(commissionPoisha + supplierNet).toBe(total);
  });

  it('leaves the split unchanged when the buyer collects it themselves', () => {
    const goodsPoisha = 100_000;
    expect(DELIVERY_CHARGE_POISHA.pickup).toBe(0);

    const { commissionPoisha, netPoisha } = splitCommission(goodsPoisha, COMMISSION_BPS);
    expect(commissionPoisha + netPoisha).toBe(goodsPoisha);
  });

  it('keeps every figure an integer number of poisha', () => {
    // A delivery fee that made a total non-integer would put rounding error into the ledger,
    // which is the one place this codebase refuses to accept it.
    for (const charge of Object.values(DELIVERY_CHARGE_POISHA)) {
      expect(Number.isInteger(charge)).toBe(true);
    }

    const { commissionPoisha, netPoisha } = splitCommission(99_999, COMMISSION_BPS);
    expect(Number.isInteger(commissionPoisha)).toBe(true);
    expect(Number.isInteger(netPoisha)).toBe(true);
    expect(commissionPoisha + netPoisha).toBe(99_999);
  });
});

describe('what a delivery choice must include', () => {
  it('accepts a pickup with no address', () => {
    // Collecting it yourself needs no address — demanding one would be a form asking for
    // information nobody uses.
    expect(deliveryChoiceSchema.safeParse({ method: 'pickup' }).success).toBe(true);
  });

  it('refuses a delivery with nowhere to deliver to', () => {
    const parsed = deliveryChoiceSchema.safeParse({ method: 'platform' });

    expect(parsed.success).toBe(false);
    // Reported per field, so the form can mark all three rather than saying "invalid".
    const paths = parsed.error!.issues.map((i) => i.path[0]);
    expect(paths).toContain('addressLine');
    expect(paths).toContain('district');
    expect(paths).toContain('contactPhone');
  });

  it('accepts a complete delivery address', () => {
    const parsed = deliveryChoiceSchema.safeParse({
      method: 'courier',
      addressLine: 'House 12, Road 3, Dhanmondi',
      district: 'Dhaka',
      contactPhone: '01712345678',
    });

    expect(parsed.success).toBe(true);
  });
});
