import {
  contactMessageSchema,
  createPostSchema,
  postQuerySchema,
  updatePostSchema,
} from '@krishibid/shared';
import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/content.controller.js';
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

export const contentRoutes = Router();

/**
 * Reading the blog is public.
 *
 * `optionalAuth` rather than no auth at all: an admin reading the same endpoint also sees drafts,
 * which is decided from the verified role in the controller and never from the query string.
 */
contentRoutes.get(
  '/posts',
  optionalAuth,
  validate(postQuerySchema, 'query'),
  controller.listPosts,
);
contentRoutes.get('/posts/:slug', optionalAuth, controller.getPost);

// ---- authoring: admin only ----
contentRoutes.post(
  '/posts',
  requireAuth,
  requireRole('admin'),
  validate(createPostSchema),
  controller.createPost,
);
contentRoutes.patch(
  '/posts/:id',
  requireAuth,
  requireRole('admin'),
  validate(updatePostSchema),
  controller.updatePost,
);
contentRoutes.delete('/posts/:id', requireAuth, requireRole('admin'), controller.deletePost);

/**
 * Contact form. Open to anyone, including visitors with no account — requiring one would
 * silence exactly the people most likely to have a problem worth hearing about.
 *
 * `authLimiter` because an open write endpoint is a spam target, and this one ends up in a
 * human's inbox.
 */
contentRoutes.post(
  '/contact',
  authLimiter,
  optionalAuth,
  validate(contactMessageSchema),
  controller.submitContact,
);

// ---- the inbox: admin only ----
contentRoutes.get(
  '/contact/messages',
  requireAuth,
  requireRole('admin'),
  controller.listContactMessages,
);
contentRoutes.patch(
  '/contact/messages/:id',
  requireAuth,
  requireRole('admin'),
  validate(z.object({ status: z.enum(['new', 'read', 'archived']) })),
  controller.setContactStatus,
);
