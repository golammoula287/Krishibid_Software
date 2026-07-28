import { create } from 'zustand';
import { ApiRequestError } from './api.js';
import { resolveError, resolveSuccess, type MessageTone } from './messages.js';

export interface Toast {
  id: string;
  tone: MessageTone;
  title: string;
  hint?: string;
  /** Field-level issues from a Zod validation failure, shown as a list. */
  fields?: { path: string; message: string }[];
}

interface ToastState {
  toasts: Toast[];
  dismiss: (id: string) => void;
  /** Resolves a server error into a toast. Pass anything caught. */
  showError: (error: unknown) => void;
  /** Shows a success message by catalogue key. */
  showSuccess: (key: string, fallbackTitle?: string) => void;
  clear: () => void;
}

/** Errors linger; confirmations get out of the way. */
const DURATION: Record<MessageTone, number> = {
  error: 8000,
  warning: 6000,
  info: 4000,
};

let counter = 0;

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),

  showError: (error) => {
    let code = 'internal_error';
    let serverMessage: string | undefined;
    let fields: Toast['fields'];

    if (error instanceof ApiRequestError) {
      code = error.code;
      serverMessage = error.message;

      // Zod issues arrive as details; surfacing them beats "some details are not valid".
      if (Array.isArray(error.details)) {
        fields = (error.details as { path?: string; message?: string }[])
          .filter((d) => typeof d.message === 'string')
          .map((d) => ({ path: d.path ?? '', message: d.message! }));
      }
    } else if (error instanceof TypeError) {
      // fetch() rejects with TypeError when the request never reached a server.
      code = 'network_error';
    } else if (error instanceof Error) {
      serverMessage = error.message;
    }

    const resolved = resolveError(code, serverMessage);
    push(set, get, { ...resolved, fields });
  },

  showSuccess: (key, fallbackTitle) => {
    push(set, get, resolveSuccess(key, fallbackTitle));
  },
}));

function push(
  set: (fn: (s: ToastState) => Partial<ToastState>) => void,
  get: () => ToastState,
  message: { tone: MessageTone; title: string; hint?: string; fields?: Toast['fields'] },
): void {
  // Collapse an identical repeat rather than stacking it. Retrying a failing action three
  // times should not produce three identical toasts.
  const existing = get().toasts.find((t) => t.title === message.title && t.tone === message.tone);
  if (existing) return;

  const id = `t${++counter}`;
  set((s) => ({ toasts: [...s.toasts, { id, ...message }] }));

  const ms = DURATION[message.tone];
  setTimeout(() => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }, ms);
}
