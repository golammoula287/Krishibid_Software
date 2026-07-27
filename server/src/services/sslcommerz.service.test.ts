import type { SslczIpn } from '@krishibid/shared';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildTranId,
  isCapturedStatus,
  mapPaymentMethod,
  verifyIpnSignature,
} from './sslcommerz.service.js';

/**
 * Builds a correctly-signed IPN using the algorithm the gateway documents,
 * implemented independently here so the test is a real check rather than a
 * restatement of the implementation.
 */
function signIpn(fields: Record<string, string>, storePassword: string): SslczIpn {
  const keys = Object.keys(fields);
  const withPass: Record<string, string> = {
    ...fields,
    store_passwd: crypto.createHash('md5').update(storePassword).digest('hex'),
  };

  const hashString = Object.keys(withPass)
    .sort()
    .map((k) => `${k}=${withPass[k]}`)
    .join('&');

  return {
    ...fields,
    verify_key: keys.join(','),
    verify_sign: crypto.createHash('md5').update(hashString).digest('hex'),
  } as SslczIpn;
}

// Matches SSLCZ_STORE_PASSWORD in test/setup.ts.
const STORE_PASSWORD = 'testpass';

describe('SSLCOMMERZ — IPN signature verification', () => {
  it('accepts a correctly signed payload', () => {
    const ipn = signIpn(
      {
        tran_id: 'KB-abc-1-aa11bb',
        val_id: '2601011200000001',
        amount: '1500.00',
        currency: 'BDT',
        status: 'VALID',
      },
      STORE_PASSWORD,
    );

    expect(verifyIpnSignature(ipn)).toBe(true);
  });

  it('rejects a tampered amount', () => {
    const ipn = signIpn(
      { tran_id: 'KB-abc-1-aa11bb', amount: '1500.00', currency: 'BDT', status: 'VALID' },
      STORE_PASSWORD,
    );

    // The attack this defends against: inflate/deflate the amount after signing.
    expect(verifyIpnSignature({ ...ipn, amount: '1.00' } as SslczIpn)).toBe(false);
  });

  it('rejects a signature produced with the wrong store password', () => {
    const ipn = signIpn(
      { tran_id: 'KB-abc-1-aa11bb', amount: '1500.00', status: 'VALID' },
      'not-the-real-password',
    );
    expect(verifyIpnSignature(ipn)).toBe(false);
  });

  it('rejects a payload with no signature at all', () => {
    expect(verifyIpnSignature({ tran_id: 'x' } as SslczIpn)).toBe(false);
    expect(verifyIpnSignature({ tran_id: 'x', verify_sign: 'deadbeef' } as SslczIpn)).toBe(false);
  });

  it('rejects an empty verify_key', () => {
    expect(
      verifyIpnSignature({ tran_id: 'x', verify_key: '', verify_sign: 'deadbeef' } as SslczIpn),
    ).toBe(false);
  });

  it('is not confused by extra unsigned fields the gateway may add', () => {
    const ipn = signIpn(
      { tran_id: 'KB-abc-1-aa11bb', amount: '1500.00', status: 'VALID' },
      STORE_PASSWORD,
    );

    // verify_key names only the covered fields, so an added field must not break
    // verification — otherwise every gateway-side addition breaks payments.
    expect(verifyIpnSignature({ ...ipn, some_new_field: 'whatever' } as SslczIpn)).toBe(true);
  });
});

describe('SSLCOMMERZ — helpers', () => {
  it('treats only VALID/VALIDATED as captured', () => {
    expect(isCapturedStatus('VALID')).toBe(true);
    expect(isCapturedStatus('VALIDATED')).toBe(true);
    expect(isCapturedStatus('FAILED')).toBe(false);
    expect(isCapturedStatus('PENDING')).toBe(false);
    expect(isCapturedStatus('INVALID_TRANSACTION')).toBe(false);
    expect(isCapturedStatus(undefined)).toBe(false);
  });

  it('maps gateway card types onto our payment methods', () => {
    expect(mapPaymentMethod('BKASH-BKash')).toBe('bkash');
    expect(mapPaymentMethod('NAGAD-Nagad')).toBe('nagad');
    expect(mapPaymentMethod('DBBLMOBILEBANKING-Rocket')).toBe('rocket');
    expect(mapPaymentMethod('VISA-Visa Card')).toBe('card');
    expect(mapPaymentMethod('MASTERCARD')).toBe('card');
    expect(mapPaymentMethod(undefined)).toBe('unknown');
    expect(mapPaymentMethod('SOMETHING-NEW')).toBe('unknown');
  });

  it('generates a distinct tran_id per attempt', () => {
    const orderId = '507f1f77bcf86cd799439011';
    const first = buildTranId(orderId, 1);
    const second = buildTranId(orderId, 2);
    const retryOfFirst = buildTranId(orderId, 1);

    expect(first).not.toBe(second);
    // Even the same attempt number yields a unique id — the random suffix is what
    // keeps the unique index from rejecting a legitimate retry.
    expect(first).not.toBe(retryOfFirst);
    expect(first).toContain(orderId);
  });
});
