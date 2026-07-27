import { z } from 'zod';
import { objectId, positivePoishaSchema } from './common.js';

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
  in_transit: ['farmer'],
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
  quantityKg: number;
  agreedAmountPoisha: number;
  status: OrderStatus;
  statusHistory: OrderStatusEvent[];
  paymentStatus: string | null;
  paymentDeadline: string | null;
  createdAt: string;
  updatedAt: string;
}
