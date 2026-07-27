# ADR-006 — Escrow via a double-entry ledger, not literal fund-holding

**Status:** accepted · 2026-07-26

## Context

Neither side of a farmer-to-buyer trade knows the other. The buyer will not pay before
receiving goods; the farmer will not ship before being paid. The requirement was
"payment is released when the order is delivered".

Two hard constraints:

1. **Holding third-party money in Bangladesh requires a payment-institution licence**
   from Bangladesh Bank. A student project cannot legally operate escrow.
2. **SSLCOMMERZ's standard product settles into the platform's own merchant account.**
   It has no general-purpose sub-merchant escrow API.

## Decision

**Platform-as-merchant plus an auditable double-entry ledger.** Funds land in the
platform's SSLCOMMERZ account; an immutable ledger is the authoritative record of
*whose* they are.

```
capture   gateway_clearing −amount     farmer_escrow    +amount
release   farmer_escrow    −amount     farmer_available +net
                                       platform_revenue +commission
refund    farmer_escrow    −amount     buyer_refund     +amount
```

Three rules, enforced in code:

1. **Append-only.** No update or delete path exists; the model blocks them. A mistake
   is corrected by a compensating `adjustment` transaction.
2. **Every transaction sums to exactly zero.** `postTransaction` refuses to write
   anything otherwise. An unbalanced ledger cannot be reconciled against the gateway's
   settlement report — worthless at exactly the moment it matters, a dispute.
3. **Balances are always derived** by aggregating entries. There is no mutable balance
   column, because that is how a ledger silently drifts out of agreement with itself.

This is how real marketplaces bootstrap, and it is a more defensible answer than
pretending to run licensed escrow.

## Trust model for the IPN — the part most implementations get wrong

`POST /api/payments/ipn` is public and unauthenticated (SSLCOMMERZ's servers call it),
so nothing in the body is trusted:

1. `verify_sign` is checked as a cheap forgery filter (defence in depth).
2. `val_id` is taken from the body and the transaction **re-fetched from SSLCOMMERZ
   over HTTPS**. That response is the authority.
3. The validated **amount and currency are compared against the order**, so a buyer
   who tampers with the amount mid-flow is rejected.

**The browser redirect writes no state at all.** `/payment/success` is user-reachable —
anyone can navigate to it — so it only bounces back into the PWA, which then reads the
real status from the server.

Idempotency: the payment row is claimed with a conditional update, so a redelivered
IPN (SSLCOMMERZ retries) finds nothing to claim. A partial unique index on
`{paymentId, type, account}` is the storage-level backstop.

The IPN endpoint always returns **200**, even on a bad callback: a non-2xx makes the
gateway retry, and retrying a forged signature or unknown `tran_id` forever helps
nobody.

## Deliberate choices worth defending

**Commission is recognised at release, not capture.** If an order is refunded the buyer
must get the full amount back; commission already booked as revenue would have to be
clawed out of a possibly-closed period.

**Auto-release after 7 days of `in_transit`.** Without it, a buyer who simply stops
responding strands the farmer's money forever — which would make escrow *worse* for
farmers than taking cash. Raising a dispute nulls `autoReleaseAt`, so disputed orders
are structurally excluded from the sweep rather than filtered out by hand.

**The clock starts at ship, not capture.** The buyer's window to inspect goods only
meaningfully begins once they are on the way.

**Refund calls the gateway first, ledger second.** Writing the ledger first would leave
the books claiming a refund that never reached the buyer — worse than a failed request.

**Money is integer poisha everywhere.** No `number` in this codebase represents BDT as
a decimal. Commission is floored and the farmer takes the remainder, so the two parts
always reconstruct the total exactly; rounding both independently would leave stray
poisha and an unbalanceable ledger.

## Consequences

- Payouts are a separate, initially manual disbursement — `farmer_available` means
  "owed and withdrawable", not "already sent".
- `/metrics` exposes `krishibid_ledger_imbalanced_transactions`. Anything but `0` means
  something wrote outside `postTransaction` and payments cannot be trusted.
- Development needs a public tunnel: SSLCOMMERZ cannot POST an IPN to `localhost`, so
  payments appear to hang in `pending` forever without one.
