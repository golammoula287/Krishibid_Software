import type { Role } from '@krishibid/shared';
import type { Request, Response } from 'express';
import * as adminService from '../services/admin.service.js';

export async function overview(_req: Request, res: Response): Promise<void> {
  res.json(await adminService.getOverview());
}

// ---- delivery ----

export async function deliveryQueue(req: Request, res: Response): Promise<void> {
  const { status } = req.query as { status?: 'awaiting_dispatch' | 'dispatched' };
  res.json(await adminService.listDeliveryQueue(status));
}

export async function assignDelivery(req: Request, res: Response): Promise<void> {
  await adminService.assignDelivery(req.user!.id, String(req.params.orderId), req.body);
  res.status(204).send();
}

// ---- users ----

export async function listUsers(req: Request, res: Response): Promise<void> {
  const { role, status, q } = req.query as { role?: Role; status?: string; q?: string };
  res.json(await adminService.listUsers({ role, status, q }));
}

export async function setUserStatus(req: Request, res: Response): Promise<void> {
  const { status, reason } = req.body as { status: 'active' | 'suspended'; reason: string };
  await adminService.setUserStatus(
    { id: req.user!.id, role: req.user!.role },
    String(req.params.userId),
    status,
    reason,
  );
  res.status(204).send();
}

/** Super admin only, enforced in the service as well as on the route. */
export async function setUserRole(req: Request, res: Response): Promise<void> {
  const { role } = req.body as { role: Role };
  await adminService.setUserRole(
    { id: req.user!.id, role: req.user!.role },
    String(req.params.userId),
    role,
  );
  res.status(204).send();
}

// ---- categories ----

export async function listCategories(_req: Request, res: Response): Promise<void> {
  res.json(await adminService.listAllCategories());
}

export async function createCategory(req: Request, res: Response): Promise<void> {
  await adminService.createCategory(req.body);
  res.status(201).json({ created: true });
}

export async function updateCategory(req: Request, res: Response): Promise<void> {
  await adminService.updateCategory(String(req.params.slug), req.body);
  res.status(204).send();
}

export async function deactivateCategory(req: Request, res: Response): Promise<void> {
  await adminService.deactivateCategory(String(req.params.slug));
  res.status(204).send();
}
