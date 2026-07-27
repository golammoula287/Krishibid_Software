# ADR-005 — Bidding concurrency: atomic conditional updates, not locks

**Status:** accepted · 2026-07-26

## Context

Many buyers bid on one lot at the same time. Two failures must be impossible:

1. A **lost update** — two bids race and the lower one ends up recorded as highest.
2. A **double sale** — one listing produces two orders.

## Decision

Two different mechanisms, because the two operations have different shapes.

### Placing a bid — one atomic conditional update

Every precondition is encoded in the *filter*, so MongoDB applies the check and the
write as a single operation:

```js
findOneAndUpdate(
  { _id: listingId,
    status: 'open',
    bidClosesAt: { $gt: now },
    $or: [
      { highestBid: null, reservePricePoisha: { $lte: amount } },
      { 'highestBid.amountPoisha': { $lt: amount } },
    ] },
  { $set: { highestBid: {...} }, $inc: { version: 1 } },
)
```

Of N racing bidders exactly one can match a given state. A `null` result is
unambiguous — closed, or outbid — and returns 409. No lock, no transaction, no
read-then-write window.

`highestBid` is denormalised onto the listing specifically to make this possible;
deriving it from the `bids` collection would force a read-then-write.

### Accepting a bid — a real transaction

This spans three collections (listing, bids, orders). A listing marked `sold` with no
order, or an order against an open listing, are both corrupt states. Guarded twice:

1. The listing update filters on `version: expectedVersion` (echoed by the client), so
   a second concurrent accept matches nothing.
2. `orders.listingId` carries a **unique index** — even if two transactions somehow
   passed the version check, the second insert fails.

Atlas M0 is a replica set, so transactions are available. Tests run against
`MongoMemoryReplSet`, not a standalone `mongod`, or these paths would never execute.

## The bug this design initially had

The first implementation demoted losing bids with "mark everything except me as
outbid", run inline after winning. Under 50 concurrent bids that is wrong: a bid that
briefly led and was then superseded can have its demotion execute *after* the eventual
winner was recorded, demoting the true leader and leaving **zero active bids**.

The 50-way concurrency test caught it. The fix derives both sides from freshly-read
authoritative state — demote everyone who is not the current leader, then repair the
leader if a racing pass demoted it. Because every pass re-reads the leader, the
outcome converges regardless of interleaving.

`listing.highestBid` is the source of truth and was always correct; `bids.status` is a
display projection, and this only keeps it honest.

## Anti-sniping

A bid inside the final 120 s extends the deadline by 120 s, capped at 10 extensions.
The decision is made from the read state but *applied inside* the atomic update, so an
extension can never be granted against a stale listing. `bidClosesAt` is always
server-authoritative; a client timer is display only.

## Consequences

- 409 is an expected outcome of healthy concurrency, so it is logged at `warn`, never
  as an error, and never retried by the client.
- Orders start `awaiting_payment`, never `confirmed` — a farmer cannot ship before the
  money is in escrow (ADR-006).
- The closing sweep is idempotent and filtered on `status: 'open'`, so a free-tier dyno
  that slept through a deadline self-heals on wake.
