import { describe, expect, it } from 'vitest';
import {
  applyObservation,
  applyTurn,
  binaryEntropy,
  bktPosterior,
  bktUpdate,
  createInitialState,
  deriveStatus,
  expectedInformationGain,
  reconcileState,
} from '@/lib/tutor/learner-state';
import { miniGraph } from '@/lib/tutor/__tests__/fixtures';

const PARAMS = { pInit: 0.3, pTransit: 0.1, pSlip: 0.1, pGuess: 0.2 };

describe('BKT math', () => {
  it('matches hand-computed posteriors', () => {
    // correct: 0.3·0.9 / (0.3·0.9 + 0.7·0.2) = 0.27 / 0.41
    expect(bktPosterior(0.3, true, PARAMS)).toBeCloseTo(0.27 / 0.41, 10);
    // incorrect: 0.3·0.1 / (0.3·0.1 + 0.7·0.8) = 0.03 / 0.59
    expect(bktPosterior(0.3, false, PARAMS)).toBeCloseTo(0.03 / 0.59, 10);
  });

  it('applies the learning transition after the posterior (κ = 1 is standard BKT)', () => {
    const posterior = 0.27 / 0.41;
    expect(bktUpdate(0.3, true, 1, PARAMS)).toBeCloseTo(posterior + (1 - posterior) * 0.1, 10);
  });

  it('scales the evidence by diagnoser confidence κ', () => {
    // κ = 0: no evidence, only the transition: 0.3 + 0.7·0.1
    expect(bktUpdate(0.3, false, 0, PARAMS)).toBeCloseTo(0.37, 10);
    const half = bktUpdate(0.3, false, 0.5, PARAMS);
    expect(half).toBeLessThan(0.37);
    expect(half).toBeGreaterThan(bktUpdate(0.3, false, 1, PARAMS));
  });

  it('computes entropy and expected information gain', () => {
    expect(binaryEntropy(0.5)).toBeCloseTo(1, 10);
    expect(binaryEntropy(0)).toBe(0);
    expect(expectedInformationGain(0, PARAMS)).toBe(0);
    expect(expectedInformationGain(1, PARAMS)).toBe(0);

    const p = 0.4;
    const pCorrect = p * 0.9 + (1 - p) * 0.2;
    const expected =
      binaryEntropy(p) -
      (pCorrect * binaryEntropy(bktPosterior(p, true, PARAMS)) +
        (1 - pCorrect) * binaryEntropy(bktPosterior(p, false, PARAMS)));
    expect(expectedInformationGain(p, PARAMS)).toBeCloseTo(expected, 12);
    expect(expectedInformationGain(p, PARAMS)).toBeGreaterThan(0);
  });
});

describe('learner state updates', () => {
  it('initializes every concept at its prior with unknown status', () => {
    const graph = miniGraph();
    const state = createInitialState(graph);
    expect(Object.keys(state.concepts)).toHaveLength(graph.conceptIds.length);
    expect(state.concepts.backprop.mastery).toBe(0.3);
    expect(deriveStatus(state.concepts.backprop)).toBe('unknown');
  });

  it('does not mutate the input state', () => {
    const graph = miniGraph();
    const state = createInitialState(graph);
    const next = applyObservation(state, graph, { conceptId: 'chain_rule', correct: true, confidence: 1 });
    expect(state.concepts.chain_rule.observations).toBe(0);
    expect(next.concepts.chain_rule.observations).toBe(1);
    expect(next.concepts.chain_rule.mastery).toBeGreaterThan(0.3);
  });

  it('mentions without correctness evidence update recency only', () => {
    const graph = miniGraph();
    const next = applyObservation(createInitialState(graph), graph, {
      conceptId: 'chain_rule',
      correct: null,
      confidence: 1,
    });
    expect(next.concepts.chain_rule.mastery).toBe(0.3);
    expect(next.concepts.chain_rule.observations).toBe(0);
    expect(next.concepts.chain_rule.lastSeenTurn).toBe(0);
  });

  it('reaches mastered after consistent correct answers', () => {
    const graph = miniGraph();
    let state = createInitialState(graph);
    for (let i = 0; i < 3; i += 1) {
      state = applyTurn(state, graph, [{ conceptId: 'chain_rule', correct: true, confidence: 1 }]);
    }
    expect(state.turn).toBe(3);
    expect(deriveStatus(state.concepts.chain_rule)).toBe('mastered');
  });

  it('accumulates misconception evidence and clears it only via a correct probe answer', () => {
    const graph = miniGraph();
    let state = applyTurn(createInitialState(graph), graph, [
      { conceptId: 'backprop', correct: false, misconceptionId: 'backprop.M1', confidence: 0.7 },
    ]);
    expect(state.concepts.backprop.misconceptions['backprop.M1'].confidence).toBeCloseTo(0.7, 10);
    expect(deriveStatus(state.concepts.backprop)).toBe('misconception');

    state = applyTurn(state, graph, [
      { conceptId: 'backprop', correct: false, misconceptionId: 'backprop.M1', confidence: 0.7 },
    ]);
    // 1 - (1-0.7)(1-0.7) = 0.91
    expect(state.concepts.backprop.misconceptions['backprop.M1'].confidence).toBeCloseTo(0.91, 10);
    expect(state.concepts.backprop.misconceptions['backprop.M1'].evidenceTurns).toEqual([0, 1]);

    // A generic correct answer does not clear it...
    state = applyTurn(state, graph, [{ conceptId: 'backprop', correct: true, confidence: 1 }]);
    expect(deriveStatus(state.concepts.backprop)).toBe('misconception');

    // ...a correct answer to the discriminating probe does: 0.91 · (1 - 0.9) = 0.091
    state = applyTurn(state, graph, [
      { conceptId: 'backprop', correct: true, probeOfMisconceptionId: 'backprop.M1', confidence: 0.9 },
    ]);
    expect(state.concepts.backprop.misconceptions['backprop.M1'].confidence).toBeCloseTo(0.091, 10);
    expect(deriveStatus(state.concepts.backprop)).not.toBe('misconception');
  });

  it('treats a failed discriminating probe as misconception evidence', () => {
    const graph = miniGraph();
    const state = applyTurn(createInitialState(graph), graph, [
      { conceptId: 'backprop', correct: false, probeOfMisconceptionId: 'backprop.M1', confidence: 0.8 },
    ]);
    expect(state.concepts.backprop.misconceptions['backprop.M1'].confidence).toBeCloseTo(0.8, 10);
  });

  it('rejects observations on unknown concepts', () => {
    const graph = miniGraph();
    expect(() =>
      applyObservation(createInitialState(graph), graph, { conceptId: 'nope', correct: true, confidence: 1 })
    ).toThrow(/unknown concept/);
  });

  it('reconciles a persisted state with an evolved graph', () => {
    const graph = miniGraph();
    const state = applyTurn(createInitialState(graph), graph, [
      { conceptId: 'chain_rule', correct: true, confidence: 1 },
    ]);
    const stale = { ...state, concepts: { ...state.concepts, removed_concept: state.concepts.chain_rule } };
    delete (stale.concepts as Record<string, unknown>).derivatives;

    const reconciled = reconcileState(stale, graph);
    expect(reconciled.concepts.removed_concept).toBeUndefined();
    expect(reconciled.concepts.derivatives.mastery).toBe(0.3);
    expect(reconciled.concepts.chain_rule.observations).toBe(1);
    expect(reconciled.turn).toBe(1);
  });
});
