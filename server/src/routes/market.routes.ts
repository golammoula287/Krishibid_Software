import { askMarketSchema } from '@krishibid/shared';
import { Router } from 'express';
import * as controller from '../controllers/market.controller.js';
import { chatLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

/**
 * The market assistant, on its own router rather than inside the advisory one.
 *
 * `advisoryRoutes` gates everything behind `requireRole('farmer', 'admin')`, because Bangla
 * agronomy advice is for the people growing things. Market prices are the opposite: they are for
 * buyers most of all, and for somebody deciding whether to register at all. Hanging these off
 * that router would have made the most useful thing this platform knows invisible to the people
 * it is most useful to.
 *
 * Public, and rate-limited like the rest of the chat surface — an ungated model endpoint is
 * somebody else's bill.
 */
export const marketRoutes = Router();

marketRoutes.post('/ask', chatLimiter, validate(askMarketSchema), controller.ask);

/** The raw figures, for anybody who wants the numbers without the prose. */
marketRoutes.get('/snapshot', controller.snapshot);
