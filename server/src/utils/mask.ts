/**
 * Display masking for contact details.
 *
 * Used wherever a value is shown to somebody who is not its owner — chiefly the admin review
 * queue. A reviewer needs enough to confirm they are looking at the right application, not a
 * harvestable list of farmers' phone numbers and email addresses.
 */

/** 01712****78 — recognisable to its owner, not much use to anyone else. */
export function maskPhone(phone: string): string {
  if (phone.length < 7) return '*'.repeat(phone.length);
  return `${phone.slice(0, 5)}${'*'.repeat(phone.length - 7)}${phone.slice(-2)}`;
}

/** a****@gmail.com — keeps the domain, which is the part that aids recognition. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}
