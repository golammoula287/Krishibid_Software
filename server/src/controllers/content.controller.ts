import type { ContactStatus, PostStatus } from '@krishibid/shared';
import type { Request, Response } from 'express';
import * as contentService from '../services/content.service.js';

// ---- blog: public ----

export async function listPosts(req: Request, res: Response): Promise<void> {
  const { tag, status, limit, cursor } = req.query as unknown as {
    tag?: string;
    status?: PostStatus;
    limit: number;
    cursor?: string;
  };

  /**
   * Drafts are visible to an admin and to nobody else.
   *
   * Decided here from the authenticated role rather than from anything in the request, so asking
   * for `?status=draft` as a visitor returns published posts rather than a preview of unfinished
   * work. The route is public, so `req.user` is simply absent for most callers.
   */
  const includeDrafts = req.user?.role === 'admin';

  res.json(await contentService.listPosts({ tag, status, limit, cursor, includeDrafts }));
}

export async function getPost(req: Request, res: Response): Promise<void> {
  res.json(await contentService.getPost(String(req.params.slug), req.user?.role === 'admin'));
}

// ---- blog: admin ----

export async function createPost(req: Request, res: Response): Promise<void> {
  res.status(201).json(await contentService.createPost(req.user!.id, req.body));
}

export async function updatePost(req: Request, res: Response): Promise<void> {
  res.json(await contentService.updatePost(String(req.params.id), req.body));
}

export async function deletePost(req: Request, res: Response): Promise<void> {
  await contentService.deletePost(String(req.params.id));
  res.status(204).send();
}

// ---- contact ----

export async function submitContact(req: Request, res: Response): Promise<void> {
  // `req.user` is optional: requiring an account to report a problem would silence exactly the
  // people most likely to have one.
  await contentService.submitContactMessage(req.body, req.user?.id);
  res.status(201).json({ received: true });
}

export async function listContactMessages(req: Request, res: Response): Promise<void> {
  const { status } = req.query as { status?: ContactStatus };
  res.json(await contentService.listContactMessages(status));
}

export async function setContactStatus(req: Request, res: Response): Promise<void> {
  const { status } = req.body as { status: ContactStatus };
  await contentService.setContactStatus(String(req.params.id), status);
  res.status(204).send();
}
