import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout.js';
import Toaster from './components/Toaster.js';
import { Spinner } from './components/ui.js';
import type { Role } from '@krishibid/shared';
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
const LandingPage = lazy(() => import('./pages/LandingPage.js'));
const ListingDetailPage = lazy(() => import('./pages/ListingDetailPage.js'));
const CreateListingPage = lazy(() => import('./pages/CreateListingPage.js'));
const DiagnosePage = lazy(() => import('./pages/DiagnosePage.js'));
const AdvisorPage = lazy(() => import('./pages/AdvisorPage.js'));
const OrdersPage = lazy(() => import('./pages/OrdersPage.js'));
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage.js'));
const AccountPage = lazy(() => import('./pages/AccountPage.js'));
const PaymentReturnPage = lazy(() => import('./pages/PaymentReturnPage.js'));
// Lazy like the rest, so the simulated-checkout page costs nothing in the initial
// bundle for the real-gateway configuration that never routes to it.
const MockCheckoutPage = lazy(() => import('./pages/MockCheckoutPage.js'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage.js'));
const VerifyIdentityPage = lazy(() => import('./pages/VerifyIdentityPage.js'));
const AdminReviewPage = lazy(() => import('./pages/AdminReviewPage.js'));
const LoginPage = lazy(() => import('./pages/LoginPage.js'));
/**
 * Signup, status and password reset are lazy like everything else — and that matters more here
 * than elsewhere. The market feed is the landing page for someone who has not signed up yet, so
 * it must not pay for a four-step wizard and an image-upload path they may never open.
 */
const BlogPage = lazy(() => import('./pages/BlogPage.js'));
const BlogPostPage = lazy(() => import('./pages/BlogPostPage.js'));
const AdminBlogPage = lazy(() => import('./pages/AdminBlogPage.js'));
const ContactPage = lazy(() => import('./pages/ContactPage.js'));
const SignupPage = lazy(() => import('./pages/SignupPage.js'));
const SignupStatusPage = lazy(() => import('./pages/SignupStatusPage.js'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage.js'));

/**
 * `/` means different things to a visitor and to a member.
 *
 * A guest gets the landing page: the case for signing up, made with live prices rather than
 * claims. Someone signed in has already made that decision, and showing them a sales pitch every
 * time they open the app would be noise — they get the market, which is the screen both roles
 * actually work from.
 */
function Home() {
  const { user, initialising } = useAuth();

  // Waiting matters here: rendering the landing page for a frame before the silent refresh
  // resolves would flash a "Sign up" pitch at somebody who is already a member.
  if (initialising) return <Spinner />;
  return user ? <MarketPage /> : <LandingPage />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, initialising } = useAuth();
  const location = useLocation();

  // Wait for the silent refresh before deciding, or a reload would bounce an
  // authenticated user to the login screen for a frame.
  if (initialising) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/**
 * Role gate for a route.
 *
 * Redirects to the market rather than rendering an empty screen or a bare "forbidden": a buyer
 * who lands on /diagnose by an old link or a typed URL should end up somewhere useful.
 *
 * Presentation only — every one of these routes is also gated server-side. If this component
 * were the sole protection, a request straight to the API would still succeed.
 */
function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user, initialising } = useAuth();

  if (initialising) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
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
      <Toaster />

      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* Public by necessity: nobody signing up has a session, and a farmer waiting for
            approval cannot get one — the status page is their only way to find out anything. */}
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/signup/status" element={<SignupStatusPage />} />
        <Route path="/forgot" element={<ForgotPasswordPage />} />

        <Route element={<Layout />}>
          {/* Browsing the market is public — a farmer should be able to see prices
              before deciding whether to sign up. */}
          <Route index element={<Home />} />
          {/* The market at its own address too, so the landing page can link to it and a
              signed-in user's bookmark keeps working. */}
          <Route path="market" element={<MarketPage />} />
          <Route path="listing/:id" element={<ListingDetailPage />} />

          {/* Public: an advisory or a scheme deadline is useful to a farmer who has not signed
              up, and putting it behind an account would waste it. */}
          <Route path="blog" element={<BlogPage />} />
          <Route path="blog/:slug" element={<BlogPostPage />} />
          <Route path="contact" element={<ContactPage />} />

          <Route
            path="admin/blog"
            element={
              <RequireRole roles={['admin']}>
                <AdminBlogPage />
              </RequireRole>
            }
          />

          <Route
            path="listing/new"
            element={
              <RequireRole roles={['farmer']}>
                <CreateListingPage />
              </RequireRole>
            }
          />
          {/* Farmer-only. A buyer has no use for leaf diagnosis, and these two routes are
              what consume the 5-req/min Gemini allowance. */}
          <Route
            path="diagnose"
            element={
              <RequireRole roles={['farmer', 'admin']}>
                <DiagnosePage />
              </RequireRole>
            }
          />
          <Route
            path="advisor"
            element={
              <RequireRole roles={['farmer', 'admin']}>
                <AdvisorPage />
              </RequireRole>
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
          {/* Verification. Available to both roles: required for a farmer to list, optional
              for a buyer to reach the trusted tier. */}
          <Route
            path="verify"
            element={
              <RequireAuth>
                <VerifyIdentityPage />
              </RequireAuth>
            }
          />
          <Route
            path="verify/email"
            element={
              <RequireAuth>
                <VerifyEmailPage />
              </RequireAuth>
            }
          />

          <Route
            path="admin/review"
            element={
              <RequireRole roles={['admin']}>
                <AdminReviewPage />
              </RequireRole>
            }
          />

          {/* Where the payment gateway sends the browser back to. */}
          <Route path="payment/return" element={<PaymentReturnPage />} />
          {/* Simulated checkout. The server 404s /payments/mock/complete unless
              PAYMENT_MODE=mock, and the page surfaces that plainly. */}
          <Route path="payment/mock" element={<MockCheckoutPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
