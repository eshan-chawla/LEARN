import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_CHARS, masteryView, parseTutorRequest } from '@/lib/tutor/api';
import { applyTurn, createInitialState } from '@/lib/tutor/learner-state';
import { miniGraph, MINI_SPEC } from '@/lib/tutor/__tests__/fixtures';

describe('parseTutorRequest', () => {
  it('accepts a trimmed message and normalizes the model', () => {
    expect(parseTutorRequest({ message: '  why?  ' })).toEqual({ ok: true, message: 'why?', model: 'gemini-2.5-flash-lite' });
    expect(parseTutorRequest({ message: 'q', model: 'gemini-2.5-pro' })).toMatchObject({ ok: true, model: 'gemini-2.5-pro' });
  });

  it('rejects empty, missing, non-object and oversized messages with 400', () => {
    for (const body of [null, 'text', {}, { message: '   ' }, { message: 42 }, { message: 'x'.repeat(MAX_MESSAGE_CHARS + 1) }]) {
      expect(parseTutorRequest(body)).toMatchObject({ ok: false, status: 400 });
    }
    expect(MAX_MESSAGE_CHARS).toBe(4000);
  });
});

describe('masteryView', () => {
  it('reports mastery and status for every concept in the graph', () => {
    const graph = miniGraph();
    const state = applyTurn(createInitialState(graph), graph, [
      { conceptId: 'backprop', correct: false, misconceptionId: 'backprop.M1', confidence: 0.9 },
    ]);
    const view = masteryView(MINI_SPEC, state);
    expect(Object.keys(view).sort()).toEqual([...graph.conceptIds].sort());
    expect(view.backprop.status).toBe('misconception');
    expect(view.derivatives).toEqual({ mastery: 0.3, status: 'unknown' });
  });

  it('fills concepts missing from a stale state with their prior', () => {
    const view = masteryView(MINI_SPEC, null);
    expect(view.chain_rule).toEqual({ mastery: 0.3, status: 'unknown' });
  });
});
