import type {
  AdminOverviewDto,
  CategoryDto,
  CategoryInput,
  CategoryUpdateInput,
  AssignDeliveryInput,
  DeliveryQueueItemDto,
  ManagedUserDto,
  Role,
} from '@krishibid/shared';
import mongoose from 'mongoose';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Category } from '../models/Category.js';
import { ContactMessage } from '../models/ContactMessage.js';
import { Listing } from '../models/Listing.js';
import { Order } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';
import { recordShipment } from './payment.service.js';

/**
 * What an operator needs to run the platform.
 *
 * Everything here was previously either invisible or reachable only by opening the database:
 * how many farmers are waiting on approval, whether anyone has written in, what is sitting
 * undelivered, how much money is actually held.
 */

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function getOverview(): Promise<AdminOverviewDto> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  /**
   * One round of parallel counts rather than a sequence.
   *
   * These are independent questions and the dashboard is useless until all of them are answered,
   * so waiting for them one after another only makes the page slower by the sum of the parts.
   */
  const [
    pendingApprovals,
    unreadMessages,
    awaitingDispatch,
    auctionsLive,
    fixedLive,
    ordersByStatus,
    escrow,
    settled,
    newUsers,
  ] = await Promise.all([
    User.countDocuments({ 'kyc.status': 'pending_review' }),
    ContactMessage.countDocuments({ status: 'new' }),
    Order.countDocuments({ 'delivery.status': 'awaiting_dispatch' }),
    Listing.countDocuments({ status: 'open', saleMode: 'auction' }),
    Listing.countDocuments({ status: 'open', saleMode: 'fixed' }),

    Order.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    /**
     * Money genuinely held, taken from payments rather than orders.
     *
     * An order says what was agreed; a payment says what was actually captured. Summing orders
     * would report money that may never have been paid as though it were sitting in escrow.
     */
    Payment.aggregate<{ total: number }>([
      { $match: { status: 'held' } },
      { $group: { _id: null, total: { $sum: '$amountPoisha' } } },
    ]),

    /**
     * Completed sales — released payments only.
     *
     * Counting pending or held ones would inflate the figure with money that has not changed
     * hands, which is the number most likely to be quoted at somebody and the worst one to
     * overstate.
     */
    Payment.aggregate<{ total: number; count: number }>([
      { $match: { status: 'released' } },
      { $group: { _id: null, total: { $sum: '$amountPoisha' }, count: { $sum: 1 } } },
    ]),

    User.aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: weekAgo } } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
  ]);

  const byStatus = Object.fromEntries(ordersByStatus.map((row) => [row._id, row.count]));
  const usersByRole = Object.fromEntries(newUsers.map((row) => [row._id, row.count]));

  return {
    pendingApprovals,
    unreadMessages,
    awaitingDispatch,
    listings: { auction: auctionsLive, fixed: fixedLive },
    orders: {
      awaitingPayment: byStatus.awaiting_payment ?? 0,
      confirmed: byStatus.confirmed ?? 0,
      inTransit: byStatus.in_transit ?? 0,
      completed: byStatus.completed ?? 0,
      disputed: byStatus.disputed ?? 0,
    },
    escrowHeldPoisha: escrow[0]?.total ?? 0,
    settledSalesPoisha: settled[0]?.total ?? 0,
    settledOrderCount: settled[0]?.count ?? 0,
    newUsersThisWeek: {
      farmer: usersByRole.farmer ?? 0,
      buyer: usersByRole.buyer ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export async function listDeliveryQueue(
  status: 'awaiting_dispatch' | 'dispatched' = 'awaiting_dispatch',
): Promise<DeliveryQueueItemDto[]> {
  const orders = await Order.find({ 'delivery.status': status })
    .sort({ createdAt: 1 })
    .limit(100)
    .populate<{ buyerId: { _id: unknown; name: string; phone: string } }>('buyerId', 'name phone')
    .populate<{ farmerId: { _id: unknown; name: string; district: string } }>(
      'farmerId',
      'name district',
    )
    .lean();

  return orders.map((order) => {
    const buyer = order.buyerId as unknown as { name?: string; phone?: string };
    const supplier = order.farmerId as unknown as { name?: string; district?: string };

    return {
      orderId: String(order._id),
      productName: order.cropSlug,
      quantity: order.quantityKg,
      buyerName: buyer?.name ?? '',
      buyerPhone: buyer?.phone ?? '',
      supplierName: supplier?.name ?? '',
      supplierDistrict: supplier?.district ?? '',
      orderStatus: order.status as DeliveryQueueItemDto['orderStatus'],
      createdAt: (order as unknown as { createdAt: Date }).createdAt.toISOString(),
      delivery: {
        method: order.delivery?.method ?? 'pickup',
        status: order.delivery?.status ?? 'not_required',
        addressLine: order.delivery?.addressLine ?? undefined,
        district: order.delivery?.district ?? undefined,
        contactPhone: order.delivery?.contactPhone ?? undefined,
        note: order.delivery?.note ?? undefined,
        chargePoisha: order.delivery?.chargePoisha ?? 0,
        agentName: order.delivery?.agentName ?? undefined,
        agentPhone: order.delivery?.agentPhone ?? undefined,
        trackingNote: order.delivery?.trackingNote ?? undefined,
        dispatchedAt: order.delivery?.dispatchedAt?.toISOString(),
        deliveredAt: order.delivery?.deliveredAt?.toISOString(),
      },
    };
  });
}

/**
 * Hands a consignment to somebody, and records who.
 *
 * The agent's name and number are the whole point: an order marked "dispatched" with nobody
 * attached is not tracking, it is a claim. When a buyer rings to ask where their goods are, this
 * is the answer, and it is why it travels on the order rather than staying on this board.
 *
 * Dispatching also SHIPS the order, because on a platform delivery the platform is the carrier.
 * Recording an agent while leaving the order at `confirmed` would produce an order whose delivery
 * says "dispatched" and whose status says nothing has happened — and worse, the buyer could not
 * confirm receipt (escrow release requires `in_transit`) and the auto-release clock would never
 * start, so the supplier's money would sit in escrow until somebody noticed by hand.
 */
export async function assignDelivery(
  adminId: string,
  orderId: string,
  input: AssignDeliveryInput,
): Promise<void> {
  const order = await Order.findById(orderId);
  if (!order) throw notFound('order');

  if (order.delivery?.method !== 'platform') {
    throw badRequest(
      'delivery_not_ours',
      'this order is a pickup or a courier shipment — there is nothing for us to dispatch',
    );
  }

  /**
   * Nothing leaves before the money is in escrow.
   *
   * The whole protection a supplier gets from this platform is that goods move only against held
   * funds. An admin dispatching an unpaid order would hand that away on the supplier's behalf,
   * from a screen that shows no payment status at all.
   */
  if (order.status !== 'confirmed' && order.status !== 'in_transit') {
    throw conflict(
      'delivery_not_dispatchable',
      order.status === 'awaiting_payment'
        ? 'the buyer has not paid into escrow yet — nothing should leave the supplier'
        : `an order that is ${order.status} cannot be dispatched`,
    );
  }

  await Order.updateOne(
    { _id: orderId },
    {
      $set: {
        'delivery.agentName': input.agentName,
        'delivery.agentPhone': input.agentPhone,
        'delivery.trackingNote': input.trackingNote ?? null,
        'delivery.status': 'dispatched',
        'delivery.dispatchedAt': new Date(),
      },
    },
  );

  /**
   * Only on the way out of `confirmed`.
   *
   * Reassigning an agent to something already in transit — the first one fell ill, the parcel
   * came back — must update who is carrying it without pretending it shipped a second time, or
   * it would reset the auto-release clock the buyer's protection window is measured from.
   */
  if (order.status === 'confirmed') {
    await recordShipment(orderId, adminId, `handed to ${input.agentName} for delivery`);
  }

  logger.info({ adminId, orderId, agent: input.agentName }, 'delivery assigned');
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function listUsers(options: {
  role?: Role;
  status?: string;
  q?: string;
  limit?: number;
}): Promise<ManagedUserDto[]> {
  const filter: Record<string, unknown> = {};
  if (options.role) filter.role = options.role;
  if (options.status) filter.accountStatus = options.status;

  if (options.q?.trim()) {
    // Escaped: an unescaped search box is a regex injection, and `(a+)+$` against a large
    // collection is a denial of service somebody can type.
    const escaped = options.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { phone: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } },
    ];
  }

  const users = await User.find(filter)
    .sort({ createdAt: -1 })
    .limit(options.limit ?? 50)
    .lean();

  return users.map((user) => ({
    id: String(user._id),
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role as Role,
    supplierType: user.supplierType ?? undefined,
    accountStatus: user.accountStatus as ManagedUserDto['accountStatus'],
    kycStatus: (user.kyc?.status ?? 'not_started') as ManagedUserDto['kycStatus'],
    district: user.district,
    createdAt: (user as unknown as { createdAt: Date }).createdAt.toISOString(),
  }));
}

/**
 * Promotes or demotes an admin. Super admin only.
 *
 * The restriction is the point of having two levels at all. An admin who could appoint another
 * admin could entrench themselves, and an admin who could demote one could lock everybody else
 * out — so the power to change who holds power sits one level up, with an account that exists
 * only through the seed.
 */
export async function setUserRole(
  actor: { id: string; role: Role },
  userId: string,
  role: Role,
): Promise<void> {
  if (actor.role !== 'superadmin') {
    throw forbidden('only a super admin can change who is an administrator');
  }
  if (actor.id === userId) {
    // Demoting yourself could leave the platform with no super admin at all, and nothing in the
    // application can create another one.
    throw badRequest('cannot_change_own_role', 'you cannot change your own role');
  }

  const user = await User.findById(userId);
  if (!user) throw notFound('user');

  await User.updateOne(
    { _id: userId },
    {
      $set: { role },
      // Every outstanding token carries the old role, so they are all invalidated: a demoted
      // admin must lose their powers now, not when their access token happens to expire.
      $inc: { tokenVersion: 1 },
    },
  );

  logger.warn({ actorId: actor.id, userId, from: user.role, to: role }, 'user role changed');
}

/** Suspending or reinstating. An admin may not do this to another admin. */
export async function setUserStatus(
  actor: { id: string; role: Role },
  userId: string,
  status: 'active' | 'suspended',
  reason: string,
): Promise<void> {
  const user = await User.findById(userId);
  if (!user) throw notFound('user');

  const targetsAdmin = user.role === 'admin' || user.role === 'superadmin';
  if (targetsAdmin && actor.role !== 'superadmin') {
    throw forbidden('only a super admin can suspend an administrator');
  }
  if (user.role === 'superadmin') {
    throw forbidden('a super admin account cannot be suspended');
  }
  if (actor.id === userId) {
    throw badRequest('cannot_change_own_status', 'you cannot suspend your own account');
  }

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        accountStatus: status,
        suspensionReason: status === 'suspended' ? reason : null,
        ...(status === 'suspended' ? { refreshTokenHash: null } : {}),
      },
      ...(status === 'suspended' ? { $inc: { tokenVersion: 1 } } : {}),
    },
  );

  logger.warn({ actorId: actor.id, userId, status, reason }, 'account status changed by admin');
}

