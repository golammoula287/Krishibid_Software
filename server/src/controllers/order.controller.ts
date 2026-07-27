import type { Request, Response } from 'express';
import * as orderService from '../services/order.service.js';
import { markShipped } from '../services/payment.service.js';

export async function list(req: Request, res: Response): Promise<void> {
  res.json(await orderService.listOrdersForUser(req.user!.id));
}

export async function get(req: Request, res: Response): Promise<void> {
  res.json(await orderService.getOrderForUser(String(req.params.id), req.user!.id));
}

export async function ship(req: Request, res: Response): Promise<void> {
  const result = await markShipped(req.user!.id, req.body.orderId, req.body.courierNote);
  const order = await orderService.getOrderForUser(req.body.orderId, req.user!.id);
  res.json({ ...order, autoReleaseAt: result.autoReleaseAt });
}
