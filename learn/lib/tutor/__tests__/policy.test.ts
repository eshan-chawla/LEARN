import { describe, expect, it } from 'vitest';
import { applyTurn, createInitialState, expectedInformationGain } from '@/lib/tutor/learner-state';
import { findGapCandidates, hintLevel, nextZpdConcept, selectNextAction } from '@/lib/tutor/policy';
import type { LearnerState } from '@/lib/tutor/types';
import { miniGraph } from '@/lib/tutor/__tests__/fixtures';

function withMastery(state: LearnerState, values: Record<string, number>, observations = 3): LearnerState {
  const next = structuredClone(state);
  for (const [id, mastery] of Object.entries(values)) {
    next.concepts[id].mastery = mastery;
    next.concepts[id].observations = observations;
  }
  return next;
}

describe('hintLevel', () => {
  it('gives more explicit hints at lower mastery', () => {
    expect(hintLevel(0.05, 3)).toBe(3);
    expect(hintLevel(0.5, 3)).toBe(2);
    expect(hintLevel(0.9, 3)).toBe(1);
    expect(hintLevel(1, 3)).toBe(1);
  });
});

describe('selectNextAction', () => {
  it('answers without a target concept', () => {
    const graph = miniGraph();
    const decision = selectNextAction({
      state: createInitialState(graph),
      graph,
      targetConceptId: null,
      turnKind: 'question',
      struggling: false,
    });
    expect(decision.primary).toEqual({ type: 'answer', conceptId: null, concise: false });
  });

  it('prioritizes an active misconception over everything else', () => {
    const graph = miniGraph();
    const state = applyTurn(createInitialState(graph), graph, [
      { conceptId: 'backprop', correct: false, misconceptionId: 'backprop.M1', confidence: 0.9 },
    ]);
    const decision = selectNextAction({ state, graph, targetConceptId: 'backprop', turnKind: 'attempt', struggling: true });
    expect(decision.primary).toEqual({
      type: 'remediate_misconception',
      conceptId: 'backprop',
      misconceptionId: 'backprop.M1',
    });
  });

  it('probes the prerequisite with maximum expected information gain when gaps are unobserved', () => {
    const graph = miniGraph();
    // Unobserved prerequisites at different priors → different information gains.
    const state = structuredClone(createInitialState(graph));
    state.concepts.chain_rule.mastery = 0.45;
    state.concepts.gradient_descent.mastery = 0.1;
    state.concepts.matrix_multiplication.mastery = 0.2;
    state.concepts.derivatives.mastery = 0.05;

    const decision = selectNextAction({ state, graph, targetConceptId: 'backprop', turnKind: 'attempt', struggling: true });
    const params = graph.bktFor('chain_rule');
    const expectedBest = ['chain_rule', 'gradient_descent', 'matrix_multiplication', 'derivatives'].sort(
      (a, b) => expectedInformationGain(state.concepts[b].mastery, params) - expectedInformationGain(state.concepts[a].mastery, params)
    )[0];

    expect(decision.primary.type).toBe('probe_prerequisite');
    expect(decision.primary).toMatchObject({ conceptId: 'backprop', prerequisiteId: expectedBest });
  });

  it('remediates a prerequisite once there is evidence it is weak', () => {
    const graph = miniGraph();
    let state = withMastery(createInitialState(graph), {
      derivatives: 0.95,
      gradient_descent: 0.95,
      matrix_multiplication: 0.95,
    });
    state = applyTurn(state, graph, [{ conceptId: 'chain_rule', correct: false, confidence: 1 }]);

    const decision = selectNextAction({ state, graph, targetConceptId: 'backprop', turnKind: 'attempt', struggling: true });
    expect(decision.primary).toEqual({ type: 'remediate_prerequisite', conceptId: 'backprop', prerequisiteId: 'chain_rule' });
    expect(decision.followUp).toEqual({ type: 'formative_question', conceptId: 'chain_rule' });
  });

  it('never remediates mastered prerequisites — falls back to a hint', () => {
    const graph = miniGraph();
    const state = withMastery(createInitialState(graph), {
      derivatives: 0.95,
      chain_rule: 0.95,
      gradient_descent: 0.95,
      matrix_multiplication: 0.95,
      backprop: 0.4,
    });
    expect(findGapCandidates(state, graph, 'backprop')).toEqual([]);

    const decision = selectNextAction({ state, graph, targetConceptId: 'backprop', turnKind: 'attempt', struggling: true });
    expect(decision.primary).toEqual({ type: 'hint', conceptId: 'backprop', level: 2 });
  });

  it('advances to the zone of proximal development after mastery', () => {
    const graph = miniGraph();
    const state = withMastery(createInitialState(graph), {
      derivatives: 0.95,
      chain_rule: 0.95,
      gradient_descent: 0.95,
      matrix_multiplication: 0.95,
      backprop: 0.95,
    });
    const decision = selectNextAction({ state, graph, targetConceptId: 'backprop', turnKind: 'attempt', struggling: false });
    expect(decision.primary).toEqual({ type: 'advance', fromConceptId: 'backprop', nextConceptId: 'vanishing_gradients' });
  });

  it('asks a formative question after a correct but unmastered attempt', () => {
    const graph = miniGraph();
    const decision = selectNextAction({
      state: createInitialState(graph),
      graph,
      targetConceptId: 'derivatives',
      turnKind: 'attempt',
      struggling: false,
    });
    expect(decision.primary).toEqual({ type: 'formative_question', conceptId: 'derivatives' });
  });

  it('answers questions concisely when mastered and checks understanding when evidence is thin', () => {
    const graph = miniGraph();
    const fresh = createInitialState(graph);
    const thin = selectNextAction({ state: fresh, graph, targetConceptId: 'derivatives', turnKind: 'question', struggling: false });
    expect(thin.primary).toEqual({ type: 'answer', conceptId: 'derivatives', concise: false });
    expect(thin.followUp).toEqual({ type: 'formative_question', conceptId: 'derivatives' });

    const mastered = withMastery(fresh, { derivatives: 0.95 });
    const decision = selectNextAction({ state: mastered, graph, targetConceptId: 'derivatives', turnKind: 'question', struggling: false });
    expect(decision.primary).toEqual({ type: 'answer', conceptId: 'derivatives', concise: true });
    expect(decision.followUp).toBeNull();
  });
});

