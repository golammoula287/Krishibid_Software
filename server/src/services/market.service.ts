import type { AiProvider } from './ai/index.js';
import { createAiProvider } from './ai/index.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { detectLocale } from './advisory.service.js';
import { Category } from '../models/Category.js';
import { Listing } from '../models/Listing.js';
import { Order } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';

/**
 * A market assistant grounded in the marketplace itself.
 *
 * The farming advisor answers from a knowledge base of agronomy. This answers from the database:
 * what is listed right now, what it costs, which auctions close today, what things actually sold
 * for. Those are different questions with different sources, and a single assistant guessing
 * which one you meant would answer both worse.
 *
 * Grounding here is not a knowledge base but a snapshot taken at the moment of asking. That is
 * the whole point — "what is the price of rice" has an answer that changes hourly, and any
 * pre-indexed corpus is stale before it is written. The model is given the rows and told to
 * report them; it is not asked to remember anything.
 */

let provider: AiProvider | null = null;

function ai(): AiProvider {
  if (provider) return provider;
  const e = env();
  provider = createAiProvider({
    provider: e.AI_PROVIDER,
    embeddingDimensions: e.EMBEDDING_DIMENSIONS,
    gemini: { apiKey: e.GEMINI_API_KEY, chatModel: e.GEMINI_CHAT_MODEL, embedModel: e.GEMINI_EMBED_MODEL },
    groq: { apiKey: e.GROQ_API_KEY, chatModel: e.GROQ_CHAT_MODEL },
    claude: { apiKey: e.ANTHROPIC_API_KEY, chatModel: e.CLAUDE_CHAT_MODEL },
  });
  return provider;
}

/** Injected by tests so they never reach a network. */
export function setMarketProvider(p: AiProvider | null): void {
  provider = p;
}

const taka = (poisha: number): string => `BDT ${Math.round(poisha / 100).toLocaleString('en-US')}`;

/**
 * Dates the model can repeat verbatim without embarrassing itself.
 *
 * The first version passed ISO strings and the answers quoted them — "closes
 * 2026-08-07T17:56:03.916Z" is not something you say to a farmer. Formatted here rather than in a
 * prompt instruction, because the reliable way to stop a model emitting something is to not give
 * it that something.
 */
const when = (iso: string): string => {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  const hours = Math.round((d.getTime() - Date.now()) / 3_600_000);
  const stamp = d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (hours < 0) return stamp;
  return hours < 48 ? `${stamp} (in about ${hours} hour${hours === 1 ? '' : 's'})` : stamp;
};

export interface MarketSnapshot {
  takenAt: string;
  categories: {
    name: string;
    slug: string;
    liveListings: number;
    lowPoisha: number;
    highPoisha: number;
    avgPoisha: number;
    unit: string;
  }[];
  closingSoon: { title: string; district: string; currentPoisha: number; closesAt: string }[];
  recentSales: { title: string; district: string; pricePoisha: number; at: string }[];
  totals: { liveListings: number; auctions: number; fixed: number; suppliers: number; districts: number };
}

/**
 * Everything the assistant is allowed to know, gathered in one round of parallel queries.
 *
 * Bounded on purpose. A snapshot of the whole database would not fit in a context window and
 * would cost a fortune per question; these are the aggregates that answer what people actually
 * ask — what does it cost, where, is there any, and what is about to close.
 */
export async function marketSnapshot(): Promise<MarketSnapshot> {
  const [priceRows, categories, closing, sold, suppliers, districts] = await Promise.all([
    // Price per unit is only meaningful in the fixed-price shop; an auction reserve is the least
    // a supplier will take for a whole lot, and averaging the two together is nonsense.
    Listing.aggregate<{ _id: string; low: number; high: number; avg: number; n: number; unit: string }>([
      { $match: { status: 'open', saleMode: 'fixed', pricePerUnitPoisha: { $gt: 0 } } },
      {
        $group: {
          _id: '$categorySlug',
          low: { $min: '$pricePerUnitPoisha' },
          high: { $max: '$pricePerUnitPoisha' },
          avg: { $avg: '$pricePerUnitPoisha' },
          n: { $sum: 1 },
          unit: { $first: '$unit' },
        },
      },
      { $sort: { n: -1 } },
      { $limit: 15 },
    ]),
    Category.find({ active: true }).select('slug names').lean(),
    Listing.find({ status: 'open', saleMode: 'auction', bidClosesAt: { $gte: new Date() } })
      .sort({ bidClosesAt: 1 })
      .limit(6)
      .select('title district reservePricePoisha highestBid bidClosesAt')
      .lean(),
    Order.find({ status: 'completed' })
      .sort({ updatedAt: -1 })
      .limit(8)
      .select('listingId agreedAmountPoisha quantityKg updatedAt')
      .lean(),
    User.countDocuments({ role: 'farmer', accountStatus: 'active' }),
    Listing.distinct('district', { status: 'open' }),
  ]);

  const nameOf = new Map(categories.map((c) => [c.slug, c.names?.en ?? c.slug]));

  const soldListings = await Listing.find({ _id: { $in: sold.map((o) => o.listingId) } })
    .select('title district')
    .lean();
  const soldMeta = new Map(soldListings.map((l) => [String(l._id), l]));

  const [auctions, fixed] = await Promise.all([
    Listing.countDocuments({ status: 'open', saleMode: 'auction' }),
    Listing.countDocuments({ status: 'open', saleMode: 'fixed' }),
  ]);

  return {
    takenAt: new Date().toISOString(),
    categories: priceRows.map((r) => ({
      slug: r._id,
      name: nameOf.get(r._id) ?? r._id,
      liveListings: r.n,
      lowPoisha: r.low,
      highPoisha: r.high,
      avgPoisha: Math.round(r.avg),
      unit: r.unit ?? 'kg',
    })),
    closingSoon: closing.map((l) => ({
      title: l.title,
      district: l.district,
      currentPoisha: l.highestBid?.amountPoisha ?? l.reservePricePoisha ?? 0,
      closesAt: l.bidClosesAt?.toISOString() ?? '',
    })),
    recentSales: sold.map((o) => ({
      title: soldMeta.get(String(o.listingId))?.title ?? '',
      district: soldMeta.get(String(o.listingId))?.district ?? '',
      pricePoisha: o.agreedAmountPoisha,
      at: (o as unknown as { updatedAt: Date }).updatedAt.toISOString(),
    })),
    totals: {
      liveListings: auctions + fixed,
      auctions,
      fixed,
      suppliers,
      districts: districts.length,
    },
  };
}

