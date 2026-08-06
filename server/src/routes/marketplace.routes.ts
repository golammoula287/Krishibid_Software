import {
  acceptBidSchema,
  buyNowSchema,
  createListingSchema,
  listingQuerySchema,
  placeBidSchema,
} from '@krishibid/shared';
import { Router } from 'express';
import * as controller from '../controllers/marketplace.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { enforceBidCeiling, requireActiveAccount, requireApprovedFarmer } from '../middleware/gate.js';
import { validate } from '../middleware/validate.js';

export const marketplaceRoutes = Router();

// ---- listings ----
// `/listings/mine` is declared BEFORE `/listings/:id`, or Express would match
// "mine" as an id and the route would 400 on an invalid ObjectId.
marketplaceRoutes.get('/listings', validate(listingQuerySchema, 'query'), controller.listListings);
marketplaceRoutes.get('/listings/mine', requireAuth, controller.myListings);
marketplaceRoutes.get('/listings/:id', controller.getListing);
marketplaceRoutes.get('/listings/:id/bids', controller.listBids);

/**
 * Creating a listing requires an APPROVED farmer.
 *
 * Gated in middleware rather than only in the UI: hiding the button is presentation, and a
 * request straight to the API must be refused too or the requirement is decorative.
 */
marketplaceRoutes.post(
  '/listings',
  requireAuth,
  requireRole('farmer'),
  requireApprovedFarmer,
  validate(createListingSchema),
  controller.createListing,
);

marketplaceRoutes.delete(
  '/listings/:id',
  requireAuth,
  requireRole('farmer'),
  requireActiveAccount,
  controller.cancelListing,
);

/**
 * Buying at the listed price.
 *
 * Same gates as bidding: an active account and the buyer's tier ceiling, because a fixed-price
 * purchase commits exactly the same money as a winning bid and the ceiling exists to bound what
 * an unverified account can commit.
 */
marketplaceRoutes.post(
  '/buy',
  requireAuth,
  requireRole('buyer'),
  requireActiveAccount,
  validate(buyNowSchema),
  controller.buyNow,
);

// ---- bids ----
marketplaceRoutes.get('/bids/mine', requireAuth, controller.myBids);
// Declared before any '/bids/:id' would be, for the same reason as '/listings/mine'.
marketplaceRoutes.get('/bids/mine/detailed', requireAuth, controller.myBidsDetailed);

/**
 * Bidding is capped by the buyer's trust tier. Validation runs first so the ceiling check
 * sees a parsed integer amount rather than whatever arrived on the wire.
 */
marketplaceRoutes.post(
  '/bids',
  requireAuth,
  requireRole('buyer'),
  requireActiveAccount,
  validate(placeBidSchema),
  enforceBidCeiling,
  controller.placeBid,
);

marketplaceRoutes.post(
  '/bids/accept',
  requireAuth,
  requireRole('farmer'),
  validate(acceptBidSchema),
  controller.acceptBid,
);
