import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout.js';
import { Spinner } from './components/ui.js';
import { useAuth } from './lib/auth.js';
import { disconnectSocket } from './lib/socket.js';

/**
 * Route-level code splitting.
 *
 * The market feed is the landing page and must be fast on a 2G connection, so it
 * should not pay for the chat, camera and payment screens a visitor may never open.
 * Splitting here is what keeps the initial payload small rather than shipping the
 * whole app up front.
 */
const MarketPage = lazy(() => import('./pages/MarketPage.js'));
const ListingDetailPage = lazy(() => import('./pages/ListingDetailPage.js'));
const CreateListingPage = lazy(() => import('./pages/CreateListingPage.js'));
const DiagnosePage = lazy(() => import('./pages/DiagnosePage.js'));
const AdvisorPage = lazy(() => import('./pages/AdvisorPage.js'));
const OrdersPage = lazy(() => import('./pages/OrdersPage.js'));
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage.js'));
const AccountPage = lazy(() => import('./pages/AccountPage.js'));
const PaymentReturnPage = lazy(() => import('./pages/PaymentReturnPage.js'));
const LoginPage = lazy(() => import('./pages/LoginPage.js'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, initialising } = useAuth();
  const location = useLocation();

  // Wait for the silent refresh before deciding, or a reload would bounce an
  // authenticated user to the login screen for a frame.
  if (initialising) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  const { restore, user } = useAuth();

  useEffect(() => {
    void restore();
  }, [restore]);

  // Tear the socket down on sign-out so it cannot keep delivering a previous user's
  // notifications on a shared device.
  useEffect(() => {
    if (!user) disconnectSocket();
  }, [user]);

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<Layout />}>
          {/* Browsing the market is public — a farmer should be able to see prices
              before deciding whether to sign up. */}
          <Route index element={<MarketPage />} />
          <Route path="listing/:id" element={<ListingDetailPage />} />

          <Route
            path="listing/new"
            element={
              <RequireAuth>
                <CreateListingPage />
              </RequireAuth>
            }
          />
          <Route
            path="diagnose"
            element={
              <RequireAuth>
                <DiagnosePage />
              </RequireAuth>
            }
          />
          <Route
            path="advisor"
            element={
              <RequireAuth>
                <AdvisorPage />
              </RequireAuth>
            }
          />
          <Route
            path="orders"
            element={
              <RequireAuth>
                <OrdersPage />
              </RequireAuth>
            }
          />
          <Route
            path="orders/:id"
            element={
              <RequireAuth>
                <OrderDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="account"
            element={
              <RequireAuth>
                <AccountPage />
              </RequireAuth>
            }
          />
          {/* Where the payment gateway sends the browser back to. */}
          <Route path="payment/return" element={<PaymentReturnPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
