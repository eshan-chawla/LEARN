import { describe, expect, it } from 'vitest';
import {
  abstentionCorrect,
  citationPrecision,
  citedIndices,
  isAbstention,
  recallAtK,
  summarize,
} from '@/eval/single-turn-metrics';
import type { RetrievalHit } from '@/lib/retrieval/types';
import { ABSTAIN_MESSAGE } from '@/lib/tutor/critic-types';

function hit(fileName: string, pageNumber: number): RetrievalHit {
  return {
    score: 1, text: 't', classId: 'c', contentType: 'pdf', sourceId: 's', title: null, fileName, storagePath: null,
    pageNumber, pageChunkIndex: null, chunkIndex: null, startSeconds: null, endSeconds: null,
    transcriptChunkIndex: null, transcriptLanguage: null,
  };
}

const HITS = [hit('lec03.pdf', 12), hit('lec03.pdf', 13), hit('lec04.pdf', 2)];
const GOLD = [{ file_name: 'lec03.pdf', page: 12 }];

describe('citations', () => {
  it('extracts distinct [n] markers including grouped ones', () => {
    expect(citedIndices('A [1]. B [3][1]. C [2, 3].')).toEqual([1, 3, 2]);
    expect(citedIndices('no citations')).toEqual([]);
  });

  it('citationPrecision counts only cited excerpts matching gold file+page', () => {
    expect(citationPrecision([1, 3], HITS, GOLD)).toBe(0.5);
    expect(citationPrecision([1], HITS, GOLD)).toBe(1);
    expect(citationPrecision([9], HITS, GOLD)).toBe(0); // marker pointing at no excerpt is wrong
    expect(citationPrecision([], HITS, GOLD)).toBeNull();
    expect(citationPrecision([1], HITS, null)).toBeNull();
  });
});

describe('recallAtK', () => {
  it('is the fraction of gold sources in the top k', () => {
    expect(recallAtK(HITS, [...GOLD, { file_name: 'lec04.pdf', page: 2 }], 2)).toBe(0.5);
    expect(recallAtK(HITS, [...GOLD, { file_name: 'lec04.pdf', page: 2 }], 5)).toBe(1);
  });

  it('recallAtK is null without gold', () => {
    expect(recallAtK(HITS, null)).toBeNull();
    expect(recallAtK(HITS, [])).toBeNull();
  });
});

describe('abstention', () => {
  it('recognizes guardrail, critic and integrity refusals', () => {
    expect(isAbstention(ABSTAIN_MESSAGE)).toBe(true);
    expect(isAbstention('I could not find that in the selected resources.')).toBe(true);
    expect(isAbstention("I can't solve graded work for you, but here is a hint.")).toBe(true);
    expect(isAbstention('Backprop applies the chain rule [1].')).toBe(false);
  });

  it('abstentionCorrect for each item type', () => {
    expect(abstentionCorrect('in_scope', 'Backprop applies the chain rule [1].')).toBe(true);
    expect(abstentionCorrect('in_scope', ABSTAIN_MESSAGE)).toBe(false);
    expect(abstentionCorrect('out_of_scope', 'I could not find that in the selected resources.')).toBe(true);
    expect(abstentionCorrect('out_of_scope', 'The capital of France is Paris.')).toBe(false);
    expect(abstentionCorrect('integrity', "I can't solve graded work for you.")).toBe(true);
  });
});

describe('summarize', () => {
  it('averages non-null values and reports latency percentiles', () => {
    const summary = summarize([
      { judge: 1, citationPrecision: 1, recallAt5: null, abstentionCorrect: true, faithfulness: null, latencyTotalMs: 100 },
      { judge: 0, citationPrecision: null, recallAt5: 0.5, abstentionCorrect: false, faithfulness: null, latencyTotalMs: 300 },
    ]);
    expect(summary).toMatchObject({
      n: 2, correctness: 0.5, citationPrecision: 1, recallAt5: 0.5, abstentionAccuracy: 0.5, faithfulness: null,
      latencyP50Ms: 100, latencyP95Ms: 300,
    });
  });
});
