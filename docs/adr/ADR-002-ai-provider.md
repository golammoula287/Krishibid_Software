# ADR-002 — AI behind a provider interface; Gemini free tier as the default

**Status:** accepted · 2026-07-26

## Context

The RAG advisor needs embeddings and text generation. The hosting budget is free
tiers only. **The Claude API has no free tier**, so it cannot be the default — but
free tiers carry hard daily caps, and a demo that dies on quota is worse than one
that costs a few cents.

## Decision

All model calls go through one interface (`server/src/services/ai/`):

```ts
interface AiProvider {
  embed(texts: string[]): Promise<EmbedResult>;
  complete(prompt: string, options?: CompleteOptions): Promise<CompleteResult>;
}
```

`AI_PROVIDER=gemini` (default) or `claude`. One env var, no code change.

**Anthropic has no embeddings endpoint.** Selecting Claude must not silently break
retrieval, so the factory returns a composite: generation on Claude, embeddings still
on Gemini. That is the genuinely useful configuration, not a compromise — Gemini's
free embedding allowance is generous, and generation is where answer quality is won.

## Why an interface rather than calling the SDK directly

1. **Honesty about the constraint.** The free tier is a deployment choice, not an
   architectural one. Isolating it means revisiting the choice is one line.
2. **Cost becomes measurable.** Every call returns token counts and an estimated
   cost, so `/metrics` reports cost-per-RAG-query — the number that actually says
   whether the free tier is sustainable.
3. **Quota exhaustion is a first-class case.** `AiQuotaError` is distinguished from a
   generic failure, because the correct response differs: on quota the advisory
   endpoint degrades to returning retrieved passages with citations and sets
   `degraded: true`, rather than serving a 503. The farmer still gets the source
   material, and the UI says plainly that synthesis was skipped.

## Consequences

- A `claude.ts` that throws on `embed()` — deliberate and documented, since the
  composite never routes embeddings there.
- `pricing.ts` carries a rate table that must be updated when prices change. It
  reports free-tier usage as `$0` rather than a misleading synthetic cost.
- Structured output is enforced per provider (Gemini `responseSchema`, Claude
  `output_config.format`) so `sufficient` is a real signal, not scraped prose.

## Rejected

- **Claude as default:** no free tier; would make the public demo cost money to run.
- **Self-hosted embeddings (multilingual-e5 / BGE-M3):** genuinely free and good at
  Bangla, but the model does not fit a 512 MB dyno alongside Node and the ONNX
  classifier.
- **Hardcoding one SDK:** cheapest today, but makes the free-tier decision permanent
  and cost unmeasurable.
