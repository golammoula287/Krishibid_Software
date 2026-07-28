# Plan v2 — verified roles, pay-on-bid auctions, learning, schemes, voice

Status: **proposed, not built.** Written before implementation so the risky parts are
argued out first.

This is six features, and three of them rewrite money or identity logic that currently
works and is tested. That ordering matters more than the feature list.

---

## 1. What changes in the money model (the risky part)

### Today

```
bid (free, atomic, race-free) → farmer accepts → buyer pays → escrow → ship → release
```

Placing a bid is a single atomic conditional update with no money involved. That is the
most defensible thing in the codebase ([ADR-005](adr/ADR-005-bidding-concurrency.md)) and
it is covered by the 50-way concurrency test.

### Requested

```
bid = FULL payment upfront → all holds kept until close
   → deadline → highest bid wins automatically (no farmer acceptance)
   → losers refunded, winner's hold converts to order escrow
   → ship → buyer approves → farmer withdrawable balance
```

### Consequences that must be designed for, not discovered

**Placing a bid stops being atomic.** It becomes: create hold → gateway redirect →
callback → bid becomes active. So a bid needs a `pending_payment` state and only counts
once captured. The atomic conditional update still guards *becoming the highest bid*, but
it now runs at capture time, not request time.

**Money is held for every bidder at once.** Ten bidders at ৳60,000 = ৳600,000 held
simultaneously, versus ৳60,000 today. That is a much larger liability and a much larger
refund workload.

**Refunds become routine, not exceptional.** An auction with N bidders issues N−1
refunds at close. Each is a gateway API call; on real SSLCOMMERZ each may carry a fee, and
the platform pays it on every losing bid. Free in mock mode.

**Farmer acceptance disappears.** "Sold when it is over the time with best bid" means the
auction resolves automatically. `acceptBid` and its `expectedVersion` guard are replaced
by a close job. Its double-accept test becomes a double-close test.

**Time extension now extends how long money is held.** If a farmer can extend
indefinitely, bidders' funds are trapped indefinitely. Needs a hard cap on total auction
duration and a rule that extension is only allowed when there is **no** qualifying bid.

### Ledger additions

New account `bid_hold`, one sub-ledger per bidder:

```
bid placed      gateway_clearing −amt    bid_hold(buyer) +amt
loser refunded  bid_hold(buyer) −amt     buyer_refund(buyer) +amt
winner          bid_hold(buyer) −amt     farmer_escrow(farmer) +amt
```

Every transaction still sums to zero, so the existing audit endpoint keeps working
unchanged. **Invariant to test:** after any auction closes, total `bid_hold` for that
listing is exactly zero — every taka either refunded or converted.

### DECIDED: 20% refundable deposit

Bidding costs a **20% deposit** of the bid amount, not the full sum. The winner pays the
remaining 80% before the farmer ships; losers are refunded at close.

Why this over full payment: identical deterrent against frivolous bidding, one fifth of
the money held at any moment, and one fifth of the refund cost — which the platform pays
on every losing bid. On the ten-bidder example that is ৳120,000 held instead of ৳600,000.

Revised flow:

```
bid → 20% deposit held (bid_hold)
    → deadline → highest qualifying bid wins
    → losers refunded in full, winner's deposit converts to farmer_escrow
    → winner pays remaining 80% → order confirmed
    → ship → buyer approves → farmer available balance → withdraw
```

Adds one state the full-payment model would not have needed: an order whose deposit is
held but whose balance is unpaid. If the winner never pays the balance, the deposit is
**forfeit to the farmer** as compensation for the wasted auction, and the lot is relisted.
That rule is the reason a deposit deters anything at all.

---

## 2. Farmer onboarding with approval + verification

### Status machine on the user

```
registered → phone_verified → documents_submitted → pending_review
    → approved      (can list produce)
    → rejected      (reason shown, may resubmit)
    → suspended     (admin action)
```

A farmer can browse and learn at any stage. **Listing produce requires `approved`.**
Enforced by middleware, not by hiding the UI button.

### Verification layers

| Layer | Mechanism | Honest limitation |
|---|---|---|
| Phone | OTP via SMS | needs an SMS provider; dev logs the code instead |
| Email (optional) | signed token link | — |
| NID | upload front/back images | **not** checked against the Election Commission |
| Face | selfie, compared to NID photo | similarity score only, advisory |
| | *computed locally — see below* | not a liveness check; a photo of a photo may pass |
| Farmer certificate | optional upload | admin reads it |

**On NID and face — the part I will not overstate.** Real NID verification in Bangladesh
goes through the Election Commission's API, which requires a government partnership this
project does not have. So what gets built is a **document-capture and admin-review
workflow** — which is what most platforms actually run at this stage — plus an optional
face-similarity score to *assist* the reviewer. The UI and the code will say "pending
admin review", never "government verified". Claiming otherwise in a portfolio project
would be a straightforward misrepresentation.

