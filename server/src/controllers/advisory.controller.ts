import type { Request, Response } from 'express';
import { notFound } from '../utils/errors.js';
import * as advisory from '../services/advisory.service.js';

export async function ask(req: Request, res: Response): Promise<void> {
  res.json(await advisory.ask(req.user!.id, req.body));
}

export async function listSessions(req: Request, res: Response): Promise<void> {
  res.json(await advisory.listSessions(req.user!.id));
}

export async function getSession(req: Request, res: Response): Promise<void> {
  const session = await advisory.getSession(req.user!.id, String(req.params.id));
  if (!session) throw notFound('chat session');
  res.json(session);
}
