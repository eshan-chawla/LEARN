import { describe, expect, it } from 'vitest';
import { buildCriticPrompt, checkClaims, toBool, toCitationList } from '@/lib/tutor/critic';
import type { CitedExcerpt } from '@/lib/tutor/critic-types';

const EXCERPTS: CitedExcerpt[] = [
  { index: 1, text: 'Backpropagation applies the chain rule layer by layer.', sourceId: 's1', pageNumber: 12, startSeconds: null },
  { index: 2, text: 'Gradients are propagated from the loss back to the inputs.', sourceId: 's1', pageNumber: 13, startSeconds: null },
  { index: 3, text: 'Vanishing gradients slow learning in deep sigmoid networks.', sourceId: 'v1', pageNumber: null, startSeconds: 95.4 },
];

describe('buildCriticPrompt', () => {
  it('numbers excerpts with their source location and includes question and answer', () => {
    const prompt = buildCriticPrompt({ question: 'What is backprop?', answer: 'It uses the chain rule [1].', excerpts: EXCERPTS });
    expect(prompt).toContain('[1] (page 12) Backpropagation applies the chain rule');
    expect(prompt).toContain('[3] (at 95s) Vanishing gradients');
    expect(prompt).toContain('QUESTION: What is backprop?');
    expect(prompt).toContain('ANSWER: It uses the chain rule [1].');
  });

  it('tells the model to judge only against cited excerpts and to flag graded work', () => {
    const prompt = buildCriticPrompt({ question: 'q', answer: 'a', excerpts: [] });
    expect(prompt).toContain('(no excerpts)');
    expect(prompt).toMatch(/cited excerpts, read on their own/);
    expect(prompt).toMatch(/graded assignment/);
  });
});

describe('tolerant field parsing', () => {
  it('reads booleans in several shapes and defaults to false', () => {
    expect([true, 'true', 'YES', 1, '1'].map(toBool)).toEqual([true, true, true, true, true]);
    expect([false, 'no', 0, null, undefined, {}].map(toBool)).toEqual([false, false, false, false, false, false]);
  });

  it('reads citation lists in several shapes, deduped, integers only', () => {
    expect(toCitationList([1, 2, 2])).toEqual([1, 2]);
    expect(toCitationList(['[1]', '3'])).toEqual([1, 3]);
    expect(toCitationList('1, 3')).toEqual([1, 3]);
    expect(toCitationList(2)).toEqual([2]);
    expect(toCitationList([1.5, 'x', null])).toEqual([]);
  });
});

describe('checkClaims citation rules', () => {
  it('keeps a supported claim that cites existing excerpts', () => {
    const warnings: string[] = [];
    const [claim] = checkClaims(
      [{ claim: 'Backprop uses the chain rule.', citations: [1], supported: true, reason: 'Stated in [1].' }],
      EXCERPTS,
      warnings
    );
    expect(claim).toEqual({ claim: 'Backprop uses the chain rule.', citations: [1], supported: true, reason: 'Stated in [1].' });
    expect(warnings).toEqual([]);
  });

  it('marks an uncited claim unsupported even if the model said supported', () => {
    const [claim] = checkClaims([{ claim: 'ReLU fixes everything.', citations: [], supported: true, reason: 'common knowledge' }], EXCERPTS, []);
    expect(claim.supported).toBe(false);
    expect(claim.reason).toMatch(/No citation/);
  });

  it('marks a claim citing a missing excerpt unsupported and warns', () => {
    const warnings: string[] = [];
    const [claim] = checkClaims([{ claim: 'Adam converges faster.', citations: [1, 7], supported: true, reason: 'ok' }], EXCERPTS, warnings);
    expect(claim.supported).toBe(false);
    expect(claim.reason).toMatch(/missing excerpt\(s\) \[7\]/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('[7]');
  });

  it('skips malformed entries but throws when claims is not an array', () => {
    expect(checkClaims([null, 'x', { claim: '' }, { claim: 'ok', citations: [2], supported: true }], EXCERPTS, [])).toHaveLength(1);
    expect(() => checkClaims({ claim: 'x' }, EXCERPTS, [])).toThrow(/claims array/);
  });
});
