import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout.js';
import Toaster from './components/Toaster.js';
import { Spinner } from './components/ui.js';
/**
 * From the zod-free module, NOT the barrel.
 *
 * Importing this one function from '@krishibid/shared' pulled the entire zod runtime and every
 * validation schema in the project into the initial chunk — NID rules and auction refinements
 * downloaded by a visitor looking at the landing page. See shared/src/roles.ts.
 */
import { roleSatisfies, type Role } from '@krishibid/shared/roles';
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
const MarketHomePage = lazy(() => import('./pages/MarketHomePage.js'));
const BrowsePage = lazy(() => import('./pages/BrowsePage.js'));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage.js'));
const CategoryPage = lazy(() => import('./pages/CategoryPage.js'));
const LandingPage = lazy(() => import('./pages/LandingPage.js'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.js'));
const ListingDetailPage = lazy(() => import('./pages/ListingDetailPage.js'));
const CreateListingPage = lazy(() => import('./pages/CreateListingPage.js'));
const EditListingPage = lazy(() => import('./pages/EditListingPage.js'));
const GuestHomePage = lazy(() => import('./pages/GuestHomePage.js'));
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
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage.js'));
const SupplierProfilePage = lazy(() => import('./pages/SupplierProfilePage.js'));
const ContactPage = lazy(() => import('./pages/ContactPage.js'));
const MyBidsPage = lazy(() => import('./pages/MyBidsPage.js'));
const SignupPage = lazy(() => import('./pages/SignupPage.js'));
const SignupStatusPage = lazy(() => import('./pages/SignupStatusPage.js'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage.js'));

/**
 * `/` means different things to a visitor and to a member.
 *
 * A guest gets the landing page: the case for signing up, made with live prices rather than
 * claims. Someone signed in has already made that decision, and showing them a sales pitch every
 * time they open the app would be noise.
 *
 * A member gets their dashboard, which is genuinely different per role: a supplier needs to know
 * what is happening to their lots and what they are owed, a buyer whether they are still winning
 * anything and what they owe. Neither question is answered by a feed of everybody else's produce,
 * which is what `/` used to redirect to.
 *
 * An admin keeps going to the marketplace: their own dashboard is at `/admin`, and duplicating it
 * here would be two front doors to the same room.
 */
function Home() {
  const { user, initialising } = useAuth();

  // Waiting matters here: rendering the landing page for a frame before the silent refresh
  // resolves would flash a "Sign up" pitch at somebody who is already a member.
  if (initialising) return <Spinner />;

  /**
   * Guests and buyers get the marketplace; farmers get their dashboard.
   *
   * A guest used to get a marketing page. For a shop, showing real produce is a better pitch
   * than a pitch is — somebody deciding whether to sign up wants to see what is for sale, and
   * making them click through to find out cost a step for nothing. The old landing page lives at
   * `/about` so the copy is not lost.
   *
   * A farmer's `/` stays their dashboard: they arrive to manage lots and orders, not to shop.
   */
  if (!user) return <GuestHomePage />;
  if (user.role === 'farmer') return <DashboardPage />;
  if (user.role === 'buyer') return <MarketHomePage />;
  return <Navigate to="/admin" replace />;
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
  // Mirrors the server's role hierarchy, so a super admin is not locked out of an admin
  // route. Presentation only — the API refuses regardless; this avoids sending somebody to
  // an empty screen.
  if (!roles.some((r) => roleSatisfies(r, user.role))) return <Navigate to="/" replace />;
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

          {/**
           * The two shops, at their own addresses.
           *
           * A route each rather than a toggle on one page: with a switcher there was one URL for
           * two shops, so you could not link somebody to the auctions and the back button did not
           * return you to the shop you were in. One component serves both — they are the same
           * query with a different `saleMode`, and what differs is the framing.
           */}
          <Route path="auctions" element={<BrowsePage saleMode="auction" />} />
          <Route path="shop" element={<BrowsePage saleMode="fixed" />} />

          {/**
           * The dashboard at its own address.
           *
           * A farmer also gets it at `/`, but a buyer no longer does — theirs is the marketplace
           * — so it needs somewhere to live that does not depend on which role is asking.
           */}
          <Route
            path="dashboard"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />

          {/* The old marketing page. Kept rather than deleted: it explains what this is, which
              is worth a page even when it is no longer the front door. */}
          <Route path="about" element={<LandingPage />} />

          <Route path="categories" element={<CategoriesPage />} />
          <Route path="category/:slug" element={<CategoryPage />} />

          {/**
           * The marketplace has its own address, and needs one.
           *
           * It was a redirect to `/`, which collided with the dashboard: a farmer's `/` is their
           * dashboard, so the nav had two entries — "Dashboard" and "Marketplace" — pointing at
           * the same URL, and both lit up as active at once. A destination that means different
           * things depending on who is asking cannot be linked to, and cannot be highlighted
           * correctly either.
           *
           * `/` still dispatches by role. `/market` always means the marketplace.
           */}
          <Route path="market" element={<MarketHomePage />} />
          <Route path="listing/:id" element={<ListingDetailPage />} />
          {/* Public, like the listings themselves. Somebody deciding whether this platform is
              worth registering for is exactly who needs to see that its suppliers are real and
              rated — and the profile carries nothing private. */}
          <Route path="supplier/:id" element={<SupplierProfilePage />} />

          {/* Public: an advisory or a scheme deadline is useful to a farmer who has not signed
              up, and putting it behind an account would waste it. */}
          <Route path="blog" element={<BlogPage />} />
          <Route path="blog/:slug" element={<BlogPostPage />} />
          <Route path="contact" element={<ContactPage />} />

          {/* `admin` covers a super admin too — RequireRole mirrors the server's hierarchy,
              and the server is what actually enforces it. */}
          <Route
            path="admin"
            element={
              <RequireRole roles={['admin']}>
                <AdminDashboardPage />
              </RequireRole>
            }
          />
          <Route
            path="admin/blog"
            element={
              <RequireRole roles={['admin']}>
                <AdminBlogPage />
              </RequireRole>
            }
          />

          <Route
            path="listing/:id/edit"
            element={
              <RequireAuth>
                <RequireRole roles={['farmer']}>
                  <EditListingPage />
                </RequireRole>
              </RequireAuth>
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
          {/* Buyer-only: a farmer never places a bid, so the screen would always be empty
              for them and the tab would be a dead end. */}
          <Route
            path="bids"
            element={
              <RequireRole roles={['buyer']}>
                <MyBidsPage />
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
