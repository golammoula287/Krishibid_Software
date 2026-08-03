import { api } from './api.js';
import { currentLocale } from './i18n.js';

export type MessageTone = 'error' | 'warning' | 'info';

export interface ResolvedMessage {
  tone: MessageTone;
  title: string;
  hint?: string;
}

interface MessageBundle {
  locale: 'bn' | 'en';
  errors: Record<string, ResolvedMessage>;
  success: Record<string, ResolvedMessage>;
  version: string;
}

const STORAGE_KEY = 'krishibid_messages';

/**
 * Minimal built-in fallback.
 *
 * Only the codes that can fire when the catalogue itself is unreachable. A PWA that has to
 * fetch a message in order to tell the user they are offline is broken by construction, so
 * these few live in the bundle; every other code comes from the server.
 *
 * Deliberately not a copy of the full catalogue — duplicating it would recreate exactly the
 * client/server drift that serving it from the API exists to prevent.
 */
const FALLBACK: Record<string, ResolvedMessage> = {
  network_error: {
    tone: 'error',
    title: 'ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না / No internet connection',
    hint: 'সংযোগ দেখে আবার চেষ্টা করুন / Check your connection and try again.',
  },
  internal_error: {
    tone: 'error',
    title: 'কিছু একটা সমস্যা হয়েছে / Something went wrong',
    hint: 'আবার চেষ্টা করুন / Please try again.',
  },
  unauthorized: {
    tone: 'error',
    title: 'আবার লগইন করুন / Please log in again',
  },
};

let bundle: MessageBundle | null = null;

/**
 * Loads the catalogue, preferring a cached copy so the first render never waits on it.
 *
 * localStorage rather than memory only: a cold start on a sleeping free dyno can take ~50s,
 * and during that window a cached catalogue is the difference between real messages and
 * bilingual fallbacks.
 */
export async function loadMessages(): Promise<void> {
  const locale = currentLocale();

  const cached = readCache(locale);
  if (cached) bundle = cached;

  try {
    const fresh = await api.get<MessageBundle>(`/messages?locale=${locale}`);
    bundle = fresh;
    localStorage.setItem(`${STORAGE_KEY}_${locale}`, JSON.stringify(fresh));
  } catch {
    // Offline or the API is asleep. A cached or fallback message is still useful, and
    // failing to load copy must never block the app from rendering.
  }
}

function readCache(locale: string): MessageBundle | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${locale}`);
    return raw ? (JSON.parse(raw) as MessageBundle) : null;
  } catch {
    return null;
  }
}

/** Resolves a server error `code` to displayable copy. */
export function resolveError(code: string, serverMessage?: string): ResolvedMessage {
  const known = bundle?.errors[code];
  if (known) return known;

  const fallback = FALLBACK[code];
  if (fallback) return fallback;

  /**
   * Unknown code — surface the server's own message rather than a generic apology.
   *
   * This happens when the API ships a new code before the cached catalogue refreshes. The
   * raw message is less polished but strictly more informative than "something went wrong",
   * and it is already safe to show: the error handler never puts internal details in the
   * message field of a client-facing error.
   */
  return {
    tone: 'error',
    title: serverMessage ?? FALLBACK.internal_error!.title,
  };
}

/**
 * Whether the catalogue has written copy for a code.
 *
 * Lets a caller distinguish "the server sent a code we have words for" from "we are falling back
 * to the raw server message", which matters for 5xx: an unknown one is not safe to show, a known
 * one is copy we wrote for exactly that situation.
 */
export const hasCopyFor = (code: string): boolean =>
  Boolean(bundle?.errors[code] ?? FALLBACK[code]);

/** Resolves a success key, e.g. `bid_placed`. */
export function resolveSuccess(key: string, fallbackTitle?: string): ResolvedMessage {
  return (
    bundle?.success[key] ?? {
      tone: 'info',
      title: fallbackTitle ?? key.replace(/_/g, ' '),
    }
  );
}

export const messagesLoaded = (): boolean => bundle !== null;
