# KrishiBid

[![CI](https://github.com/golammoula287/Krishibid_Software/actions/workflows/ci.yml/badge.svg)](https://github.com/golammoula287/Krishibid_Software/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb&logoColor=white)
![Tests](https://img.shields.io/badge/tests-58%20passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

A farmer-to-buyer **bidding marketplace** with **escrow payments**, **CNN crop-disease
detection**, and a **Bangla RAG advisory assistant**, built for smallholder farmers in
Bangladesh.

> **Status:** feature-complete backend and frontend, 58 passing tests, not yet
> deployed. The disease model ships as a placeholder until the training notebook is
> run (see [Disease model](#4-disease-model-optional)).

---

## The problem

A smallholder farmer in Bangladesh sells through layers of intermediaries who each
take a margin, with no visibility into a fair price. Separately, crop disease that a
photo could catch early is usually caught after yield is already lost, because expert
advice does not reach a non-English-speaking user on a low-end phone at the moment
they need it.

Three pillars address exactly that:

| Pillar | What it does |
|---|---|
| **Bidding marketplace** | Farmers list a lot; buyers bid in a live window; escrow holds the money until delivery |
| **Disease detection** | Photo of a leaf → top-3 diagnosis with confidence, and a remedy — or an explicit "not sure, see an officer" |
| **Bangla RAG advisor** | Farming questions in Bangla, answered **only** from a cited knowledge base |

---

## Architecture

```mermaid
flowchart TB
    subgraph C["client/ — installable PWA"]
        UI["React 19 · Vite · Tailwind"]
        SW["Service worker<br/>offline shell · image cache"]
        UI <--> SW
    end

    subgraph S["server/ — Express 5 + Mongoose"]
        R["routes → controllers → services"]
        J["jobs<br/>close auctions · auto-release escrow"]
        WS["Socket.IO<br/>live bids"]
    end

    subgraph D["MongoDB Atlas M0"]
        COL["users · listings · bids · orders<br/>payments · ledgerEntries<br/>kbChunks · chatSessions"]
        IDX["vectorSearch + 2× BM25<br/>(all 3 M0 slots)"]
    end

    AI["services/ai<br/>Gemini free tier ⇄ Claude"]
    GW["SSLCOMMERZ<br/>bKash · Nagad · card"]
    ONNX["ONNX Runtime<br/>MobileNetV3-Small"]

    C -->|REST| S
    C <-->|WebSocket| WS
    S --> COL
    S --> IDX
    S --> AI
    S --> ONNX
    S <-->|IPN verified server-to-server| GW
```

Shared Zod schemas in `shared/` are the single source of truth for the API contract —
a field renamed on one side is a compile error on the other.

---

## Quick start

```bash
git clone <your-repo-url> && cd Krishibid
npm install
cp .env.example .env      # then fill in the blanks below
npm run seed              # demo users, 40 listings, one order awaiting payment
npm run dev               # server :5000 + client :5173
```

Open <http://localhost:5173> and use a **one-click demo login** — no signup needed.

### Minimum `.env` to boot

| Key | Where to get it |
|---|---|
| `MONGODB_URI` | [Atlas](https://www.mongodb.com/cloud/atlas/register) → free M0 cluster |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `openssl rand -base64 48` (twice) |
| `GEMINI_API_KEY` | [AI Studio](https://aistudio.google.com/apikey) — free |

Everything else is optional in development. Without Cloudinary, images are stored
inline; without SSLCOMMERZ, payment routes return 503; without the ONNX model,
`/api/diagnosis` returns 503 — the rest of the app runs regardless.

---

## Full setup

### 1. Atlas search indexes

```bash
npm run create:indexes
```

Creates all three (vector + 2× BM25). **M0 allows a maximum of 3** — see
[ADR-003](docs/adr/ADR-003-atlas-index-budget.md). Atlas builds them asynchronously;
allow a minute.

### 2. Knowledge base

```bash
npm run ingest:kb
```

Chunks, embeds and upserts `server/src/scripts/kbSources.ts`. Idempotent — chunks are
keyed by content hash, so re-running updates rather than duplicating. Expand
`kbSources.ts` toward 300–600 chunks before a real demo; keep the real
title/URL/section on every document so citations resolve to something checkable.

### 3. Payments (SSLCOMMERZ sandbox)

Register for [sandbox credentials](https://developer.sslcommerz.com/registration/) and
set `SSLCZ_STORE_ID` / `SSLCZ_STORE_PASSWORD`.

> **`API_PUBLIC_URL` must be publicly reachable.** SSLCOMMERZ delivers the IPN
> server-to-server, so with `localhost` it never fires and payments sit in `pending`
> forever. Use a tunnel in development:
>
> ```bash
> cloudflared tunnel --url http://localhost:5000
> # then set API_PUBLIC_URL to the https URL it prints
> ```

### 4. Disease model (optional)

The repo ships a **placeholder** `labels.json` and no `.onnx`. To train:

```bash
cd ml && pip install -r requirements.txt
# run notebooks/train_disease_cnn.ipynb (Colab free GPU, ~10 min)
python export_onnx.py --checkpoint artifacts/best.pt --version v1
```

Then point `DISEASE_MODEL_PATH` at the exported file and restart. Check
`GET /api/diagnosis/health`.

---

## How the money works

Payment is **not** a redirect that flips a flag. The flow:

```
bid accepted → awaiting_payment
   buyer pays  → SSLCOMMERZ hosted checkout
   IPN         → signature check → server-to-server re-validate → amount compared
               → ledger: gateway_clearing −X, farmer_escrow +X   → confirmed
   farmer ships                                                   → in_transit
   buyer confirms (or 7-day auto-release)
               → ledger: escrow −X, available +net, revenue +commission → completed
```

Three things worth knowing:

- **Escrow is a ledger, not a vault.** Holding third-party funds needs a
  payment-institution licence, so money sits in the platform's merchant account and an
  immutable double-entry ledger records whose it is. Every transaction must sum to
  zero or nothing is written. Balances are always derived, never stored.
- **The browser redirect writes no state.** `/payment/success` is user-reachable, so
  only the verified IPN can move money.
- **Auto-release exists for the farmer.** Without it a buyer who stops responding
  strands the money forever. Raising a dispute freezes the clock.

Full reasoning: [ADR-006](docs/adr/ADR-006-escrow-payments.md).

---

## Testing

```bash
npm test          # 58 tests
npm run typecheck
npm run build
```

Runs against `MongoMemoryReplSet` — a **replica set, not a standalone `mongod`** —
because the accept-bid and payment paths use multi-document transactions that a
standalone rejects outright. Testing against a standalone would leave the code most
worth testing never executed.

### RAG retrieval evaluation

```bash
npm run seed && npm run ingest:kb   # prerequisites
npm run eval:rag                    # writes docs/rag-eval.md
```

Compares **dense-only vs hybrid vs hybrid+rerank** on a hand-labelled golden set
(`server/src/scripts/goldenSet.ts`), reporting recall@4, MRR, the refusal rate on
deliberately unanswerable questions, and citation validity. This exists so ADR-004's
claim that hybrid beats dense-only is **measured rather than asserted** — if the
numbers come out flat, the ADR is wrong and should change.

The golden set deliberately includes a question asking for a specific pesticide dose
the sources do not state. Inventing a number there is the most harmful failure this
pillar can produce, so it is tested rather than hoped about.

> Needs a populated KB and live API quota, so it is **not** run in CI — the committed
> `docs/rag-eval.md` is the record.

### The two suites that matter most

- **50-way bid concurrency** — 50 buyers bid simultaneously; asserts exactly one
  active bid, that it *is* the listing's recorded winner, and that `version`
  incremented once per accepted bid. This test caught a real reconciliation race
  during development (documented in
  [ADR-005](docs/adr/ADR-005-bidding-concurrency.md)).
- **Ledger invariants** — refuses unbalanced, single-leg, zero-amount and non-integer
  postings; proves immutability; proves balances are derived and escrow drains to
  exactly zero on release.

---

## Layout

```
Krishibid/
├─ client/               React PWA
│  └─ src/{pages,components,lib,locales}
├─ server/               Express API
│  └─ src/{models,services,controllers,routes,middleware,jobs,sockets,utils,scripts}
├─ shared/src/           Zod schemas + types — the API contract
├─ ml/                   Training + ONNX export (never deployed)
├─ docs/adr/             Architecture decision records
└─ .github/workflows/    CI: typecheck → test → build → bundle budget
```

---

## Decisions

| ADR | Decision |
|---|---|
| [001](docs/adr/ADR-001-stack.md) | MERN + TypeScript, client/server split, Express 5 for native async errors |
| [002](docs/adr/ADR-002-ai-provider.md) | AI behind a provider interface; Gemini free tier default, Claude one env var away |
| [003](docs/adr/ADR-003-atlas-index-budget.md) | RAG inside Atlas; all 3 free-tier index slots allocated up front |
| [004](docs/adr/ADR-004-hybrid-retrieval.md) | Hybrid dense + BM25 fused with RRF — why not score normalisation |
| [005](docs/adr/ADR-005-bidding-concurrency.md) | Atomic conditional updates for bids, transactions for accepts |
| [006](docs/adr/ADR-006-escrow-payments.md) | Escrow as a double-entry ledger; IPN trust model |

---

## Deployment (free tier)

| Component | Host | Constraint |
|---|---|---|
| Client | Cloudflare Pages | none meaningful |
| Server | Render / Fly.io | 512 MB RAM, sleeps when idle |
| Database | Atlas M0 | 512 MB, 3 search indexes |
| Images | Cloudinary | 25 GB bandwidth/month |
| AI | Gemini free tier | ~10 RPM / 1,500 RPD |

Free-tier caps are handled in code, not hoped away: a 24 h answer cache, per-user
hourly chat limits, and degradation to retrieval-only citations when the LLM quota is
exhausted (`degraded: true`, surfaced in the UI rather than hidden).

---

## Known limitations

- **The disease model is lab-trained.** PlantVillage images are single-leaf on uniform
  backgrounds; field accuracy will be materially lower. The API withholds any
  prediction below 0.60 confidence and refers the farmer to an extension officer
  instead of guessing.
- **Payouts are manual.** `farmer_available` means "owed and withdrawable", not
  "already sent".
- **Bids are online-only.** No offline bid queue — queuing a bid on a device that
  reconnects after the auction closed would create phantom bids. Deliberately not
  built.
- **The KB is a starter corpus.** Enough to prove the pipeline; expand before claiming
  coverage.

---

## Roadmap

Weather and pest alerts · price/yield forecasting · government subsidy aggregator ·
agri-officer analytics dashboard · automated payouts · native app.

Deferred on purpose — see the reasoning in the project plan rather than treating these
as missing features.
