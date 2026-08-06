import type { Request, Response } from 'express';
import * as reviewService from '../services/review.service.js';

export async function supplierProfile(req: Request, res: Response): Promise<void> {
  res.json(await reviewService.getSupplierProfile(String(req.params.id)));
}

export async function reviewableOrders(req: Request, res: Response): Promise<void> {
  res.json(await reviewService.listReviewableOrders(req.user!.id));
}

export async function createReview(req: Request, res: Response): Promise<void> {
  res.status(201).json(await reviewService.createReview(req.user!.id, req.body));
}
