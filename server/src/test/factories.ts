import mongoose from 'mongoose';
import { Bid } from '../models/Bid.js';
import { Crop } from '../models/Crop.js';
import { Listing } from '../models/Listing.js';
import { Order } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';

let counter = 0;
const nextPhone = (): string => `018${String(10_000_000 + counter++).slice(0, 8)}`;

export async function makeUser(role: 'farmer' | 'buyer' | 'admin' = 'buyer', name?: string) {
  return User.create({
    phone: nextPhone(),
    name: name ?? `${role}-${counter}`,
    // Pre-hashed "password123"; hashing per user makes the suite noticeably slower.
    passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    role,
    district: 'Dhaka',
    locale: 'bn',
  });
}

export async function makeCrop(slug = 'rice') {
  return Crop.findOneAndUpdate(
    { slug },
    { slug, names: { bn: 'ধান', en: 'Rice' }, unit: 'kg', hasDiseaseModel: true },
    { upsert: true, new: true },
  );
}

export interface MakeListingOptions {
  farmerId: mongoose.Types.ObjectId | string;
  reservePricePoisha?: number;
  closesInMs?: number;
  status?: 'open' | 'sold' | 'expired' | 'cancelled';
}

export async function makeListing(opts: MakeListingOptions) {
  await makeCrop();
  return Listing.create({
    farmerId: opts.farmerId,
    cropSlug: 'rice',
    quantityKg: 500,
    qualityGrade: 'A',
    district: 'Dhaka',
    reservePricePoisha: opts.reservePricePoisha ?? 100_000, // 1,000 BDT
    status: opts.status ?? 'open',
    bidClosesAt: new Date(Date.now() + (opts.closesInMs ?? 60 * 60 * 1000)),
    version: 0,
  });
}

export async function makeOrder(opts: {
  listingId: mongoose.Types.ObjectId | string;
  bidId?: mongoose.Types.ObjectId | string;
  farmerId: mongoose.Types.ObjectId | string;
  buyerId: mongoose.Types.ObjectId | string;
  agreedAmountPoisha?: number;
  status?: string;
}) {
  return Order.create({
    listingId: opts.listingId,
    bidId: opts.bidId ?? new mongoose.Types.ObjectId(),
    farmerId: opts.farmerId,
    buyerId: opts.buyerId,
    cropSlug: 'rice',
    quantityKg: 500,
    agreedAmountPoisha: opts.agreedAmountPoisha ?? 150_000,
    status: opts.status ?? 'awaiting_payment',
    paymentDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
    statusHistory: [],
  });
}

export async function makePayment(opts: {
  orderId: mongoose.Types.ObjectId | string;
  buyerId: mongoose.Types.ObjectId | string;
  farmerId: mongoose.Types.ObjectId | string;
  amountPoisha?: number;
  commissionPoisha?: number;
  status?: string;
  tranId?: string;
  bankTranId?: string;
}) {
  const amount = opts.amountPoisha ?? 150_000;
  const commission = opts.commissionPoisha ?? Math.floor((amount * 250) / 10_000);

  return Payment.create({
    orderId: opts.orderId,
    buyerId: opts.buyerId,
    farmerId: opts.farmerId,
    amountPoisha: amount,
    commissionPoisha: commission,
    farmerNetPoisha: amount - commission,
    status: opts.status ?? 'held',
    tranId: opts.tranId ?? `TEST-${counter++}-${Date.now()}`,
    bankTranId: opts.bankTranId ?? 'BANK-TEST-1',
    heldAt: new Date(),
  });
}

export { Bid, Listing, Order, Payment, User, Crop };
