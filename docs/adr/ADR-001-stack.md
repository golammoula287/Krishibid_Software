# ADR-001 — MERN + TypeScript, client/server split

**Status:** accepted · 2026-07-26

## Context

A solo build, ~2–3 months part-time, hosted entirely on free tiers, needing three
pillars: a bidding marketplace, CNN disease detection, and a Bangla RAG advisor.

## Decision

MERN with TypeScript end to end, in a conventional `client/` + `server/` layout with
a third `shared/` workspace for the API contract.

| Layer | Choice |
|---|---|
| Client | React 19 + Vite + TypeScript + Tailwind, installable PWA |
| Server | Node 22 + Express 5 + TypeScript, Mongoose |
| Database | MongoDB Atlas M0 — also the vector store (see ADR-003) |
| Realtime | Socket.IO |
| ML serving | ONNX Runtime for Node (see ADR-004) |
| AI | Provider interface, Gemini free tier by default (see ADR-002) |

## Why

**Express 5, not 4.** Route handlers `throw` and rely on async errors reaching the
error middleware. Express 4 does not propagate a rejected promise from an async
handler — it becomes an unhandled rejection and the request hangs. Express 4 would
mean wrapping every handler in an `asyncHandler`; Express 5 makes it native.

**A `shared/` workspace, not duplicated types.** Zod schemas are the single source of
truth: the server validates with them and the client imports the inferred types. A
field renamed on one side becomes a compile error on the other rather than a runtime
404 found in testing.

**Vite, not Next.js.** Every meaningful screen is authenticated, so there is nothing
to server-render for SEO, and Next would complicate deploying the frontend to a free
static host. Vite gives the fastest PWA build with the least infrastructure.

**Not a modular monolith with feature folders.** The original plan proposed
`modules/<feature>/`. Conventional MERN layering (`models → services → controllers →
routes`) was chosen instead because it is what a reviewer expects to find in a MERN
project, and because the layer boundary is where the interesting logic lives anyway.

## Consequences

- One language across the stack; no context-switching, one lint/test toolchain.
- Python exists only for offline training (`ml/`) and never ships to production.
- MongoDB is not a relational database, so transactional integrity in the bidding and
  payment paths had to be designed explicitly — see ADR-005 and ADR-006.

## Rejected

- **Dedicated vector DB (Pinecone/Qdrant):** Atlas covers it at zero extra cost or
  service count (ADR-003).
- **Redis:** free Redis tiers are unreliable and add a service to monitor. An
  in-process LRU plus a Mongo TTL collection is sufficient at demo scale.
- **Kubernetes/Docker Compose in production:** nothing to orchestrate; the free tiers
  deploy from git.
