import type { Request, Response } from 'express';
import * as market from '../services/market.service.js';

export async function ask(req: Request, res: Response): Promise<void> {
  res.json(await market.askMarket(req.body.question));
}

/** The raw figures, for anybody who wants the numbers without the prose. */
export async function snapshot(_req: Request, res: Response): Promise<void> {
  res.json(await market.marketSnapshot());
}
