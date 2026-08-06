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

async function seed(): Promise<void> {
  await connectDb();

  const password = env().DEMO_PASSWORD || 'demo1234';
  const passwordHash = await bcrypt.hash(password, env().BCRYPT_ROUNDS);

  /**
   * Every seeded user needs an email, because `users.email` is now required and unique — a
   * batch of nulls would fail the unique index outright.
   *
   * These are `@krishibid.invalid` on purpose: `.invalid` is reserved by RFC 2606 and can never
   * be registered, so a stray notification to a demo account cannot reach a real stranger.
   */
  const demoEmail = (slug: string): string => `${slug}@krishibid.invalid`;

  /**
   * The admin's address comes from the environment, never from the source.
   *
   * This repository is public. A personal Gmail committed into it gets scraped permanently, and
   * rewriting history later does not un-scrape it. Without the variable the admin still gets a
   * placeholder so the seed runs — it simply receives nothing.
   */
  const adminEmail = env().ADMIN_NOTIFY_EMAIL || demoEmail('admin');

  logger.info('clearing previous demo data');
  await Promise.all([
    User.deleteMany({ isDemo: true }),
    Crop.deleteMany({}),
    Listing.deleteMany({}),
    Bid.deleteMany({}),
    Order.deleteMany({}),
  ]);

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

  // ---- the three one-click demo logins ----
  const [demoFarmer, demoBuyer, demoAdmin] = await User.create([
    {
      phone: '01700000001',
      email: demoEmail('farmer'),
      emailVerified: true,
      name: 'ডেমো কৃষক (Demo Farmer)',
      passwordHash,
      role: 'farmer',
      district: 'Rangpur',
      locale: 'bn',
      isDemo: true,
      /**
       * Seeded already approved.
       *
       * Demo mode is a first-class feature: someone opening the public URL must reach a working
       * marketplace, and a demo farmer who cannot list produce because an admin never reviewed
       * them would look like a broken app rather than a policy. Real farmers still go through
       * the queue — this account is created by an operator with database access, not by signup.
       */
      accountStatus: 'active',
      supplierType: 'farmer',
      kyc: {
        status: 'approved',
        fullNameOnNid: 'Demo Farmer',
        documents: [],
        submittedAt: new Date(),
        decidedAt: new Date(),
        attempts: 1,
      },
      farmSizeAcres: 2.5,
      cropsGrown: ['rice', 'potato'],
    },
    {
      phone: '01700000002',
      email: demoEmail('buyer'),
      emailVerified: true,
      name: 'ডেমো ক্রেতা (Demo Buyer)',
      passwordHash,
      role: 'buyer',
      district: 'Dhaka',
      locale: 'bn',
      isDemo: true,
      businessName: 'ডেমো ট্রেডার্স',
      buyerType: 'trader',
    },
    {
      phone: '01700000003',
      email: adminEmail,
      emailVerified: true,
      name: 'Demo Officer',
      passwordHash,
      /**
       * The first super admin, and the only way one comes into existence.
       *
       * No endpoint creates or promotes to `superadmin` — the application can appoint an admin
       * (super admin only) but never another super admin. That is deliberate: the account that
       * decides who holds power should require database or deploy access to create, not a
       * session.
       */
      role: 'superadmin',
      district: 'Dhaka',
      locale: 'en',
      isDemo: true,
    },
  ]);

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
      cropSlug: crop.slug,
      quantityKg,
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
      cropSlug: payable.cropSlug,
      quantityKg: payable.quantityKg,
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
      demoPassword: password,
      farmer: demoFarmer!.phone,
      buyer: demoBuyer!.phone,
      admin: demoAdmin!.phone,
      adminRole: demoAdmin!.role,
    },
    'seed complete — demo logins ready',
  );

  await disconnectDb();
}

seed().catch((err) => {
  logger.fatal({ err }, 'seed failed');
  process.exit(1);
});
