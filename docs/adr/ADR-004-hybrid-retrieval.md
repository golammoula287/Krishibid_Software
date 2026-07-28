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
- `npm run eval:rag` compares dense-only vs hybrid vs hybrid+rerank on a hand-labelled
  golden set and writes `docs/rag-eval.md`. Not run in CI: it needs a populated KB and
  live API quota.

## Measured result — the claim is currently UNPROVEN

First live run, 2026-07-27, against Atlas Vector Search + Atlas Search with Gemini
embeddings:

| Configuration | recall@4 | MRR |
|---|---|---|
| Dense only | 72.7% | 0.727 |
| Hybrid (RRF) | 72.7% | 0.727 |
| Hybrid + rerank | 72.7% | 0.727 |

**No delta.** This ADR said that if the numbers came out flat the decision should be
revised rather than defended, so: as measured, hybrid retrieval is not yet justified by
evidence.

The reason is corpus size, not mechanism. **The corpus is 8 chunks and k = 4** — half of
everything in the knowledge base lands in the context window regardless of ranking, so
there is essentially no ranking problem left for fusion to solve. The metric cannot
distinguish the configurations at this size; it is uninformative rather than negative.

Both legs were verified working independently, so the flat result is not a broken
pipeline:

- Dense returns sensible cosine scores (1.000 / 0.909 / 0.863 on a self-match probe).
- **BM25 retrieved the potato late-blight document for the query `Phytophthora
  infestans`** — precisely the exact-Latin-term case this ADR predicts dense retrieval
  smears away. The mechanism works; it just does not change recall@4 when k covers half
  the corpus.

**What would settle it:** re-run at 300+ chunks, where k = 4 is a genuine selection
problem. Until then the honest statement is "hybrid is implemented and its lexical leg
demonstrably matches exact terms, but its benefit is unmeasured on this corpus" — not
"hybrid improved recall by X".

Two secondary findings from the same run, both now reflected elsewhere: the Gemini free
tier allows **5 requests/minute** on `gemini-3.6-flash` (tighter than the ~10 assumed),
and the quota-degradation path worked correctly under real 429s — answers fell back to
retrieval-only with valid citations and `degraded: true` rather than erroring. Refusal on
unanswerable questions was **100%** and citation validity **100%**, both meaningful at
any corpus size.
- One extra LLM call per question, which counts against the free-tier cap. Hence the
  answer cache and the per-user hourly limit.

## Rejected

- **Dense-only:** the default, and the reason exact-term queries fail.
- **BM25-only:** cannot handle paraphrase, which is most of how questions are asked.
- **Cross-encoder reranker (bge-reranker):** better quality, but another model that
  will not fit a 512 MB dyno.
