import type {
  CreateReviewInput,
  RatingSummary,
  ReviewDto,
  ReviewableOrderDto,
  SupplierProfileDto,
  SupplierType,
} from '@krishibid/shared';
import mongoose from 'mongoose';
import { conflict, forbidden, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Listing } from '../models/Listing.js';
import { Order } from '../models/Order.js';
import { Review, type ReviewDoc } from '../models/Review.js';
import { User } from '../models/User.js';

/**
 * Ratings, and the public face of a supplier.
 *
 * The rule that makes any of this worth showing is that a review requires a completed order. A
 * marketplace where anybody can rate anybody has a rating column that means nothing: a competitor
 * with a free afternoon can bury a farmer who has done nothing wrong, and a supplier with a
 * friendly cousin can manufacture five stars. Tying each review to a transaction the platform
 * itself watched complete is what makes the number evidence rather than opinion.
 */

const REVIEW_PAGE = 20;

function toDto(review: ReviewDoc & { _id: unknown }, buyerName: string): ReviewDto {
  return {
    id: String(review._id),
    rating: review.rating,
    comment: review.comment || undefined,
    buyerName,
    productTitle: review.productTitle,
    createdAt: (review as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

/**
 * Leaves a review.
 *
 * Every check here is about one question — did this person actually buy this thing from this
 * supplier — and none of them are in the UI's gift to skip.
 */
export async function createReview(
  buyerId: string,
  input: CreateReviewInput,
): Promise<ReviewDto> {
  const order = await Order.findById(input.orderId);
  if (!order) throw notFound('order');

  if (String(order.buyerId) !== buyerId) {
    // Not "not found": the buyer knows the order exists, they just are not its buyer. Pretending
    // otherwise would be confusing rather than protective.
    throw forbidden('only the buyer on an order can review it');
  }

  /**
   * Completed, not merely paid.
   *
   * A review is a verdict on the whole transaction, and until the goods have arrived and the buyer
   * has said so, the thing being judged has not finished happening. It also removes the obvious
   * lever: a buyer cannot threaten a one-star review over an order whose money they have not yet
   * released.
   */
  if (order.status !== 'completed') {
    throw conflict(
      'order_not_completed',
      'you can review a supplier once the order is complete',
    );
  }

  const listing = await Listing.findById(order.listingId).select('title').lean();

  try {
    const review = await Review.create({
      orderId: order._id,
      supplierId: order.farmerId,
      buyerId: new mongoose.Types.ObjectId(buyerId),
      rating: input.rating,
      comment: input.comment,
      productTitle: listing?.title ?? order.cropSlug,
    });

    /**
     * The running total, moved atomically.
     *
     * `$inc` rather than read-add-write: two reviews landing at the same moment on a popular
     * supplier would otherwise both read the same total and one would be lost, permanently and
     * silently.
     */
    await User.updateOne(
      { _id: order.farmerId },
      { $inc: { 'rating.sum': input.rating, 'rating.count': 1 } },
    );

    logger.info(
      { orderId: String(order._id), supplierId: String(order.farmerId), rating: input.rating },
      'review left',
    );

    const buyer = await User.findById(buyerId).select('name').lean();
    return toDto(review, buyer?.name ?? '');
  } catch (err) {
    // The unique index on orderId is what actually enforces one review per transaction; this
    // turns its error into something a person can read.
    if ((err as { code?: number }).code === 11000) {
      throw conflict('already_reviewed', 'you have already reviewed this order');
    }
    throw err;
  }
}

/** Completed orders this buyer has not reviewed — what the prompt to review is built from. */
export async function listReviewableOrders(buyerId: string): Promise<ReviewableOrderDto[]> {
  const orders = await Order.find({
    buyerId: new mongoose.Types.ObjectId(buyerId),
    status: 'completed',
  })
    .sort({ updatedAt: -1 })
    .limit(50)
    .populate<{ farmerId: { _id: unknown; name: string } }>('farmerId', 'name')
    .lean();

  if (orders.length === 0) return [];

  // One query for all of them rather than one per order — this runs on the buyer's dashboard.
  const reviewed = new Set(
    (
      await Review.find({ orderId: { $in: orders.map((o) => o._id) } })
        .select('orderId')
        .lean()
    ).map((r) => String(r.orderId)),
  );

  const listings = await Listing.find({ _id: { $in: orders.map((o) => o.listingId) } })
    .select('title')
    .lean();
  const titles = new Map(listings.map((l) => [String(l._id), l.title]));

  return orders
    .filter((order) => !reviewed.has(String(order._id)))
    .map((order) => {
      const supplier = order.farmerId as unknown as { _id: unknown; name?: string };
      return {
        orderId: String(order._id),
        supplierId: String(supplier._id),
        supplierName: supplier?.name ?? '',
        productTitle: titles.get(String(order.listingId)) ?? order.cropSlug,
        completedAt: (order as unknown as { updatedAt: Date }).updatedAt.toISOString(),
      };
    });
}

/**
 * The distribution, in one aggregation.
 *
 * Worth the extra query because an average on its own hides its own shape: 4.0 from twenty fours
 * and 4.0 from ten ones and ten fives describe very different suppliers, and only one of them is
 * safe to buy from.
 */
async function ratingSummary(supplierId: string, sum: number, count: number): Promise<RatingSummary> {
  const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

  if (count > 0) {
    const rows = await Review.aggregate<{ _id: number; n: number }>([
      { $match: { supplierId: new mongoose.Types.ObjectId(supplierId) } },
      { $group: { _id: '$rating', n: { $sum: 1 } } },
    ]);
    for (const row of rows) distribution[String(row._id)] = row.n;
  }

  return {
    // Derived, never stored. One decimal because a rating quoted to three is false precision.
    average: count > 0 ? Math.round((sum / count) * 10) / 10 : 0,
    count,
    distribution,
  };
}

/**
 * A supplier's public page.
 *
 * Everything here is either the platform's own observation — how many lots are open, how many
 * orders completed, what buyers said — or something the supplier chose to publish. Their phone
 * number and email are neither, and are not included: a buyer mid-trade reaches them through the
 * order, which is a relationship the platform can see and moderate. Publishing a farmer's mobile
 * number on a page open to the internet is not something they agreed to by listing rice.
 */
export async function getSupplierProfile(supplierId: string): Promise<SupplierProfileDto> {
  if (!mongoose.isValidObjectId(supplierId)) throw notFound('supplier');

  const user = await User.findById(supplierId)
    .select('name role supplierType district createdAt kyc.status rating')
    .lean();

  if (!user || (user.role !== 'farmer' && user.role !== 'admin' && user.role !== 'superadmin')) {
    throw notFound('supplier');
  }

  const [activeListings, completedSales, reviews] = await Promise.all([
    Listing.countDocuments({ farmerId: user._id, status: 'open' }),
    Order.countDocuments({ farmerId: user._id, status: 'completed' }),
    Review.find({ supplierId: user._id })
      .sort({ createdAt: -1 })
      .limit(REVIEW_PAGE)
      .populate<{ buyerId: { name: string } }>('buyerId', 'name')
      .lean(),
  ]);

  const rating = await ratingSummary(
    supplierId,
    user.rating?.sum ?? 0,
    user.rating?.count ?? 0,
  );

  return {
    id: String(user._id),
    name: user.name,
    supplierType: (user.supplierType ?? undefined) as SupplierType | undefined,
    district: user.district,
    memberSince: (user as unknown as { createdAt: Date }).createdAt.toISOString(),
    /** The platform's own word that documents were checked, not a claim the supplier can make. */
    verified: user.kyc?.status === 'approved',
    rating,
    activeListings,
    completedSales,
    reviews: reviews.map((review) => {
      const buyer = review.buyerId as unknown as { name?: string };
      return toDto(review as never, buyer?.name ?? '');
    }),
  };
}
