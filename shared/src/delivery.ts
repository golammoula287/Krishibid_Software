import { z } from 'zod';
import { districtSchema, phoneSchema, poishaSchema } from './common.js';

/**
 * How the goods get from the supplier to the buyer.
 *
 * The order state machine already had `in_transit`, but nothing recorded how anything travelled
 * or where to — a buyer confirmed delivery of goods the system could not describe reaching an
 * address it had never been told.
 */
export const deliveryMethodSchema = z.enum(['pickup', 'platform', 'courier']);
export type DeliveryMethod = z.infer<typeof deliveryMethodSchema>;

export const deliveryStatusSchema = z.enum([
  'not_required',
  /** Platform delivery, waiting for an admin to assign somebody. */
  'awaiting_dispatch',
  'dispatched',
  'delivered',
]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

/**
 * What the buyer chooses when they commit to an order.
 *
 * An address is required for anything that is not a pickup — the two delivery methods both end
 * with somebody carrying goods to a place, and "we will sort it out later" is how a lot ends up
 * sitting in a warehouse while two people argue about whose job it was.
 */
export const deliveryChoiceSchema = z
  .object({
    method: deliveryMethodSchema,
    addressLine: z.string().trim().min(8).max(300).optional(),
    district: districtSchema.optional(),
    contactPhone: phoneSchema.optional(),
    note: z.string().trim().max(300).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.method === 'pickup') return;

    for (const field of ['addressLine', 'district', 'contactPhone'] as const) {
      if (!value[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'needed for delivery',
        });
      }
    }
  });
export type DeliveryChoice = z.infer<typeof deliveryChoiceSchema>;

/** What an admin fills in when they hand a consignment to somebody. */
export const assignDeliverySchema = z.object({
  agentName: z.string().trim().min(2).max(80),
  agentPhone: phoneSchema,
  trackingNote: z.string().trim().max(300).optional(),
});
export type AssignDeliveryInput = z.infer<typeof assignDeliverySchema>;

export interface DeliveryDto {
  method: DeliveryMethod;
  status: DeliveryStatus;
  addressLine?: string;
  district?: string;
  contactPhone?: string;
  note?: string;
  /**
   * What delivery costs, in poisha.
   *
   * It goes through escrow with the goods rather than being settled separately. The platform's
   * whole promise is that money is held until delivery is confirmed, and a charge sitting outside
   * that is the crack people notice — you would be asking a buyer to trust us with the large
   * amount and pay the small one on faith.
   *
   * Commission is charged on the goods only. Taking a cut of the delivery fee would mean the
   * platform profiting from the distance between two people, which is not a service we provide.
   */
  chargePoisha: number;
  agentName?: string;
  agentPhone?: string;
  trackingNote?: string;
  dispatchedAt?: string;
  deliveredAt?: string;
}

/**
 * Flat rates, in poisha, per method.
 *
 * Deliberately simple and deliberately visible. Distance-based pricing needs a routing service
 * and a lot of assumptions about roads that do not hold outside the cities; a flat rate a farmer
 * can predict is more useful than an accurate one they cannot.
 */
export const DELIVERY_CHARGE_POISHA: Record<DeliveryMethod, number> = {
  pickup: 0,
  platform: 15_000, // ৳150
  courier: 8_000, // ৳80 handling; the courier bills the buyer directly for the rest
};

export const deliveryChargeFor = (method: DeliveryMethod): number =>
  DELIVERY_CHARGE_POISHA[method];

/** Guard so a poisha figure cannot be passed where a method was meant. */
export const isDeliveryMethod = (value: string): value is DeliveryMethod =>
  deliveryMethodSchema.safeParse(value).success;

export { poishaSchema as deliveryChargeSchema };

// ---------------------------------------------------------------------------
// Admin views
// ---------------------------------------------------------------------------

/** One consignment on the dispatch board. */
export interface DeliveryQueueItemDto {
  orderId: string;
  productName: string;
  quantity: number;
  buyerName: string;
  buyerPhone: string;
  supplierName: string;
  supplierDistrict: string;
  orderStatus: 'awaiting_payment' | 'confirmed' | 'in_transit' | 'completed' | 'disputed' | 'refunded' | 'cancelled';
  createdAt: string;
  delivery: DeliveryDto;
}

/**
 * The operator's dashboard, in one payload.
 *
 * One endpoint rather than eight: the page is useless until every number is in, so eight
 * round trips would only make it slower by the sum of them.
 */
export interface AdminOverviewDto {
  /** Farmers who cannot earn until somebody looks at them. The most urgent number here. */
  pendingApprovals: number;
  unreadMessages: number;
  awaitingDispatch: number;
  listings: { auction: number; fixed: number };
  orders: {
    awaitingPayment: number;
    confirmed: number;
    inTransit: number;
    completed: number;
    disputed: number;
  };
  /** Taken from captured payments, not from agreed orders — see the service for why. */
  escrowHeldPoisha: number;
  /** Released payments only. Counting held ones would report money that has not moved. */
  settledSalesPoisha: number;
  settledOrderCount: number;
  newUsersThisWeek: { farmer: number; buyer: number };
}

export interface ManagedUserDto {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: 'farmer' | 'buyer' | 'admin' | 'superadmin';
  supplierType?: 'farmer' | 'retailer' | 'farm_owner' | 'trader';
  accountStatus: 'active' | 'pending_approval' | 'rejected' | 'suspended';
  kycStatus: 'not_started' | 'pending_review' | 'approved' | 'rejected';
  district: string;
  createdAt: string;
}
