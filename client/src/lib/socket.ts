import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './api.js';

let socket: Socket | null = null;

/**
 * Lazily connects the realtime socket.
 *
 * Polling is left in the transport list on purpose: rural mobile networks and
 * captive portals frequently block WebSocket upgrades, and a bidder who silently
 * stops receiving outbid notifications is worse than one on a slower transport.
 */
export function getSocket(): Socket | null {
  const token = getAccessToken();
  if (!token) return null;

  // Same origin in development (Vite proxies /socket.io); the server's full origin in
  // production, where client and API are deployed separately.
  const origin = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

  socket ??= io(origin || undefined, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
    withCredentials: true,
  });

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** Joins the room for a listing, and leaves it on cleanup. */
export function watchListing(listingId: string): () => void {
  const s = getSocket();
  if (!s) return () => undefined;

  s.emit('listing:watch', listingId);
  return () => {
    s.emit('listing:unwatch', listingId);
  };
}
