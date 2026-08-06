/**
 * Seeds demo data.
 *
 * Demo mode is a first-class feature, not a fixture: a recruiter opening the
 * public URL must see a populated, working marketplace within seconds, even if
 * every upstream free tier is throttled. That means realistic Bangladeshi
 * districts and crops, live auctions at various stages, and an order already in
 * escrow so the payment flow can be demonstrated without spending real money.
 *
 *   npm run seed
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../utils/db.js';
import { logger } from '../utils/logger.js';
import { bdtToPoisha } from '../utils/money.js';
import { Bid } from '../models/Bid.js';
import { Category } from '../models/Category.js';
import { Crop } from '../models/Crop.js';
import { Listing } from '../models/Listing.js';
import { Order } from '../models/Order.js';
import { OtpChallenge } from '../models/OtpChallenge.js';
import { Payment } from '../models/Payment.js';
import { PendingRegistration } from '../models/PendingRegistration.js';
import { User } from '../models/User.js';
import { CATEGORIES } from './categories.js';

const CROPS = [
  { slug: 'rice', names: { bn: 'ধান', en: 'Rice' }, seasons: ['Aman', 'Boro'], hasDiseaseModel: true },
  { slug: 'potato', names: { bn: 'আলু', en: 'Potato' }, seasons: ['Rabi'], hasDiseaseModel: true },
  { slug: 'tomato', names: { bn: 'টমেটো', en: 'Tomato' }, seasons: ['Rabi'], hasDiseaseModel: true },
  { slug: 'jute', names: { bn: 'পাট', en: 'Jute' }, seasons: ['Kharif'], hasDiseaseModel: false },
  { slug: 'wheat', names: { bn: 'গম', en: 'Wheat' }, seasons: ['Rabi'], hasDiseaseModel: false },
  { slug: 'maize', names: { bn: 'ভুট্টা', en: 'Maize' }, seasons: ['Rabi'], hasDiseaseModel: false },
  { slug: 'onion', names: { bn: 'পেঁয়াজ', en: 'Onion' }, seasons: ['Rabi'], hasDiseaseModel: false },
  { slug: 'lentil', names: { bn: 'মসুর ডাল', en: 'Lentil' }, seasons: ['Rabi'], hasDiseaseModel: false },
  { slug: 'mango', names: { bn: 'আম', en: 'Mango' }, seasons: ['Summer'], hasDiseaseModel: false },
  { slug: 'chili', names: { bn: 'মরিচ', en: 'Chili' }, seasons: ['Rabi'], hasDiseaseModel: false },
];

const DISTRICTS = [
  'Dhaka', 'Rangpur', 'Bogura', 'Rajshahi', 'Khulna', 'Jashore',
  'Cumilla', 'Mymensingh', 'Sylhet', 'Dinajpur', 'Faridpur', 'Barishal',
];

const FARMER_NAMES = [
  'আব্দুল করিম', 'মোহাম্মদ রফিক', 'শাহিদা বেগম', 'নূর ইসলাম',
  'ফাতেমা খাতুন', 'জসিম উদ্দিন', 'রোকেয়া বেগম', 'হাবিবুর রহমান',
];
const BUYER_NAMES = [
  'করিম ট্রেডার্স', 'ঢাকা এগ্রো লিমিটেড', 'নর্থ বেঙ্গল ফুডস', 'গ্রিন হারভেস্ট বিডি',
];

const pick = <T>(arr: readonly T[], i: number): T => arr[i % arr.length]!;
const randInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * The named accounts, with the passwords an operator actually logs in with.
 *
 * Real addresses rather than `@krishibid.invalid` placeholders, because these are the accounts a
 * person signs in as — and login now accepts an email or a phone number, so the address IS the
 * credential they will type.
 *
 * The password is deliberately weak and deliberately shared: these exist to be handed to somebody
 * evaluating the platform. Anything on a public deployment with real money in it needs different
 * credentials, and the README says so rather than leaving it implied.
 */
