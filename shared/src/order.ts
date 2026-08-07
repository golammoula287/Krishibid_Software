import { z } from 'zod';
import { objectId, positivePoishaSchema } from './common.js';
import type { DeliveryDto } from './delivery.js';

/**
 * Order lifecycle. Payment is interleaved: an order is not `confirmed` until
 * the buyer's money is actually in escrow, so a farmer never ships against an
 * unpaid order.
 *
 *   awaiting_payment ──escrow held──▶ confirmed ──farmer ships──▶ in_transit
 *          │                                                          │
 *          └──payment window expires──▶ cancelled                     │
 *                                                                     │
 *   in_transit ──buyer confirms | auto-release──▶ completed           │
 *          └──buyer disputes──▶ disputed ──admin──▶ completed | refunded
 */
export const orderStatusSchema = z.enum([
  'awaiting_payment',
  'confirmed',
  'in_transit',
  'completed',
  'disputed',
  'refunded',
  'cancelled',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/**
 * The single source of truth for legal order transitions.
 *
 * Encoded as data rather than scattered `if` statements so that the invariant
 * is testable in isolation and impossible to bypass by adding a new controller.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  awaiting_payment: ['confirmed', 'cancelled'],
  confirmed: ['in_transit', 'disputed', 'refunded'],
  in_transit: ['completed', 'disputed'],
  disputed: ['completed', 'refunded'],
  completed: [],
  refunded: [],
  cancelled: [],
} as const;

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Who is permitted to drive each transition. Enforced in the service layer. */
export const ORDER_TRANSITION_ACTORS: Readonly<
  Record<OrderStatus, readonly ('farmer' | 'buyer' | 'admin' | 'system')[]>
> = {
  awaiting_payment: [],
  confirmed: ['system'], // only the verified payment IPN moves an order here
  /**
   * The supplier, or an admin dispatching a platform delivery.
   *
   * On a platform delivery the platform IS the carrier — the goods start moving when an admin
   * hands them to an agent, not when the supplier says so. Leaving this to the supplier alone
   * would ask them to attest to a shipment somebody else made, and would leave the order sitting
   * at `confirmed` while an agent was already carrying it: the buyer could not confirm receipt
   * (release requires `in_transit`) and the auto-release clock, which starts on shipping, would
   * never start at all.
   */
  in_transit: ['farmer', 'admin'],
  completed: ['buyer', 'system', 'admin'], // buyer confirms, or auto-release
  disputed: ['buyer'],
  refunded: ['admin', 'system'],
  cancelled: ['system', 'admin'],
} as const;

export const markShippedSchema = z.object({
  orderId: objectId,
  courierNote: z.string().max(300).optional(),
});

export interface OrderStatusEvent {
  status: OrderStatus;
  at: string;
  by: string | null;
  note?: string;
}

export interface OrderDto {
  id: string;
  listingId: string;
  bidId: string;
  farmerId: string;
  buyerId: string;
  cropSlug: string;
  /**
   * The listing's title and cover photo, copied onto the order for display.
   *
   * The orders list showed `cropSlug` — so every row read "crops", which is the category and
   * tells a buyer nothing about which of their four orders they are looking at. Joined from the
   * listing rather than stored, so a supplier editing a typo does not leave the order showing
   * the old wording.
   */
  productTitle?: string;
  productPhoto?: string;
  quantityKg: number;
  agreedAmountPoisha: number;
  status: OrderStatus;
  statusHistory: OrderStatusEvent[];
  /**
   * How the goods travel, and — once an admin has handed them over — who is carrying them.
   *
   * On the order rather than fetched separately, because the question it answers is asked at
   * exactly one moment: the buyer looking at their order wanting to know where it is and who to
   * ring. A second request for that would be a second chance to show them nothing.
   */
  delivery: DeliveryDto;
  paymentStatus: string | null;
  paymentDeadline: string | null;
  createdAt: string;
  updatedAt: string;
}
