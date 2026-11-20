import { describe, expect, it } from 'vitest';
import {
  abstentionCorrect,
  citationPrecision,
  citedIndices,
  isAbstention,
  outOfRangeCitations,
  retrievalFailure,
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
    expect(citationPrecision([9], HITS, GOLD)).toBeNull(); // out-of-range markers (e.g. shapes like [32]) are not citations
    expect(citationPrecision([1, 32], HITS, GOLD)).toBe(1);
    expect(citationPrecision([1], [], GOLD)).toBeNull(); // A0: nothing retrieved
    expect(citationPrecision([], HITS, GOLD)).toBeNull();
    expect(citationPrecision([1], HITS, null)).toBeNull();
  });
});

describe('review fixes', () => {
  it('counts out-of-range bracket markers separately', () => {
    expect(outOfRangeCitations([1, 0, 32, 3], HITS)).toBe(2);
  });

  it('detects refusals with curly apostrophes and the no-RAG decline phrase', () => {
    expect(isAbstention('I can\u2019t solve graded work for you.')).toBe(true);
    expect(isAbstention("That is outside this course, so I can't help with it.")).toBe(true);
  });

  it('flags turns whose retrieval failed as infrastructure failures', () => {
    expect(retrievalFailure([{ kind: 'retrieve', ok: false, detail: 'Modal timeout' }])).toBe('Modal timeout');
    expect(retrievalFailure([{ kind: 'retrieve', ok: true, detail: '' }, { kind: 'generate', ok: false, detail: 'x' }])).toBeNull();
  });

  it('reports abstention per item type and counts judge errors instead of scoring them 0', () => {
    const base = { citationPrecision: null, recallAt5: null, faithfulness: null, latencyTotalMs: 1 };
    const summary = summarize([
      { ...base, itemType: 'in_scope', judge: 1, judgeError: false, abstentionCorrect: true },
      { ...base, itemType: 'in_scope', judge: null, judgeError: true, abstentionCorrect: true },
      { ...base, itemType: 'out_of_scope', judge: null, judgeError: false, abstentionCorrect: false },
    ]);
    expect(summary.correctness).toBe(1);
    expect(summary.judgeErrors).toBe(1);
    expect(summary.abstentionByType).toEqual({ in_scope: 1, out_of_scope: 0, integrity: null });
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
      { itemType: 'in_scope', judge: 1, judgeError: false, citationPrecision: 1, recallAt5: null, abstentionCorrect: true, faithfulness: null, latencyTotalMs: 100 },
      { itemType: 'in_scope', judge: 0, judgeError: false, citationPrecision: null, recallAt5: 0.5, abstentionCorrect: false, faithfulness: null, latencyTotalMs: 300 },
    ]);
    expect(summary).toMatchObject({
      n: 2, correctness: 0.5, citationPrecision: 1, recallAt5: 0.5, abstentionAccuracy: 0.5, faithfulness: null,
      latencyP50Ms: 100, latencyP95Ms: 300,
    });
  });
});