**Privacy weight.** NID images and selfies are sensitive personal data. Therefore:
stored in a private Cloudinary folder with signed time-limited URLs (never public),
never logged, access restricted to admin role, a documented retention rule, and a
deletion path once a decision is recorded.

### Admin review surface

A real admin queue: pending applications, document viewer with signed URLs, approve /
reject with reason, suspend, and an audit trail of who decided what and when.

---

## 3. Learning centre with certification

- **Curriculum as data**: tracks → modules → lessons. Each lesson is a YouTube video or
  an article, with a real checkable URL and attribution.
- **Progress tracking** per user per lesson.
- **Quiz per module**, pass mark 70%.
- **Certificate on track completion** — a verifiable page at `/certificate/:id` with a
  serial number.

**Honest framing:** these are *platform completion certificates*, not accredited
qualifications. The certificate itself will say so.

**On sourcing from the internet/YouTube:** content is seeded as a curated catalogue with
real video IDs and source attribution. Scraping YouTube at scale is fragile and against
its terms; the YouTube Data API can enrich titles/durations later behind a key. I will
not fabricate video IDs — every seeded link will be one I can point at.

---

## 4. Voice assistant on the advisory section

Browser-native **Web Speech API** — `SpeechRecognition` for input, `SpeechSynthesis` for
readback, both with `bn-BD`. Zero server cost, which matters on a free tier.

This is the single highest-value accessibility feature in the project: the target user may
read Bangla slowly or not at all, and speaking a question is dramatically easier than
typing Bengali on a phone keypad.

Limitations stated in the UI: needs a modern browser, needs network for recognition, and
Bangla recognition accuracy is materially worse than English. Text input always remains
available — voice is additive, never the only path.

---

## 5. Government schemes with profile matching

- Scheme catalogue: title, agency, benefit, deadline, official apply URL, step-by-step
  apply process, and **structured eligibility rules** (district, crops, land size, role).
- **Matching engine** scores a farmer's profile against those rules and explains *why*
  each scheme matched — an unexplained match is not actionable.
- Deadline reminders.

**On "auto-update from government":** there is no public Bangladesh government API for
subsidy programmes. Options are a scraper (fragile, breaks silently, legally grey) or
admin-curated entries. I will build the catalogue + matching engine with an admin CRUD and
a seeded set of real programmes, and design the ingestion boundary so a feed can be
plugged in later. Calling a hardcoded list "auto-updating" would be untrue.

---

## 6. Error and success messaging

Currently every API error carries a stable machine-readable `code`; the client mostly
shows raw messages. To add:

- A toast system, with every server `code` mapped to a translated bn/en message.
- Inline field errors from the existing Zod `details`.
- Optimistic-then-reconciled feedback on bids.
- Explicit, non-generic copy for the money paths — "you were outbid, your ৳X will be
  refunded when the auction closes" beats "error".

---

## Build order

Sequenced so nothing half-migrates the money model.

| Phase | Work | Why here |
|---|---|---|
| **0** | Toast/error system + `code`→message map | everything after this reports failures properly |
| **1** | User status machine, phone OTP, document upload, admin review queue | gates listing; no money touched |
| **2** | Pay-on-bid: `bid_hold` ledger, auto-close job, refund job, remove `acceptBid` | the risky one, done alone, with tests rewritten first |
| **3** | Withdrawal requests (farmer available balance → payout, admin-processed) | depends on phase 2 settling |
| **4** | Learning centre + quizzes + certificates | independent, no money |
| **5** | Government schemes + matching engine | independent, no money |
| **6** | Voice assistant on advisory | thin client-side layer |

Phase 2 is the one that can break working, tested behaviour, so it lands on its own with
its test suite rewritten before the implementation changes.

---

## Decisions taken

1. **20% refundable deposit** on bids, not full payment. See above.
2. **Automated face-similarity score, computed locally.** Rather than sending farmers'
   faces and NID photos to a third-party API — which would be a privacy decision disguised
   as a technical one — similarity is computed **on our own server** with an ONNX face
   embedding model and cosine distance. `onnxruntime-node` is already a dependency for the
   disease classifier, so this adds a model file rather than a service, a bill, or a data
   processor. No biometric data ever leaves the deployment. The score only *assists* an
   admin; it never auto-approves.
3. **Delivery is phase by phase**, verified after each. Phase 2 rewrites working tested
   money logic, so it lands alone with its tests rewritten first.

### Still open

**SMS provider for OTP.** No usable free tier exists for Bangladesh production SMS.
Development logs the code to the server console; a public demo needs either a paid
provider or email-only verification. Not blocking — the OTP mechanism is built either way
and the delivery channel is a single swappable adapter.