export async function createAdmin(
  actor: { id: string; role: Role },
  userId: string,
): Promise<void> {
  await setUserRole(actor, userId, 'admin');
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** Everything, including deactivated ones — the public endpoint only serves active. */
export async function listAllCategories(): Promise<CategoryDto[]> {
  const categories = await Category.find().sort({ order: 1 }).lean();
  return categories.map((c) => ({
    slug: c.slug,
    names: c.names as CategoryDto['names'],
    units: c.units as CategoryDto['units'],
    perishable: Boolean(c.perishable),
    order: c.order ?? 100,
    active: Boolean(c.active),
  }));
}

export async function createCategory(input: CategoryInput): Promise<void> {
  const clash = await Category.findOne({ slug: input.slug }).select('_id').lean();
  if (clash) throw conflict('category_exists', 'a category with that address already exists');

  await Category.create(input);
  logger.info({ slug: input.slug }, 'category created');
}

export async function updateCategory(slug: string, input: CategoryUpdateInput): Promise<void> {
  /**
   * The slug never moves.
   *
   * Every listing references it, and renaming would orphan them — a lot whose category cannot be
   * resolved shows a raw slug where its name should be. Deactivate and create instead; the old
   * one keeps resolving for the listings that already point at it.
   */
  const { slug: _ignored, ...changes } = input;

  const updated = await Category.findOneAndUpdate({ slug }, { $set: changes });
  if (!updated) throw notFound('category');

  logger.info({ slug, fields: Object.keys(changes) }, 'category updated');
}

/**
 * Deactivates rather than deletes.
 *
 * Deleting would break every listing already filed under it. Inactive keeps the name resolving
 * while removing it from the rail and from the listing form, which is what "remove" actually
 * means here.
 */
export async function deactivateCategory(slug: string): Promise<void> {
  const updated = await Category.findOneAndUpdate({ slug }, { $set: { active: false } });
  if (!updated) throw notFound('category');
  logger.warn({ slug }, 'category deactivated');
}

export const objectId = (id: string): mongoose.Types.ObjectId =>
  new mongoose.Types.ObjectId(id);
