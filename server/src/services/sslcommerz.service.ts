import type { SslczIpn, SslczValidationResponse } from '@krishibid/shared';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { serviceUnavailable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { poishaToGatewayAmount } from '../utils/money.js';

const SANDBOX = 'https://sandbox.sslcommerz.com';
const LIVE = 'https://securepay.sslcommerz.com';

const baseUrl = (): string => (env().SSLCZ_IS_LIVE ? LIVE : SANDBOX);

export interface SessionRequest {
  tranId: string;
  amountPoisha: number;
  productName: string;
  customerName: string;
  customerPhone: string;
  valueA?: string;
  valueB?: string;
}

export interface SessionResponse {
  gatewayUrl: string;
  sessionKey: string;
}

interface SslczSessionRaw {
  status?: string;
  failedreason?: string;
  sessionkey?: string;
  GatewayPageURL?: string;
  redirectGatewayURL?: string;
}

/**
 * Creates a hosted-checkout session.
 *
 * `ipn_url` must be publicly reachable — SSLCOMMERZ posts to it server-to-server,
 * so a localhost value silently never fires and payments appear to hang in
 * `pending` forever. Development needs a tunnel (cloudflared / ngrok).
 */
export async function createSession(req: SessionRequest): Promise<SessionResponse> {
  const e = env();
  if (!e.SSLCZ_STORE_ID || !e.SSLCZ_STORE_PASSWORD) {
    throw serviceUnavailable('payments_unconfigured', 'SSLCOMMERZ credentials are not configured');
  }

  const form = new URLSearchParams({
    store_id: e.SSLCZ_STORE_ID,
    store_passwd: e.SSLCZ_STORE_PASSWORD,
    total_amount: poishaToGatewayAmount(req.amountPoisha),
    currency: 'BDT',
    tran_id: req.tranId,

    // The browser lands on these. Advisory only — nothing is marked paid from a
    // redirect, because a buyer can navigate to them directly.
    success_url: `${e.API_PUBLIC_URL}/api/payments/callback/success`,
    fail_url: `${e.API_PUBLIC_URL}/api/payments/callback/fail`,
    cancel_url: `${e.API_PUBLIC_URL}/api/payments/callback/cancel`,
    // Authoritative: server-to-server, and re-validated before we trust it.
    ipn_url: `${e.API_PUBLIC_URL}/api/payments/ipn`,

    shipping_method: 'NO',
    product_name: req.productName,
    product_category: 'agriculture',
    product_profile: 'physical-goods',

    cus_name: req.customerName,
    cus_email: 'noreply@krishibid.example',
    cus_phone: req.customerPhone,
    cus_add1: 'N/A',
    cus_city: 'Dhaka',
    cus_country: 'Bangladesh',

    ...(req.valueA ? { value_a: req.valueA } : {}),
    ...(req.valueB ? { value_b: req.valueB } : {}),
  });

  const response = await fetch(`${baseUrl()}/gwprocess/v4/api.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });

  const body = (await response.json().catch(() => ({}))) as SslczSessionRaw;

  if (!response.ok || body.status !== 'SUCCESS') {
    logger.error(
      { status: body.status, reason: body.failedreason, http: response.status },
      'sslcommerz session creation failed',
    );
    throw serviceUnavailable(
      'gateway_session_failed',
      body.failedreason ?? 'could not start a payment session',
    );
  }

  const gatewayUrl = body.GatewayPageURL ?? body.redirectGatewayURL;
  if (!gatewayUrl || !body.sessionkey) {
    throw serviceUnavailable('gateway_session_failed', 'gateway returned no checkout URL');
  }

  return { gatewayUrl, sessionKey: body.sessionkey };
}

/**
 * Server-to-server validation. **The only authoritative confirmation that money
 * was captured.**
 *
 * The IPN body is attacker-supplyable (the endpoint is public), so we take only
 * `val_id` from it and ask SSLCOMMERZ directly what that transaction actually was.
 */
export async function validateTransaction(valId: string): Promise<SslczValidationResponse> {
  const e = env();
  const url = new URL(`${baseUrl()}/validator/api/validationserverAPI.php`);
  url.searchParams.set('val_id', valId);
  url.searchParams.set('store_id', e.SSLCZ_STORE_ID);
  url.searchParams.set('store_passwd', e.SSLCZ_STORE_PASSWORD);
  url.searchParams.set('format', 'json');

  const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(20_000) });

  if (!response.ok) {
    throw serviceUnavailable(
      'gateway_validation_failed',
      `validation request failed with HTTP ${response.status}`,
    );
  }

  return (await response.json()) as SslczValidationResponse;
}

export interface RefundRequest {
  bankTranId: string;
  amountPoisha: number;
  reason: string;
  refundRef: string;
}

interface SslczRefundRaw {
  APIConnect?: string;
  status?: string;
  refund_ref_id?: string;
  errorReason?: string;
}

export async function refundTransaction(
  req: RefundRequest,
): Promise<{ refundRefId: string | null; status: string }> {
  const e = env();
  const url = new URL(`${baseUrl()}/validator/api/merchantTransIDvalidationAPI.php`);
  url.searchParams.set('bank_tran_id', req.bankTranId);
  url.searchParams.set('store_id', e.SSLCZ_STORE_ID);
  url.searchParams.set('store_passwd', e.SSLCZ_STORE_PASSWORD);
  url.searchParams.set('refund_amount', poishaToGatewayAmount(req.amountPoisha));
  url.searchParams.set('refund_remarks', req.reason.slice(0, 255));
  url.searchParams.set('refe_id', req.refundRef);
  url.searchParams.set('format', 'json');

  const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30_000) });
  const body = (await response.json().catch(() => ({}))) as SslczRefundRaw;

  if (!response.ok || body.APIConnect !== 'DONE') {
    logger.error({ body, http: response.status }, 'sslcommerz refund failed');
    throw serviceUnavailable(
      'gateway_refund_failed',
      body.errorReason ?? 'refund request was rejected by the gateway',
    );
  }

  return { refundRefId: body.refund_ref_id ?? null, status: body.status ?? 'unknown' };
}

/**
 * Verifies the IPN's `verify_sign` hash.
 *
 * Per SSLCOMMERZ's spec: `verify_key` lists the covered field names; collect
 * those, add store_passwd = md5(password), sort keys ascending, join as `k=v&…`,
 * md5 the result and compare.
 *
 * Defence-in-depth, NOT the authority — `validateTransaction` is. Kept because it
 * rejects forged callbacks before we spend a network round trip, and a mismatch is
 * worth alerting on. MD5 is dictated by the gateway's protocol, not chosen by us.
 */
export function verifyIpnSignature(ipn: SslczIpn): boolean {
  const e = env();
  if (!ipn.verify_sign || !ipn.verify_key) return false;

  const fields = ipn.verify_key
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  if (fields.length === 0) return false;

  const record = new Map<string, string>();
  for (const field of fields) {
    const value = (ipn as Record<string, unknown>)[field];
    record.set(field, value === undefined || value === null ? '' : String(value));
  }
  record.set(
    'store_passwd',
    crypto.createHash('md5').update(e.SSLCZ_STORE_PASSWORD).digest('hex'),
  );

  const hashString = [...record.keys()]
    .sort()
    .map((k) => `${k}=${record.get(k) ?? ''}`)
    .join('&');

  const expected = crypto.createHash('md5').update(hashString).digest('hex');

  // Constant-time compare so the endpoint does not leak hash prefixes.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(ipn.verify_sign.toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** A gateway status string that means "money captured". */
export function isCapturedStatus(status: string | undefined): boolean {
  return status === 'VALID' || status === 'VALIDATED';
}

/** Maps card_type ("BKASH-BKash", "VISA-Visa Card") onto our method enum. */
export function mapPaymentMethod(cardType: string | undefined) {
  const t = (cardType ?? '').toUpperCase();
  if (t.includes('BKASH')) return 'bkash' as const;
  if (t.includes('NAGAD')) return 'nagad' as const;
  if (t.includes('ROCKET') || t.includes('DBBL MOBILE') || t.includes('DBBLMOBILE'))
    return 'rocket' as const;
  if (t.includes('VISA') || t.includes('MASTER') || t.includes('AMEX') || t.includes('NEXUS'))
    return 'card' as const;
  if (t.includes('IB') || t.includes('INTERNET')) return 'internet_banking' as const;
  return 'unknown' as const;
}

/** Unique per attempt — a retry after a failure needs a fresh id. */
export function buildTranId(orderId: string, attempt: number): string {
  return `KB-${orderId}-${attempt}-${crypto.randomBytes(3).toString('hex')}`;
}
