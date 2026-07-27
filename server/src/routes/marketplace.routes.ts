import {
  acceptBidSchema,
  createListingSchema,
  listingQuerySchema,
  placeBidSchema,
} from '@krishibid/shared';
import { Router } from 'express';
import * as controller from '../controllers/marketplace.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const marketplaceRoutes = Router();

// ---- listings ----
// `/listings/mine` is declared BEFORE `/listings/:id`, or Express would match
// "mine" as an id and the route would 400 on an invalid ObjectId.
marketplaceRoutes.get('/listings', validate(listingQuerySchema, 'query'), controller.listListings);
marketplaceRoutes.get('/listings/mine', requireAuth, controller.myListings);
marketplaceRoutes.get('/listings/:id', controller.getListing);
marketplaceRoutes.get('/listings/:id/bids', controller.listBids);

marketplaceRoutes.post(
  '/listings',
  requireAuth,
  requireRole('farmer'),
  validate(createListingSchema),
  controller.createListing,
);

marketplaceRoutes.delete(
  '/listings/:id',
  requireAuth,
  requireRole('farmer'),
  controller.cancelListing,
);

// ---- bids ----
marketplaceRoutes.get('/bids/mine', requireAuth, controller.myBids);

marketplaceRoutes.post(
  '/bids',
  requireAuth,
  requireRole('buyer'),
  validate(placeBidSchema),
  controller.placeBid,
);

marketplaceRoutes.post(
  '/bids/accept',
  requireAuth,
  requireRole('farmer'),
  validate(acceptBidSchema),
  controller.acceptBid,
);
