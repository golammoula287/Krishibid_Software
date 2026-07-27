import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let io: Server | null = null;

interface SocketClaims extends jwt.JwtPayload {
  sub: string;
  role: string;
}

/**
 * Socket.IO for live bid and payment events.
 *
 * Two rooms per connection:
 *   - `user:<id>`     private notifications (outbid, payment held/released)
 *   - `listing:<id>`  joined on demand while viewing a listing
 *
 * Scoping to rooms rather than broadcasting matters on a free tier: a global
 * broadcast would push every bid on the platform to every connected phone —
 * both a privacy leak and a bandwidth bill on metered mobile data.
 */
export function initSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: env().corsOrigins, credentials: true },
    // Long-polling fallback stays enabled deliberately: rural mobile networks and
    // captive portals frequently block WebSocket upgrades.
    transports: ['websocket', 'polling'],
    pingTimeout: 30_000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('authentication required'));

    try {
      const claims = jwt.verify(token, env().JWT_ACCESS_SECRET) as SocketClaims;
      socket.data.userId = claims.sub;
      socket.data.role = claims.role;
      next();
    } catch {
      next(new Error('invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    void socket.join(`user:${userId}`);
    logger.debug({ userId, socketId: socket.id }, 'socket connected');

    socket.on('listing:watch', (listingId: unknown) => {
      if (typeof listingId === 'string' && /^[0-9a-fA-F]{24}$/.test(listingId)) {
        void socket.join(`listing:${listingId}`);
      }
    });

    socket.on('listing:unwatch', (listingId: unknown) => {
      if (typeof listingId === 'string') void socket.leave(`listing:${listingId}`);
    });

    socket.on('disconnect', (reason) => {
      logger.debug({ userId, reason }, 'socket disconnected');
    });
  });

  return io;
}

/**
 * Emit helpers — both no-op when the socket server isn't running.
 *
 * That is intentional: tests and the seed/ingest scripts exercise the payment and
 * bidding services without an HTTP server, and a realtime notification failing
 * must never fail a money transaction.
 */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToListing(listingId: string, event: string, payload: unknown): void {
  io?.to(`listing:${listingId}`).emit(event, payload);
}

export async function closeSocket(): Promise<void> {
  await io?.close();
  io = null;
}
