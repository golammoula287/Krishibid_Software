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

`AI_PROVIDER=gemini` (default), `claude`, or `groq`. One env var, no code change.

**Only Gemini offers embeddings.** Neither Anthropic nor Groq has an embeddings
endpoint, so selecting either for generation must not silently break retrieval. The
factory returns a composite: chat on the chosen provider, embeddings always on Gemini,
and it **throws at construction** if the Gemini key is missing. Failing loudly matters
here — without it the app would boot cleanly and every question would return nothing.

| Provider | Role | Why not default |
|---|---|---|
| **Gemini** | default, chat + embeddings | — |
| **Claude** | paid upgrade for answer quality | no free tier |
| **Groq** | very fast, separate free quota | open models handle Bengali noticeably less well, and this is a Bangla-first advisor |

Groq earns its place despite that: its free tier is an **independent quota**, so when
Gemini's daily cap is exhausted the deployment is not dead. On a free-tier-only budget
a second quota is a resilience feature, not a luxury.

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

- `claude.ts` and `groq.ts` both throw on `embed()` — deliberate and unit-tested, since
  the composite never routes embeddings there.
- `pricing.ts` carries a rate table that must be updated when prices change. It reports
  free-tier usage as `$0` rather than a misleading synthetic cost.
- Structured output is enforced differently per provider, so the abstraction has to
  absorb a real capability gap:

  | Provider | Mechanism | Strength |
  |---|---|---|
  | Gemini | `responseSchema` | schema enforced by the API |
  | Claude | `output_config.format` | schema enforced by the API |
  | Groq | `response_format: json_object` | **valid JSON only, schema not enforced** |

  Groq therefore gets the schema described in its system prompt, and the caller's Zod
  parse is the actual guard. `advisory.service.ts` already treats a shape violation as a
  soft failure rather than trusting the model, which is what makes the weaker guarantee
  acceptable rather than dangerous.

## Model names are a moving target

`gemini-2.5-flash` was the original default and started returning **404 "no longer
available to new users"** during development — while still appearing in `listModels`.
Being listed is not the same as being callable.

Two lessons, both now reflected in the code: pin a specific named model rather than a
floating `-latest` alias (aliases silently change what the cost figure refers to, and
`gemini-flash-latest` failed the JSON-mode probe outright), and verify with a real call
rather than trusting a model list. The current verified default is `gemini-3.6-flash`.

## Rejected

- **Claude as default:** no free tier; would make the public demo cost money to run.
- **Self-hosted embeddings (multilingual-e5 / BGE-M3):** genuinely free and good at
  Bangla, but the model does not fit a 512 MB dyno alongside Node and the ONNX
  classifier.
- **Hardcoding one SDK:** cheapest today, but makes the free-tier decision permanent
  and cost unmeasurable.
