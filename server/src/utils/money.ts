/**
 * Money helpers. Everything is integer poisha (1 BDT = 100 poisha).
 *
 * There is no `number` in this codebase that represents BDT as a decimal. Money
 * enters as poisha, is stored as poisha, and is only formatted to a decimal
 * string at the display boundary (and for the gateway, which demands BDT).
 */

export const POISHA_PER_BDT = 100;

export function bdtToPoisha(bdt: number): number {
  return Math.round(bdt * POISHA_PER_BDT);
}

export function poishaToBdt(poisha: number): number {
  return poisha / POISHA_PER_BDT;
}

/** SSLCOMMERZ wants BDT with 2 decimals as a string, e.g. "1250.00". */
export function poishaToGatewayAmount(poisha: number): string {
  return (poisha / POISHA_PER_BDT).toFixed(2);
}

/**
 * Parses the amount the gateway echoes back.
 *
 * Returns null on anything unparseable rather than NaN, so a malformed callback
 * can never be compared loosely against an expected amount and pass.
 */
export function gatewayAmountToPoisha(amount: string | undefined): number | null {
  if (!amount) return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * POISHA_PER_BDT);
}

/**
 * Splits a captured amount into platform commission and the farmer's net.
 *
 * Commission is floored and the farmer takes the remainder, so the two parts
 * always sum to exactly the captured total. Rounding the commission up (or
 * rounding both independently) would leave stray poisha that make the ledger
 * fail to balance.
 */
export function splitCommission(
  amountPoisha: number,
  commissionBps: number,
): { commissionPoisha: number; netPoisha: number } {
  if (!Number.isInteger(amountPoisha) || amountPoisha < 0) {
    throw new Error(`amountPoisha must be a non-negative integer, got ${amountPoisha}`);
  }
  const commissionPoisha = Math.floor((amountPoisha * commissionBps) / 10_000);
  return { commissionPoisha, netPoisha: amountPoisha - commissionPoisha };
}

/** Formats for display. Uses Bengali digits for the bn locale. */
export function formatBdt(poisha: number, locale: 'bn' | 'en' = 'bn'): string {
  return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    style: 'currency',
    currency: 'BDT',
    maximumFractionDigits: 0,
  }).format(poishaToBdt(poisha));
}
