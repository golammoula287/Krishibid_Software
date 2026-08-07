import { z } from 'zod';

/**
 * Asking about the marketplace itself, rather than about farming.
 *
 * Public: what things cost is the single most useful thing this platform knows, and putting it
 * behind a login means somebody deciding whether to register cannot see the one number that
 * would persuade them.
 */
export const askMarketSchema = z.object({
  question: z.string().trim().min(2).max(500),
});
export type AskMarketInput = z.infer<typeof askMarketSchema>;

export interface MarketSnapshotDto {
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
  totals: {
    liveListings: number;
    auctions: number;
    fixed: number;
    suppliers: number;
    districts: number;
  };
}

export interface MarketAnswerDto {
  answer: string;
  /** What the answer was based on, so the UI can show it rather than ask for trust. */
  snapshot: MarketSnapshotDto;
  degraded: boolean;
}
