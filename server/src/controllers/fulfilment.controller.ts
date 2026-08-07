import type { ClaimStatus } from '@krishibid/shared';
import type { Request, Response } from 'express';
import * as fulfilment from '../services/fulfilment.service.js';

// ---- delivery pipeline (admin) ----

export async function advanceDelivery(req: Request, res: Response): Promise<void> {
  await fulfilment.advanceDelivery(req.user!.id, String(req.params.orderId), req.body);
  res.status(204).send();
}

// ---- claims ----

export async function createClaim(req: Request, res: Response): Promise<void> {
  res.status(201).json(await fulfilment.createClaim(req.user!.id, req.body));
}

export async function myClaims(req: Request, res: Response): Promise<void> {
  res.json(await fulfilment.listClaimsForBuyer(req.user!.id));
}

export async function adminClaims(req: Request, res: Response): Promise<void> {
  const { status } = req.query as { status?: ClaimStatus };
  res.json(await fulfilment.listClaimsForAdmin(status));
}

export async function resolveClaim(req: Request, res: Response): Promise<void> {
  res.json(await fulfilment.resolveClaim(req.user!.id, String(req.params.id), req.body));
}

// ---- sales ----

export async function mySales(req: Request, res: Response): Promise<void> {
  res.json(await fulfilment.salesReport(req.user!.id));
}

/** Admin viewing any supplier's figures — same report, somebody else's id. */
export async function supplierSales(req: Request, res: Response): Promise<void> {
  res.json(await fulfilment.salesReport(String(req.params.id)));
}