/** The snapshot as text the model reads. Plain lines, because a table wastes tokens on pipes. */
function asContext(snap: MarketSnapshot): string {
  const lines: string[] = [
    `MARKETPLACE SNAPSHOT taken ${when(snap.takenAt)}`,
    `${snap.totals.liveListings} lots live: ${snap.totals.auctions} on auction, ${snap.totals.fixed} at a fixed price, from ${snap.totals.suppliers} approved suppliers across ${snap.totals.districts} districts.`,
    '',
    'FIXED PRICES BY CATEGORY (per unit, live listings only):',
  ];

  for (const c of snap.categories) {
    lines.push(
      `- ${c.name}: ${c.liveListings} lots, ${taka(c.lowPoisha)}–${taka(c.highPoisha)} per ${c.unit}, average ${taka(c.avgPoisha)}`,
    );
  }
  if (snap.categories.length === 0) lines.push('- nothing listed at a fixed price right now');

  lines.push('', 'AUCTIONS CLOSING SOONEST:');
  for (const a of snap.closingSoon) {
    lines.push(`- ${a.title} (${a.district}) — currently ${taka(a.currentPoisha)}, closes ${when(a.closesAt)}`);
  }
  if (snap.closingSoon.length === 0) lines.push('- no open auctions');

  lines.push('', 'RECENTLY COMPLETED SALES (whole lot, not per unit):');
  for (const s of snap.recentSales) {
    lines.push(`- ${s.title} (${s.district}) — ${taka(s.pricePoisha)} on ${when(s.at)}`);
  }
  if (snap.recentSales.length === 0) lines.push('- no completed sales yet');

  return lines.join('\n');
}

const SYSTEM = `You are KrishiBid's market assistant. You answer questions about what is on the
marketplace right now, using ONLY the snapshot provided.

Rules, in order of importance:
1. Every number you give must come from the snapshot. Never estimate, never average across
   categories yourself unless asked, and never carry a figure over from general knowledge about
   Bangladeshi crop prices — the whole value of this answer is that it is today's real data.
2. If the snapshot does not contain the answer, say so plainly and suggest what the person could
   look at instead. Do not fill the gap.
3. Answer in the language named in the REPLY IN line below, and in no other. This is decided
   before you see the question; do not second-guess it.
4. Be short. Two or three sentences and the relevant figures. This is read on a phone.
5. Prices per unit and whole-lot sale prices are different things — never compare one to the
   other or present them in the same list without saying which is which.`;

export interface MarketAnswer {
  answer: string;
  /** So the UI can show what the answer was actually based on, rather than asking for trust. */
  snapshot: MarketSnapshot;
  degraded: boolean;
}

/**
 * Answers a question about the market from live data.
 *
 * Degrades to the snapshot itself when generation fails. That is a genuinely useful fallback here
 * in a way it would not be for the agronomy advisor: the numbers ARE the answer to most of these
 * questions, and a table of live prices with no prose around it still tells somebody what rice
 * costs today.
 */
export async function askMarket(question: string): Promise<MarketAnswer> {
  const snapshot = await marketSnapshot();
  const context = asContext(snapshot);

  try {
    const result = await ai().complete(`${context}\n\nQUESTION: ${question}\n\nANSWER:`, {
        system: SYSTEM,
        maxOutputTokens: 400,
        // Thinking tokens come out of the same budget, and this is a reporting task rather than
        // a reasoning one — the figures are already in front of it.
        disableThinking: true,
      },
    );

    logger.info(
      { tokens: result.usage.inputTokens + result.usage.outputTokens, categories: snapshot.categories.length },
      'market question answered',
    );

    return { answer: result.text.trim(), snapshot, degraded: false };
  } catch (err) {
    logger.warn({ err }, 'market assistant generation failed; returning the snapshot alone');
    return { answer: context, snapshot, degraded: true };
  }
}
