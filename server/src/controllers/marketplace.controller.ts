import type { Request, Response } from 'express';
import * as bidService from '../services/bid.service.js';
import * as listingService from '../services/listing.service.js';
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

export async function cancelListing(req: Request, res: Response): Promise<void> {
  await listingService.cancelListing(req.user!.id, String(req.params.id));
  res.status(204).send();
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
