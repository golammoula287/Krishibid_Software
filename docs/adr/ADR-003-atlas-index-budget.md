# ADR-003 — RAG inside MongoDB Atlas, and the 3-index budget

**Status:** accepted · 2026-07-26

## Context

The RAG pillar needs vector search. Atlas M0 (free) **supports Atlas Vector Search**,
which means retrieval can live in the database the app already uses. But M0 permits a
**maximum of 3 search indexes** across both `search` and `vectorSearch` types, with
512 MB storage and ~100 ops/sec.

## Decision

Keep vectors in MongoDB. Allocate all three index slots explicitly, up front.

| # | Type | Collection | Purpose |
|---|---|---|---|
| 1 | `vectorSearch` | `kbChunks.embedding` | Dense semantic leg of retrieval |
| 2 | `search` (BM25) | `kbChunks.text` | Lexical leg of retrieval |
| 3 | `search` (BM25) | `listings` | Marketplace text search |

**Zero slots remain.** This is recorded so that a future full-text need is a known
trade-off rather than a surprise: it must either reuse slot 3 or the cluster moves to
Flex (10 indexes).

## Why not a dedicated vector database

Pinecone/Qdrant would each add a service to provision, monitor and hold credentials
for, plus a second consistency domain (a chunk deleted in Mongo but still in the
vector store returns a citation that resolves to nothing). Atlas keeps chunk text,
metadata and vector in one document, so retrieval and its source cannot drift apart.
It is also free, which the alternatives are only up to a point.

## Consequences

- `EMBEDDING_DIMENSIONS` must equal the index's `numDimensions`. A mismatch makes
  `$vectorSearch` return **zero results silently** — no error. Changing the embedding
  model therefore means re-ingesting and rebuilding the index; it is called out in
  `.env.example` for that reason.
- `cropTags` and `locale` are declared as index `filter` fields so narrowing happens
  *inside* the ANN traversal. Post-filtering would silently shrink recall — 20
  candidates pruned to 2 — with no signal that it happened.
- `$vectorSearch` and `$search` do not exist on a local `mongod` or before
  `npm run create:indexes`. Both retrieval legs therefore degrade rather than throw:
  the dense leg returns empty, the lexical leg falls back to a regex scan. Tests
  exercise the fallback, so a missing index is never a 500.
- 512 MB storage caps the corpus at roughly a few thousand chunks — ample for the
  300–600 target, not for a production KB.

## Rejected

- **pgvector on Postgres:** a good option, but it means abandoning MongoDB and the
  MERN stack for one feature.
- **In-memory vectors:** a free dyno restarts often, and re-embedding the corpus on
  every cold start would burn the embedding quota.