const ACCOUNTS = {
  superAdmin: {
    email: 'rakibmoula2001@gmail.com',
    phone: '01700000001',
    name: 'Rakib Moula',
    role: 'superadmin' as const,
  },
  admin: {
    email: 'gmrakib2001@gmail.com',
    phone: '01700000002',
    name: 'GM Rakib',
    role: 'admin' as const,
  },
  supplier: {
    email: 'suplier@gmail.com',
    phone: '01700000003',
    name: 'ডেমো সরবরাহকারী (Demo Supplier)',
    role: 'farmer' as const,
  },
  buyer: {
    email: 'buyer@gmail.com',
    phone: '01700000004',
    name: 'ডেমো ক্রেতা (Demo Buyer)',
    role: 'buyer' as const,
  },
};

const ACCOUNT_PASSWORD = '12345678';

async function seed(): Promise<void> {
  await connectDb();

  const password = env().DEMO_PASSWORD || 'demo1234';
  const passwordHash = await bcrypt.hash(password, env().BCRYPT_ROUNDS);
  const accountHash = await bcrypt.hash(ACCOUNT_PASSWORD, env().BCRYPT_ROUNDS);

  /**
   * Every seeded user needs an email, because `users.email` is now required and unique — a
   * batch of nulls would fail the unique index outright.
   *
   * These are `@krishibid.invalid` on purpose: `.invalid` is reserved by RFC 2606 and can never
   * be registered, so a stray notification to a demo account cannot reach a real stranger.
   */
  const demoEmail = (slug: string): string => `${slug}@krishibid.invalid`;

  /**
   * A full wipe, not a demo-only one.
   *
   * The previous version deleted `isDemo: true` and left everything else, which is right for
   * topping up a live database and wrong for the thing this is now used for — starting clean.
   * Half-migrated users and orphaned listings from earlier schema versions are exactly what makes
   * "it works locally" untrue later.
   *
   * Everything below is dropped: users, listings, bids, orders, payments, ledger entries, pending
   * registrations, OTP challenges. Blog posts and contact messages are kept — they are content
   * somebody wrote, not fixtures.
   */
  logger.warn('WIPING the database — every user, listing, bid, order and payment');
  await Promise.all([
    User.deleteMany({}),
    Crop.deleteMany({}),
    Category.deleteMany({}),
    Listing.deleteMany({}),
    Bid.deleteMany({}),
    Order.deleteMany({}),
    Payment.deleteMany({}),
    PendingRegistration.deleteMany({}),
    OtpChallenge.deleteMany({}),
  ]);

  /**
   * The ledger is dropped through the driver, deliberately going around its own guard.
   *
   * `LedgerEntry` refuses `deleteMany` — entries are immutable and a mistake is corrected with a
   * compensating entry, never by erasing history. That guard is right and stays: it protects the
   * application from itself, and every code path that touches money goes through the model.
   *
   * A seed is not that. It is an operator deliberately discarding a database, and leaving the
   * ledger behind would be worse than removing it — double-entry rows referencing payments and
   * users that no longer exist, which is a corrupt ledger rather than a preserved one. Bypassing
   * the model here is explicit and confined to this line, rather than the guard being weakened
   * for everybody.
   */
  const db = mongoose.connection.db;
  if (db) {
    const dropped = await db.collection('ledgerentries').deleteMany({});
    logger.warn({ deleted: dropped.deletedCount }, 'ledger discarded with the rest of the data');
  }

  /**
   * Indexes rebuilt after the wipe.
   *
   * A database that has been through several schema versions carries indexes for fields that no
   * longer exist, and is missing the ones added since. `syncIndexes` reconciles both, which is
   * what makes a fresh seed genuinely fresh rather than merely empty.
   */
  await Promise.all([
    User.syncIndexes(),
    Listing.syncIndexes(),
    Order.syncIndexes(),
    Category.syncIndexes(),
  ]);
  logger.info('indexes rebuilt');

  // ---- crops ----
  await Crop.insertMany(CROPS.map((c) => ({ ...c, unit: 'kg' })));
  logger.info({ count: CROPS.length }, 'crops seeded');

  // ---- categories: what the marketplace can sell at all ----
  for (const category of CATEGORIES) {
    await Category.updateOne(
      { slug: category.slug },
      { $set: category, $setOnInsert: { active: true } },
      { upsert: true },
    );
  }
  logger.info({ count: CATEGORIES.length }, 'categories seeded');

  // ---- the four named accounts, which are what somebody actually logs in as ----
  const [superAdmin, secondAdmin, demoFarmer, demoBuyer] = await User.create([
    {
      ...ACCOUNTS.superAdmin,
      emailVerified: true,
      passwordHash: accountHash,
      district: 'Dhaka',
      locale: 'en',
      accountStatus: 'active',
      isDemo: true,
    },
    {
      ...ACCOUNTS.admin,
      emailVerified: true,
      passwordHash: accountHash,
      district: 'Dhaka',
      locale: 'en',
      accountStatus: 'active',
      isDemo: true,
    },
    {
      ...ACCOUNTS.supplier,
      emailVerified: true,
      passwordHash: accountHash,
      district: 'Rangpur',
      locale: 'bn',
      isDemo: true,
      /**
       * Seeded already approved.
       *
       * Somebody opening the deployment must reach a working marketplace, and a demo supplier who
       * cannot list produce because no admin reviewed them would look like a broken app rather
       * than a policy. Real suppliers still go through the queue — this account is created by an
       * operator with database access, not through signup.
       */
      accountStatus: 'active',
      supplierType: 'farmer',
      kyc: {
        status: 'approved',
        fullNameOnNid: 'Demo Supplier',
        documents: [],
        submittedAt: new Date(),
        decidedAt: new Date(),
        attempts: 1,
      },
      farmSizeAcres: 2.5,
      cropsGrown: ['rice', 'potato'],
    },
    {
      ...ACCOUNTS.buyer,
      emailVerified: true,
      passwordHash: accountHash,
      district: 'Dhaka',
      locale: 'bn',
      accountStatus: 'active',
      isDemo: true,
      businessName: 'ডেমো ট্রেডার্স',
      buyerType: 'trader',
    },
  ]);

  /**
   * One supplier left waiting on purpose.
   *
   * The review queue is the first thing an admin is shown, and an empty one tells them nothing
   * about whether it works. This account gives them something to approve or reject.
   */
  await User.create({
    phone: '01700000005',
    email: 'pending-supplier@krishibid.invalid',
    emailVerified: false,
    name: 'অপেক্ষমাণ সরবরাহকারী (Pending Supplier)',
    passwordHash: accountHash,
    role: 'farmer',
    district: 'Bogura',
    locale: 'bn',
    isDemo: true,
    accountStatus: 'pending_approval',
    supplierType: 'retailer',
    kyc: {
      status: 'pending_review',
      fullNameOnNid: 'Pending Supplier',
      documents: [],
      submittedAt: new Date(),
      attempts: 1,
    },
    farmSizeAcres: 1.5,
    cropsGrown: ['onion'],
  });

  // ---- supporting cast, so the marketplace doesn't look like one person ----
  const farmers = await User.create(
    FARMER_NAMES.map((name, i) => ({
      phone: `0171000${String(1000 + i).slice(0, 4)}`,
      email: demoEmail(`farmer-${i + 1}`),
      emailVerified: true,
      name,
      passwordHash,
      role: 'farmer' as const,
      district: pick(DISTRICTS, i),
      locale: 'bn' as const,
      isDemo: true,
      // Approved for the same reason as the demo farmer: their listings are the marketplace.
      accountStatus: 'active' as const,
      // A spread of seller kinds, so the badge on a listing is visibly doing something.
      supplierType: (['farmer', 'farm_owner', 'retailer', 'trader'] as const)[i % 4],
      kyc: { status: 'approved' as const, documents: [], decidedAt: new Date(), attempts: 1 },
    })),
  );

  const buyers = await User.create(
    BUYER_NAMES.map((name, i) => ({
      phone: `0172000${String(2000 + i).slice(0, 4)}`,
      email: demoEmail(`buyer-${i + 1}`),
      emailVerified: true,
      name,
      passwordHash,
      role: 'buyer' as const,
      district: pick(DISTRICTS, i + 3),
      locale: 'bn' as const,
      isDemo: true,
    })),
  );

  const allFarmers = [demoFarmer!, ...farmers];
  const allBuyers = [demoBuyer!, ...buyers];

  // ---- listings across a spread of states ----
  const listings = [];
  for (let i = 0; i < 40; i++) {
    const crop = pick(CROPS, i);
    const farmer = pick(allFarmers, i);
    const quantityKg = randInt(2, 40) * 50;
    const pricePerKg = randInt(20, 120);

    // A deliberate mix: most open with a comfortable window, a few closing within
    // minutes so the countdown and anti-snipe behaviour are visible on the demo.
    const closingSoon = i % 9 === 0;
    const hours = closingSoon ? 0.05 : randInt(6, 72);

    listings.push({
      farmerId: farmer._id,
      categorySlug: 'crops',
      title: `${crop.names.en} — ${farmer.district}`,
      quantity: quantityKg,
      unit: 'kg' as const,
      // Roughly a third of the demo market is fixed price, so both shops have stock.
      saleMode: (i % 3 === 0 ? 'fixed' : 'auction') as 'auction' | 'fixed',
      qualityGrade: pick(['A', 'B', 'C'] as const, i),
      district: farmer.district,
      reservePricePoisha: bdtToPoisha(quantityKg * pricePerKg),
      description: `${crop.names.bn} — ${farmer.district} থেকে সরাসরি। গ্রেড ${pick(['A', 'B', 'C'] as const, i)}।`,
      status: 'open' as const,
      bidClosesAt: new Date(Date.now() + hours * 60 * 60 * 1000),
      pricePerUnitPoisha: bdtToPoisha(pricePerKg),
      stock: quantityKg,
      version: 0,
    });
  }

  const created = await Listing.insertMany(listings);
  logger.info({ count: created.length }, 'listings seeded');

  // ---- bids on roughly two thirds of the lots ----
  let bidCount = 0;
  for (const [i, listing] of created.entries()) {
    if (i % 3 === 0) continue;

    const rounds = randInt(1, 4);
    let current = listing.reservePricePoisha;
    let leader: { bidId: mongoose.Types.ObjectId; buyerId: mongoose.Types.ObjectId } | null = null;

    for (let r = 0; r < rounds; r++) {
      const buyer = pick(allBuyers, i + r);
      if (String(buyer._id) === String(listing.farmerId)) continue;

      current += bdtToPoisha(randInt(50, 400));
      const bid = await Bid.create({
        listingId: listing._id,
        buyerId: buyer._id,
        amountPoisha: current,
        status: 'active',
      });

      if (leader) await Bid.findByIdAndUpdate(leader.bidId, { status: 'outbid' });
      leader = { bidId: bid._id as mongoose.Types.ObjectId, buyerId: buyer._id as mongoose.Types.ObjectId };
      bidCount++;
    }

    if (leader) {
      await Listing.findByIdAndUpdate(listing._id, {
        highestBid: {
          bidId: leader.bidId,
          buyerId: leader.buyerId,
          amountPoisha: current,
          at: new Date(),
        },
        bidCount: rounds,
        $inc: { version: rounds },
      });
    }
  }
  logger.info({ bidCount }, 'bids seeded');

  // ---- one order awaiting payment, so the demo buyer has something to pay for ----
  const payable = created.find(
    (l) => String(l.farmerId) !== String(demoBuyer!._id),
  );
  if (payable) {
    const bid = await Bid.create({
      listingId: payable._id,
      buyerId: demoBuyer!._id,
      amountPoisha: payable.reservePricePoisha + bdtToPoisha(500),
      status: 'won',
    });

    await Listing.findByIdAndUpdate(payable._id, { status: 'sold', $inc: { version: 1 } });

    await Order.create({
      listingId: payable._id,
      bidId: bid._id,
      farmerId: payable.farmerId,
      buyerId: demoBuyer!._id,
      cropSlug: payable.categorySlug,
      quantityKg: payable.quantity,
      agreedAmountPoisha: bid.amountPoisha,
      status: 'awaiting_payment',
      paymentDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
      statusHistory: [
        {
          status: 'awaiting_payment',
          at: new Date(),
          by: payable.farmerId,
          note: 'seeded: bid accepted, awaiting escrow payment',
        },
      ],
    });
    logger.info('seeded one order awaiting payment for the demo buyer');
  }

  logger.info(
    {
      accountPassword: ACCOUNT_PASSWORD,
      supplier: demoFarmer!.email,
      buyer: demoBuyer!.email,
      superAdmin: superAdmin!.email,
      admin: secondAdmin!.email,
    },
    'seed complete — demo logins ready',
  );

  await disconnectDb();
}

seed().catch((err) => {
  logger.fatal({ err }, 'seed failed');
  process.exit(1);
});
