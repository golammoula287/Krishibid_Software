import type { ListingPhotoUploadResult } from '@krishibid/shared';
import type { Request, Response } from 'express';
import sharp from 'sharp';
import { badRequest } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import * as bidService from '../services/bid.service.js';
import { sniffImage } from '../utils/image.js';
import * as listingService from '../services/listing.service.js';
import { uploadImage } from '../services/storage.service.js';
import { emitToListing, emitToUser } from '../sockets/index.js';

// ---- listings -------------------------------------------------------------

export async function listListings(req: Request, res: Response): Promise<void> {
  res.json(await listingService.listListings(req.query as never));
}

export async function getListing(req: Request, res: Response): Promise<void> {
  res.json(await listingService.getListing(String(req.params.id)));
}

export async function myListings(req: Request, res: Response): Promise<void> {
  res.json(await listingService.listMyListings(req.user!.id));
}

export async function createListing(req: Request, res: Response): Promise<void> {
  res.status(201).json(await listingService.createListing(req.user!.id, req.body));
}

export async function updateListing(req: Request, res: Response): Promise<void> {
  res.json(await listingService.updateListing(req.user!.id, String(req.params.id), req.body));
}

export async function cancelListing(req: Request, res: Response): Promise<void> {
  await listingService.cancelListing(req.user!.id, String(req.params.id));
  res.status(204).send();
}

/**
 * Photographs of a lot, uploaded before the listing exists.
 *
 * Separate from creating the listing on purpose. A supplier on a rural connection uploads several
 * megabytes of photographs over tens of seconds, and folding that into the create request would
 * mean a failure halfway loses the description they laboured over. Here the pictures land first
 * and the form carries only their URLs, so a failed upload costs one retry of one photo.
 *
 * Every file is re-encoded before it leaves us. That strips EXIF — which on a phone photograph
 * carries the GPS coordinates of the supplier's yard, published to every buyer who opens the
 * listing — and caps what we ever store against a shared free quota.
 */
export async function uploadListingPhotos(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    throw badRequest('no_image', 'attach at least one photo in the "photos" field');
  }

  for (const file of files) {
    if (!sniffImage(file.buffer)) {
      throw badRequest('bad_image', 'one of the files is not a valid JPEG, PNG or WebP');
    }
  }

  /**
   * Sequential, not `Promise.all`.
   *
   * Each sharp re-encode holds a decoded bitmap in memory, and five 5 MB photographs decoded at
   * once is tens of megabytes on a 512 MB dyno shared with the ONNX runtime. The upload is
   * already slower than the encode by an order of magnitude, so the parallelism would buy little
   * and risks the process being killed mid-request.
   */
  const urls: string[] = [];
  for (const file of files) {
    const normalised = await sharp(file.buffer)
      // `rotate()` with no argument applies the EXIF orientation before it is stripped —
      // without it, a photo taken in portrait arrives on its side.
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();

    urls.push(await uploadImage(normalised, `listings/${req.user!.id}`));
  }

  logger.info({ userId: req.user!.id, count: urls.length }, 'listing photos uploaded');

  const result: ListingPhotoUploadResult = { urls };
  res.status(201).json(result);
}

// ---- bids -----------------------------------------------------------------

export async function listBids(req: Request, res: Response): Promise<void> {
  res.json(await bidService.listBidsForListing(String(req.params.id)));
}

export async function myBids(req: Request, res: Response): Promise<void> {
  res.json(await bidService.listMyBids(req.user!.id));
}

/**
 * The same bids with their lots attached, for the buyer's own bidding screen.
 *
 * A separate endpoint rather than a flag on the one above: the plain list is used where the
 * listing is already on screen, and joining it there would be work thrown away.
 */
export async function myBidsDetailed(req: Request, res: Response): Promise<void> {
  res.json(await bidService.listMyBidsDetailed(req.user!.id));
}

/** Buying at the listed price. The auction equivalent is placeBid below. */
export async function buyNow(req: Request, res: Response): Promise<void> {
  res.status(201).json(await listingService.buyNow(req.user!.id, req.body));
}

export async function placeBid(req: Request, res: Response): Promise<void> {
  // Captured before the bid lands so we know who to notify about being displaced.
  const previousLeader = (await listingService.getListing(req.body.listingId)).highestBid;

  const result = await bidService.placeBid(req.user!.id, req.body);

  // Everyone watching this listing sees the new price immediately.
  emitToListing(result.listingId, 'bid:placed', {
    listingId: result.listingId,
    amountPoisha: result.amountPoisha,
    bidClosesAt: result.bidClosesAt.toISOString(),
    extended: result.extended,
  });

  // The displaced leader gets a private nudge — the single most useful notification
  // in an auction, and the reason bids keep coming.
  if (previousLeader && previousLeader.buyerId !== req.user!.id) {
    emitToUser(previousLeader.buyerId, 'bid:outbid', {
      listingId: result.listingId,
      newAmountPoisha: result.amountPoisha,
    });
  }

  res.status(201).json(result);
}

export async function acceptBid(req: Request, res: Response): Promise<void> {
  const result = await bidService.acceptBid(req.user!.id, req.body);

  emitToListing(result.listingId, 'listing:sold', { listingId: result.listingId });

  const listing = await listingService.getListing(result.listingId);
  if (listing.highestBid) {
    emitToUser(listing.highestBid.buyerId, 'bid:won', {
      orderId: result.orderId,
      listingId: result.listingId,
      amountPoisha: result.agreedAmountPoisha,
      paymentDeadline: result.paymentDeadline.toISOString(),
    });
  }

  res.status(201).json({
    ...result,
    paymentDeadline: result.paymentDeadline.toISOString(),
  });
}
