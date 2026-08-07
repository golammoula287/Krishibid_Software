import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  MAX_LISTING_PHOTOS,
  acceptBidSchema,
  buyNowSchema,
  createListingSchema,
  listingQuerySchema,
  placeBidSchema,
  updateListingSchema,
} from '@krishibid/shared';
import { Router } from 'express';
import multer from 'multer';
import * as controller from '../controllers/marketplace.controller.js';
import { badRequest } from '../utils/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { enforceBidCeiling, requireActiveAccount, requireApprovedFarmer } from '../middleware/gate.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

/** Memory storage: photos are re-encoded and forwarded to Cloudinary, never written to disk. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_LISTING_PHOTOS },
  fileFilter: (_req, file, cb) => {
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.mimetype)) {
      cb(badRequest('bad_image_type', `image must be one of: ${ALLOWED_IMAGE_MIME.join(', ')}`));
      return;
    }
    cb(null, true);
  },
});

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

/**
 * Photographs for a lot.
 *
 * Behind the same gate as creating one — an unapproved supplier uploading images would be filling
 * a shared Cloudinary quota with pictures for a listing they are not allowed to publish.
 *
 * Declared before `/listings/:id` matters not at all here (the method differs), but the file limit
 * does: multer enforces `MAX_LISTING_PHOTOS` before a single byte is buffered, so an oversized
 * request is refused rather than read into a 512 MB dyno and then rejected.
 */
marketplaceRoutes.post(
  '/listings/photos',
  requireAuth,
  requireRole('farmer'),
  requireApprovedFarmer,
  uploadLimiter,
  upload.array('photos', MAX_LISTING_PHOTOS),
  controller.uploadListingPhotos,
);

/**
 * Editing your own lot. `requireApprovedFarmer` as well as ownership: an account suspended after
 * it listed something must not be able to keep rewriting what is on the shelf.
 */
marketplaceRoutes.patch(
  '/listings/:id',
  requireAuth,
  requireRole('farmer'),
  requireApprovedFarmer,
  validate(updateListingSchema),
  controller.updateListing,
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
