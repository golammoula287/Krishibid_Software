import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import './index.css';
import './lib/i18n.js';
import { ApiRequestError } from './lib/api.js';
import { loadMessages } from './lib/messages.js';
import { useToast } from './lib/toast.js';

/**
 * Fetch the server-authoritative message catalogue before the first render.
 *
 * Not awaited: a cached copy is used immediately if present, and a missing catalogue
 * degrades to the built-in bilingual fallback. Copy must never gate the app rendering.
 */
void loadMessages();

/**
 * Every failed mutation reports itself.
 *
 * Centralised in the MutationCache rather than repeated in each component's `onError`,
 * because the failure mode that matters is the one someone forgot to handle. A silent
 * failure on a bid or a payment is far worse than a duplicate toast.
 *
 * Queries are deliberately NOT wired up here: a background refetch failing while cached
 * data is on screen is not something to interrupt the user about.
 */
const mutationCache = new MutationCache({
  onError: (error, _vars, _ctx, mutation) => {
    // Opt out per-mutation with meta.silent when a component renders the error inline.
    if (mutation.options.meta?.silent) return;
    useToast.getState().showError(error);
  },
});

const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      // 30s: long enough to avoid refetch storms while navigating, short enough that
      // a bid price never looks stale for long.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry(failureCount, error) {
        // Never retry a client error — a 409 "outbid" or a 403 will not become true
        // on the second attempt, and retrying a payment call could double-charge.
        if (error instanceof ApiRequestError && error.status < 500) return false;
        return failureCount < 2;
      },
      // Refetch on reconnect matters on patchy mobile data; refetch on every window
      // focus does not, and costs bandwidth users pay for.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: { retry: false },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
