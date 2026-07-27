import { describe, expect, it } from 'vitest';
import {
  bdtToPoisha,
  gatewayAmountToPoisha,
  poishaToGatewayAmount,
  splitCommission,
} from './money.js';

describe('money — commission split', () => {
  it('always sums back to the original amount', () => {
    // Property check across awkward values: the two parts must reconstruct the
    // whole exactly, or the ledger cannot balance.
    const amounts = [1, 7, 99, 100, 101, 3_333, 150_000, 999_999, 1_000_001];

    for (const amount of amounts) {
      for (const bps of [0, 1, 250, 999, 10_000]) {
        const { commissionPoisha, netPoisha } = splitCommission(amount, bps);
        expect(commissionPoisha + netPoisha).toBe(amount);
        expect(Number.isInteger(commissionPoisha)).toBe(true);
        expect(Number.isInteger(netPoisha)).toBe(true);
        expect(commissionPoisha).toBeGreaterThanOrEqual(0);
        expect(netPoisha).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('floors the commission so the farmer absorbs no rounding loss', () => {
    // 2.5% of 101 poisha = 2.525 -> floored to 2, farmer keeps 99.
    expect(splitCommission(101, 250)).toEqual({ commissionPoisha: 2, netPoisha: 99 });
  });

  it('takes nothing at 0 bps', () => {
    expect(splitCommission(150_000, 0)).toEqual({ commissionPoisha: 0, netPoisha: 150_000 });
  });

  it('rejects a non-integer amount', () => {
    expect(() => splitCommission(100.5, 250)).toThrow(/non-negative integer/);
  });
});

describe('money — gateway amount conversion', () => {
  it('round-trips poisha through the gateway string form', () => {
    for (const poisha of [1, 100, 12_345, 150_000, 99_999_999]) {
      expect(gatewayAmountToPoisha(poishaToGatewayAmount(poisha))).toBe(poisha);
    }
  });

  it('formats with exactly two decimals', () => {
    expect(poishaToGatewayAmount(150_000)).toBe('1500.00');
    expect(poishaToGatewayAmount(1)).toBe('0.01');
    expect(poishaToGatewayAmount(0)).toBe('0.00');
  });

  it('returns null rather than NaN for unparseable input', () => {
    // Critical: a NaN compared loosely against an expected amount could let a
    // tampered callback through.
    expect(gatewayAmountToPoisha(undefined)).toBeNull();
    expect(gatewayAmountToPoisha('')).toBeNull();
    expect(gatewayAmountToPoisha('abc')).toBeNull();
    expect(gatewayAmountToPoisha('-5.00')).toBeNull();
  });

  it('avoids float drift on values that break naive arithmetic', () => {
    // 0.1 + 0.2 territory: 1234.56 BDT must be exactly 123456 poisha.
    expect(bdtToPoisha(1234.56)).toBe(123_456);
    expect(gatewayAmountToPoisha('1234.56')).toBe(123_456);
  });
});
