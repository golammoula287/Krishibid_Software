import {
  canTransitionOrder,
  type DeliveryDto,
  type OrderDto,
  type OrderStatus,
} from '@krishibid/shared';
import mongoose from 'mongoose';
import { conflict, forbidden, notFound } from '../utils/errors.js';
import { Listing } from '../models/Listing.js';
import { Order, type OrderDoc } from '../models/Order.js';
import { Payment } from '../models/Payment.js';

/**
 * The delivery block, with the empty strings mongoose leaves behind turned back into absence.
 *
 * `agentName: ''` and no agent at all are the same fact and must render the same way — the UI
 * asks "is there somebody carrying this?", and an empty string answers yes.
 */
function toDeliveryDto(d: OrderDoc['delivery']): DeliveryDto {
  return {
    method: (d?.method ?? 'pickup') as DeliveryDto['method'],
    status: (d?.status ?? 'not_required') as DeliveryDto['status'],
    addressLine: d?.addressLine || undefined,
    district: d?.district || undefined,
    contactPhone: d?.contactPhone || undefined,
    note: d?.note || undefined,
    chargePoisha: d?.chargePoisha ?? 0,
    agentName: d?.agentName || undefined,
    agentPhone: d?.agentPhone || undefined,
    trackingNote: d?.trackingNote || undefined,
    dispatchedAt: d?.dispatchedAt?.toISOString(),
    deliveredAt: d?.deliveredAt?.toISOString(),
  };
}

export function toOrderDto(o: OrderDoc, paymentStatus: string | null): OrderDto {
  return {
    id: String(o._id),
    listingId: String(o.listingId),
    bidId: String(o.bidId),
    farmerId: String(o.farmerId),
    buyerId: String(o.buyerId),
    cropSlug: o.cropSlug,
    quantityKg: o.quantityKg,
    agreedAmountPoisha: o.agreedAmountPoisha,
    status: o.status as OrderStatus,
    statusHistory: (o.statusHistory ?? []).map((ev) => ({
      status: ev.status as OrderStatus,
      at: ev.at.toISOString(),
      by: ev.by ? String(ev.by) : null,
      note: ev.note ?? undefined,
    })),
    delivery: toDeliveryDto(o.delivery),
    paymentStatus,
    paymentDeadline: o.paymentDeadline?.toISOString() ?? null,
    createdAt: (o as unknown as { createdAt: Date }).createdAt.toISOString(),
    updatedAt: (o as unknown as { updatedAt: Date }).updatedAt.toISOString(),
  };
}

/**
 * Attaches the latest payment status to each order in ONE query.
 *
 * The obvious per-order lookup would be an N+1 paid on every render of the orders
 * list — the most-visited authenticated screen in the app.
 */
export async function attachPaymentStatus(orders: OrderDoc[]): Promise<OrderDto[]> {
  if (orders.length === 0) return [];

  const payments = await Payment.find({ orderId: { $in: orders.map((o) => o._id) } })
    .select('orderId status createdAt')
    .sort({ createdAt: -1 })
    .lean();

  const latest = new Map<string, string>();
  for (const p of payments) {
    const key = String(p.orderId);
    if (!latest.has(key)) latest.set(key, p.status);
  }

  return orders.map((o) => toOrderDto(o, latest.get(String(o._id)) ?? null));
}

/**
 * Applies an order status transition.
 *
 * Validates against the legal-transition map, then applies the change and appends
 * to the audit history in a single atomic update. The `status` precondition in the
 * filter is what makes it safe under concurrency: the write only lands if the
 * order is still in the state we validated against.
 */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  by: string | null,
  note: string,
  session?: mongoose.ClientSession | null,
): Promise<void> {
  const order = await Order.findById(orderId).session(session ?? null);
  if (!order) throw notFound('order');

  const from = order.status as OrderStatus;
  if (from === to) return; // idempotent — a retried job must not fail

  if (!canTransitionOrder(from, to)) {
    throw conflict('illegal_transition', `an order cannot move from ${from} to ${to}`);
  }

  const updated = await Order.findOneAndUpdate(
    { _id: orderId, status: from },
    {
      $set: { status: to },
      $push: { statusHistory: { status: to, at: new Date(), by, note } },
    },
    { new: true, session: session ?? null },
  );

  if (!updated) {
    throw conflict('order_changed', 'this order changed state concurrently; retry');
  }

  // Relist the lot if the sale fell through, so the farmer is not stranded with a
  // `sold` listing and no order behind it.
  if (to === 'cancelled' || to === 'refunded') {
    await Listing.findOneAndUpdate(
      { _id: order.listingId, status: 'sold' },
      { $set: { status: 'expired' }, $inc: { version: 1 } },
      { session: session ?? null },
    );
  }
}

export async function listOrdersForUser(userId: string): Promise<OrderDto[]> {
  const id = new mongoose.Types.ObjectId(userId);
  const orders = await Order.find({ $or: [{ buyerId: id }, { farmerId: id }] })
    .sort({ createdAt: -1 })
    .limit(50);
  return attachPaymentStatus(orders);
}

export async function getOrderForUser(orderId: string, userId: string): Promise<OrderDto> {
  const order = await Order.findById(orderId);
  if (!order) throw notFound('order');

  if (String(order.buyerId) !== userId && String(order.farmerId) !== userId) {
    throw forbidden('not a party to this order');
  }

  const [dto] = await attachPaymentStatus([order]);
  return dto!;
}
