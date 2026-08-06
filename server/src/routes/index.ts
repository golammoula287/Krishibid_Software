import { Router, type Request, type Response } from 'express';
import { getMessages } from '../controllers/messages.controller.js';
import { Category } from '../models/Category.js';
import { Crop } from '../models/Crop.js';
import { accountRoutes } from './account.routes.js';
import { adminRoutes } from './admin.routes.js';
import { advisoryRoutes } from './advisory.routes.js';
import { authRoutes } from './auth.routes.js';
import { contentRoutes } from './content.routes.js';
import { diagnosisRoutes } from './diagnosis.routes.js';
import { marketplaceRoutes } from './marketplace.routes.js';
import { orderRoutes } from './order.routes.js';
import { paymentRoutes } from './payment.routes.js';
import { reviewRoutes } from './review.routes.js';

export const apiRoutes = Router();

apiRoutes.use('/auth', authRoutes);
apiRoutes.use('/account', accountRoutes);
apiRoutes.use('/marketplace', marketplaceRoutes);
apiRoutes.use('/orders', orderRoutes);
apiRoutes.use('/payments', paymentRoutes);
apiRoutes.use('/diagnosis', diagnosisRoutes);
apiRoutes.use('/advisory', advisoryRoutes);
/** Blog and contact — the parts of the site written by people rather than by the marketplace. */
apiRoutes.use('/content', contentRoutes);
/** Operator tooling: the overview, the dispatch board, users and administrators. */
apiRoutes.use('/admin', adminRoutes);
/**
 * Supplier profiles and the reviews on them. Mounted at the root rather than under a prefix
 * because it owns two unrelated nouns — `/suppliers/:id` and `/reviews` — and nesting either
 * under the other would misdescribe it.
 */
apiRoutes.use('/', reviewRoutes);

/**
 * User-facing message catalogue. Server-authoritative so wording — Bangla especially, which
 * will need iteration with real users — changes without a client rebuild.
 */
apiRoutes.get('/messages', getMessages);

/**
 * Category catalogue — what can be sold, and in which units.
 *
 * Data rather than an enum in the client, so adding a category is something an admin does from
 * the dashboard rather than something that waits for a redeploy.
 *
 * Active only. Deactivated categories still resolve for the listings already filed under them —
 * see `deactivateCategory` — but nothing new may be listed in one, so they do not belong here.
 */
apiRoutes.get('/categories', async (_req: Request, res: Response) => {
  res.json(await Category.find({ active: true }).sort({ order: 1 }).lean());
});

/** Crop catalogue — localisation as data, so the client never hardcodes crop names. */
apiRoutes.get('/crops', async (_req: Request, res: Response) => {
  res.json(await Crop.find().sort({ slug: 1 }).lean());
});
