import type { RetrievedChunk } from '@krishibid/shared';
import { describe, expect, it } from 'vitest';
import { salvageAnswerField, validateCitations } from './advisory.service.js';
import { reciprocalRankFusion } from './retrieval.service.js';

const candidate = (id: string) => ({
  id,
  text: `text-${id}`,
  title: `Title ${id}`,
  url: `https://example.test/${id}`,
});

describe('RAG — reciprocal rank fusion', () => {
  it('ranks a document appearing in both legs above one that dominates a single leg', () => {
    // "b" is 2nd in both legs; "a" is 1st in dense only. RRF should prefer the
    // consensus document — that is the whole point of fusing.
    const fused = reciprocalRankFusion(
      [
        { name: 'dense', results: [candidate('a'), candidate('b')] },
        { name: 'lexical', results: [candidate('c'), candidate('b')] },
      ],
      60,
    );

    expect(fused[0]!.id).toBe('b');
    expect(fused[0]!.denseRank).toBe(2);
    expect(fused[0]!.lexicalRank).toBe(2);
  });

  it('computes the documented 1/(k+rank) score', () => {
    const fused = reciprocalRankFusion([{ name: 'dense', results: [candidate('a')] }], 60);
    expect(fused[0]!.rrfScore).toBeCloseTo(1 / 61, 10);
  });

  it('sums contributions across legs', () => {
    const fused = reciprocalRankFusion(
      [
        { name: 'dense', results: [candidate('a')] },
        { name: 'lexical', results: [candidate('a')] },
      ],
      60,
    );
    expect(fused).toHaveLength(1);
    expect(fused[0]!.rrfScore).toBeCloseTo(2 / 61, 10);
  });

  it('handles one empty leg without dropping the other', () => {
    // This is the production degraded path: no embedding -> dense leg empty.
    const fused = reciprocalRankFusion(
      [
        { name: 'dense', results: [] },
        { name: 'lexical', results: [candidate('a'), candidate('b')] },
      ],
      60,
    );

    expect(fused.map((f) => f.id)).toEqual(['a', 'b']);
    expect(fused[0]!.denseRank).toBeUndefined();
  });

  it('returns nothing when both legs are empty', () => {
    expect(
      reciprocalRankFusion(
        [
          { name: 'dense', results: [] },
          { name: 'lexical', results: [] },
        ],
        60,
      ),
    ).toEqual([]);
  });

  it('produces a descending total order', () => {
    const fused = reciprocalRankFusion(
      [
        { name: 'dense', results: ['a', 'b', 'c', 'd'].map(candidate) },
        { name: 'lexical', results: ['d', 'c', 'b', 'a'].map(candidate) },
      ],
      60,
    );

    for (let i = 1; i < fused.length; i++) {
      expect(fused[i - 1]!.rrfScore).toBeGreaterThanOrEqual(fused[i]!.rrfScore);
    }
  });
});

describe('RAG — citation grounding guardrail', () => {
  const chunks: RetrievedChunk[] = [
    { id: '1', text: 't1', title: 'Rice Guide', url: 'https://x.test/1', rrfScore: 1 },
    { id: '2', text: 't2', title: 'Pest Manual', url: 'https://x.test/2', rrfScore: 0.5 },
  ];

  it('keeps valid markers and resolves them to sources', () => {
    const result = validateCitations(
      'Apply at flowering [1]. Then irrigate [2].',
      [1, 2],
      chunks,
    );

    expect(result.strippedCount).toBe(0);
    expect(result.citations).toHaveLength(2);
    expect(result.citations[0]).toMatchObject({ n: 1, title: 'Rice Guide' });
  });

  it('strips a hallucinated marker that points outside the retrieved set', () => {
    // The model invented [7]. Rendering it would show a farmer a source that does
    // not exist — the exact failure the guardrail exists to prevent.
    const result = validateCitations('Use 2kg per acre [1]. Spray weekly [7].', [1, 7], chunks);

    expect(result.strippedCount).toBe(1);
    expect(result.answer).not.toContain('[7]');
    expect(result.answer).toContain('[1]');
    expect(result.citations.map((c) => c.n)).toEqual([1]);
  });

  it('trusts markers in the prose over the model self-report', () => {
    // Model cited [2] in text but forgot to list it. The text is authoritative.
    const result = validateCitations('Irrigate twice [2].', [], chunks);
    expect(result.citations.map((c) => c.n)).toEqual([2]);
  });

  it('returns no citations for an answer that cites nothing', () => {
    const result = validateCitations('I am not sure about this.', [], chunks);
    expect(result.citations).toEqual([]);
    expect(result.strippedCount).toBe(0);
  });

  it('tidies whitespace left behind after stripping', () => {
    const result = validateCitations('Do this [9] and that.', [9], chunks);
    expect(result.answer).not.toMatch(/\s{2,}/);
    expect(result.answer).not.toContain('[9]');
  });

  it('handles a repeated bogus marker', () => {
    const result = validateCitations('A [5]. B [5]. C [1].', [5, 1], chunks);
    expect(result.answer).not.toContain('[5]');
    expect(result.citations.map((c) => c.n)).toEqual([1]);
  });
});

describe('RAG — salvaging truncated model output', () => {
  it('recovers the answer from JSON truncated mid-string', () => {
    // Exactly what a thinking model returns when it exhausts maxOutputTokens.
    const truncated = '{"answer":"আলুর নাবি ধ্বসা রোগ Phytophthora infestans দ্বারা হয় [1]। প্রতিকার';
    const out = salvageAnswerField(truncated);
    expect(out).toContain('Phytophthora infestans');
    expect(out).not.toContain('{"answer"');
  });

  it('unescapes newlines and quotes', () => {
    // `\\n` so the fixture holds the two-character escape sequence a model actually
    // emits. A single `\n` here would be a real newline, which is invalid inside a JSON
    // string — a different case, covered by the test below.
    const raw = '{"answer":"Line one.\\nLine \\"two\\".","sufficient":true}';
    expect(salvageAnswerField(raw)).toBe('Line one.\nLine "two".');
  });

  it('returns null when a real newline makes the JSON invalid', () => {
    expect(salvageAnswerField('{"answer":"Line one.\nLine two."}')).toBeNull();
  });

  it('recovers from complete, well-formed JSON too', () => {
    const raw = '{"answer":"Apply at flowering [1].","citedMarkers":[1],"sufficient":true}';
    expect(salvageAnswerField(raw)).toBe('Apply at flowering [1].');
  });

  it('returns null when there is nothing to salvage', () => {
    // Null rather than empty string, so the caller uses the honest "no answer" path
    // instead of rendering a blank bubble.
    expect(salvageAnswerField('')).toBeNull();
    expect(salvageAnswerField('total nonsense, no json here')).toBeNull();
    expect(salvageAnswerField('{"answer":""}')).toBeNull();
    expect(salvageAnswerField('{"sufficient":false}')).toBeNull();
  });
});
