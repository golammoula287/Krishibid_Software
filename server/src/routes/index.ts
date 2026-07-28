import { Router, type Request, type Response } from 'express';
import { getMessages } from '../controllers/messages.controller.js';
import { Crop } from '../models/Crop.js';
import { advisoryRoutes } from './advisory.routes.js';
import { authRoutes } from './auth.routes.js';
import { diagnosisRoutes } from './diagnosis.routes.js';
import { marketplaceRoutes } from './marketplace.routes.js';
import { orderRoutes } from './order.routes.js';
import { paymentRoutes } from './payment.routes.js';

export const apiRoutes = Router();

apiRoutes.use('/auth', authRoutes);
apiRoutes.use('/marketplace', marketplaceRoutes);
apiRoutes.use('/orders', orderRoutes);
apiRoutes.use('/payments', paymentRoutes);
apiRoutes.use('/diagnosis', diagnosisRoutes);
apiRoutes.use('/advisory', advisoryRoutes);

/**
 * User-facing message catalogue. Server-authoritative so wording — Bangla especially, which
 * will need iteration with real users — changes without a client rebuild.
 */
apiRoutes.get('/messages', getMessages);

/** Crop catalogue — localisation as data, so the client never hardcodes crop names. */
apiRoutes.get('/crops', async (_req: Request, res: Response) => {
  res.json(await Crop.find().sort({ slug: 1 }).lean());
});