describe('nextZpdConcept', () => {
  it('only offers concepts whose prerequisites are all mastered', () => {
    const graph = miniGraph();
    const state = createInitialState(graph);
    // Nothing mastered: only root concepts are ready.
    expect(['derivatives', 'matrix_multiplication']).toContain(nextZpdConcept(state, graph, null));
    const someMastered = withMastery(state, { derivatives: 0.95 });
    expect(nextZpdConcept(someMastered, graph, 'derivatives')).toBe('chain_rule');
  });
});

describe('scripted trajectories: hidden prerequisite gaps', () => {
  const graph = miniGraph();
  const below = ['derivatives', 'chain_rule', 'gradient_descent', 'matrix_multiplication'];

  /** A student lacking `gap` also cannot do anything that depends on it. */
  function knownConcepts(gap: string) {
    const unknown = new Set([gap]);
    for (const id of graph.conceptIds) {
      if (graph.ancestorsWithin(id, 10).some((a) => a.conceptId === gap)) unknown.add(id);
    }
    return new Set(below.filter((id) => !unknown.has(id)));
  }

  it.each(below)('localizes a hidden %s gap without remediating known concepts', (gap) => {
    const knows = knownConcepts(gap);
    let state = createInitialState(graph);
    const remediated: string[] = [];
    let probes = 0;

    for (let turn = 0; turn < 10 && remediated.length === 0; turn += 1) {
      const { primary } = selectNextAction({ state, graph, targetConceptId: 'backprop', turnKind: 'attempt', struggling: true });
      if (primary.type === 'probe_prerequisite') {
        probes += 1;
        // Simulated student answers the probe according to the hidden truth.
        state = applyTurn(state, graph, [
          { conceptId: primary.prerequisiteId, correct: knows.has(primary.prerequisiteId), confidence: 1 },
        ]);
      } else if (primary.type === 'remediate_prerequisite') {
        remediated.push(primary.prerequisiteId);
      } else {
        throw new Error(`Unexpected action ${primary.type}`);
      }
    }

    expect(remediated).toEqual([gap]);
    expect(probes).toBeLessThanOrEqual(below.length);
  });
});
