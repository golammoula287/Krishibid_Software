import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { Bid } from '../models/Bid.js';
import { Crop } from '../models/Crop.js';
import { Listing } from '../models/Listing.js';
import { Order } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';

let counter = 0;
const nextPhone = (): string => `018${String(10_000_000 + counter++).slice(0, 8)}`;

export interface MakeUserOptions {
  name?: string;
  email?: string;
  emailVerified?: boolean;
  accountStatus?: 'active' | 'pending_approval' | 'rejected' | 'suspended';
}

/** The password every fixture user has, for tests that actually log in. */
export const FIXTURE_PASSWORD = 'password123';

/**
 * Hashed once per run, at cost 10, and reused for every fixture.
 *
 * The previous version pasted a literal hash with a comment claiming it was "password123". It
 * was not a hash of anything — no test had ever logged in with a fixture user, so nothing caught
 * it. Hashing once here costs a few milliseconds for the whole suite and cannot drift.
 */
const FIXTURE_PASSWORD_HASH = bcrypt.hashSync(FIXTURE_PASSWORD, 10);

export async function makeUser(
  role: 'farmer' | 'buyer' | 'admin' = 'buyer',
  options: MakeUserOptions | string = {},
) {
  // A bare string is still accepted for the name — the older call sites read fine that way.
  const opts: MakeUserOptions = typeof options === 'string' ? { name: options } : options;
  const n = counter;

  return User.create({
    phone: nextPhone(),
    // Required and unique on the model now, so every fixture needs one.
    email: opts.email ?? `${role}-${n}-${Date.now()}@example.test`,
    emailVerified: opts.emailVerified ?? true,
    accountStatus: opts.accountStatus ?? 'active',
    name: opts.name ?? `${role}-${n}`,
    passwordHash: FIXTURE_PASSWORD_HASH,
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
  /** Defaults to an auction, which is what almost every test is about. */
  saleMode?: 'auction' | 'fixed';
  pricePerUnitPoisha?: number;
  stock?: number;
}

export async function makeListing(opts: MakeListingOptions) {
  await makeCrop();
  const saleMode = opts.saleMode ?? 'auction';

  return Listing.create({
    farmerId: opts.farmerId,
    categorySlug: 'crops',
    title: 'BR-28 rice',
    quantity: 500,
    unit: 'kg',
    qualityGrade: 'A',
    district: 'Dhaka',
    status: opts.status ?? 'open',
    saleMode,
    version: 0,
    ...(saleMode === 'auction'
      ? {
          reservePricePoisha: opts.reservePricePoisha ?? 100_000, // 1,000 BDT
          bidClosesAt: new Date(Date.now() + (opts.closesInMs ?? 60 * 60 * 1000)),
        }
      : {
          pricePerUnitPoisha: opts.pricePerUnitPoisha ?? 200, // 2 BDT per kg
          stock: opts.stock ?? 500,
        }),
  });
}

/** The category catalogue a listing needs to exist against. */
export async function makeCategory(slug = 'crops') {
  const { Category } = await import('../models/Category.js');
  return Category.findOneAndUpdate(
    { slug },
    {
      slug,
      names: { bn: 'ফসল', en: 'Crops' },
      units: ['kg', 'maund', 'sack'],
      active: true,
      order: 10,
    },
    { upsert: true, new: true },
  );
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
