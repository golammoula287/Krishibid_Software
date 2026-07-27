import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import './index.css';
import './lib/i18n.js';
import { ApiRequestError } from './lib/api.js';

const queryClient = new QueryClient({
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
