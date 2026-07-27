import { ORDER_TRANSITIONS, canTransitionOrder, type OrderStatus } from '@krishibid/shared';
import { describe, expect, it } from 'vitest';

const ALL: OrderStatus[] = [
  'awaiting_payment',
  'confirmed',
  'in_transit',
  'completed',
  'disputed',
  'refunded',
  'cancelled',
];

describe('order state machine', () => {
  it('permits exactly the documented happy path', () => {
    expect(canTransitionOrder('awaiting_payment', 'confirmed')).toBe(true);
    expect(canTransitionOrder('confirmed', 'in_transit')).toBe(true);
    expect(canTransitionOrder('in_transit', 'completed')).toBe(true);
  });

  it('never lets an order skip payment', () => {
    // The single most important illegal edge: shipping before escrow is funded.
    expect(canTransitionOrder('awaiting_payment', 'in_transit')).toBe(false);
    expect(canTransitionOrder('awaiting_payment', 'completed')).toBe(false);
  });

  it('treats completed, refunded and cancelled as terminal', () => {
    for (const terminal of ['completed', 'refunded', 'cancelled'] as OrderStatus[]) {
      expect(ORDER_TRANSITIONS[terminal]).toEqual([]);
      for (const target of ALL) {
        expect(canTransitionOrder(terminal, target)).toBe(false);
      }
    }
  });

  it('allows a dispute to resolve either way', () => {
    expect(canTransitionOrder('disputed', 'completed')).toBe(true);
    expect(canTransitionOrder('disputed', 'refunded')).toBe(true);
  });

  it('does not allow a disputed order to be silently shipped onward', () => {
    expect(canTransitionOrder('disputed', 'in_transit')).toBe(false);
  });

  it('rejects every self-transition', () => {
    for (const status of ALL) {
      expect(canTransitionOrder(status, status)).toBe(false);
    }
  });

  it('has an entry for every status, so no state is unreachable by omission', () => {
    for (const status of ALL) {
      expect(ORDER_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('only ever targets known statuses', () => {
    for (const targets of Object.values(ORDER_TRANSITIONS)) {
      for (const target of targets) {
        expect(ALL).toContain(target);
      }
    }
  });
});
