# ADR-004 — Hybrid retrieval fused with Reciprocal Rank Fusion

**Status:** accepted · 2026-07-26

## Context

A farmer's question is often about an exact token: a pesticide name, a cultivar code,
a dosage, an NPK ratio. Dense embeddings compress those into "roughly agrochemical" —
the specific number they needed does not come back. Pure vector search is the default
RAG design and it fails precisely on the highest-stakes queries.

## Decision

Run both legs and fuse by rank.

1. **Dense** — `$vectorSearch`, `numCandidates: 150`, `limit: 20`, pre-filtered on
   `locale` and (when known) `cropSlug`.
2. **Lexical** — Atlas Search BM25 over the same collection, `limit: 20`.
3. **Fuse** — Reciprocal Rank Fusion, `k = 60`.
4. **Rerank** — one LLM scoring call over the fused top-10, keep top-4 as context.

```
score(d) = Σ over legs of  1 / (k + rank_leg(d))
```

## Why RRF rather than normalising and blending scores

The two legs produce **incomparable scales**: cosine similarity is bounded [-1, 1];
BM25 is unbounded and corpus-dependent. Min-max normalising them lets whichever leg
happens to have the wider score spread dominate — for reasons unrelated to relevance.
RRF consumes only *ranks*, so the calibration problem disappears. `k = 60` (the
original Cormack et al. value) damps top-rank influence just enough that a document
must do well in **both** legs to beat one that dominates a single leg.

RRF is implemented in application code (~15 lines, unit-tested) rather than via
MongoDB 8.1's native `$rankFusion`, so availability on M0 is not on the critical path.

## Why rerank at all, and why per-passage scores

Fusion optimises recall; the generation step needs precision in a small context
window. The rerank prompt asks for a **score per passage** rather than a sorted list,
because a model asked to "return the best 4 in order" drops and duplicates ids,
whereas scores are trivially validatable and let us keep our own tie-break (original
RRF order) for equal scores.

Rerank failure is non-fatal: on error or malformed output the RRF order is kept. A
degraded ordering beats failing a question the retrieval already answered.

## Consequences

- Two index slots consumed (ADR-003).
- Both legs run concurrently, so latency is the slower leg, not the sum.
- The eval script compares dense-only vs hybrid vs hybrid+rerank on a golden set, so
  this decision is **measured rather than asserted** — the recall@4 delta is the
  intended headline number for the README.
- One extra LLM call per question, which counts against the free-tier cap. Hence the
  answer cache and the per-user hourly limit.

## Rejected

- **Dense-only:** the default, and the reason exact-term queries fail.
- **BM25-only:** cannot handle paraphrase, which is most of how questions are asked.
- **Cross-encoder reranker (bge-reranker):** better quality, but another model that
  will not fit a 512 MB dyno.
