import { describe, expect, it } from 'vitest';
import { buildConditionedQuery, rerankByConcepts, summarizeStateForPrompt } from '@/lib/tutor/conditioning';
import { buildDiagnoserPrompt, diagnoseTurn, parseDiagnosis } from '@/lib/tutor/diagnoser';
import { applyTurn, createInitialState } from '@/lib/tutor/learner-state';
import { miniGraph } from '@/lib/tutor/__tests__/fixtures';

describe('state-conditioned retrieval', () => {
  it('expands the query with the probed prerequisite and boosts its chunks', () => {
    const graph = miniGraph();
    const result = buildConditionedQuery('why does my backprop derivation fail?', graph, createInitialState(graph), {
      type: 'probe_prerequisite',
      conceptId: 'backprop',
      prerequisiteId: 'chain_rule',
      infoGain: 0.1,
    });
    expect(result.query).toContain('Chain rule');
    expect(result.boostConceptIds).toEqual(['chain_rule', 'backprop']);
  });

  it('adds active misconception descriptions to the query', () => {
    const graph = miniGraph();
    const state = applyTurn(createInitialState(graph), graph, [
      { conceptId: 'backprop', correct: false, misconceptionId: 'backprop.M1', confidence: 0.9 },
    ]);
    const result = buildConditionedQuery('explain backprop', graph, state, {
      type: 'remediate_misconception',
      conceptId: 'backprop',
      misconceptionId: 'backprop.M1',
    });
    expect(result.query).toContain('gradients flow forward');
  });

  it('reranks by concept overlap and keeps order on ties', () => {
    const hits = [
      { id: 'a', score: 0.5, conceptIds: ['derivatives'] },
      { id: 'b', score: 0.45, conceptIds: ['chain_rule'] },
      { id: 'c', score: 0.45, conceptIds: [] },
      { id: 'd', score: 0.45 },
    ];
    const ranked = rerankByConcepts(hits, ['chain_rule'], 0.1).map((h) => h.id);
    expect(ranked).toEqual(['b', 'a', 'c', 'd']);
  });

  it('summarizes only the relevant slice of the state', () => {
    const graph = miniGraph();
    const state = applyTurn(createInitialState(graph), graph, [
      { conceptId: 'backprop', correct: false, misconceptionId: 'backprop.M1', confidence: 0.9 },
    ]);
    const summary = summarizeStateForPrompt(state, graph, 'chain_rule');
    expect(summary).toContain('[chain_rule]');
    expect(summary).toContain('[derivatives]');
    expect(summary).toContain('believes "gradients flow forward');
    expect(summary).not.toContain('[vanishing_gradients]');
  });
});

describe('diagnoser parsing', () => {
  it('parses fenced JSON and drops unknown ids with warnings', () => {
    const graph = miniGraph();
    const raw = [
      '```json',
      JSON.stringify({
        target_concept_id: 'backprop',
        turn_kind: 'attempt',
        struggling: false,
        observations: [
          { concept_id: 'backprop', correct: false, misconception_id: 'backprop.M1', confidence: 1.4 },
          { concept_id: 'made_up', correct: true, misconception_id: null, confidence: 0.9 },
          { concept_id: 'chain_rule', correct: null, misconception_id: 'fake.M9', confidence: 0.5 },
        ],
      }),
      '```',
    ].join('\n');

    const result = parseDiagnosis(raw, graph);
    expect(result.targetConceptId).toBe('backprop');
    expect(result.struggling).toBe(true); // wrong answer on the target implies struggling
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0]).toMatchObject({ misconceptionId: 'backprop.M1', confidence: 1 });
    expect(result.observations[1]).toMatchObject({ conceptId: 'chain_rule', misconceptionId: null });
    expect(result.warnings).toHaveLength(2);
  });

  it('links an attempt to a pending discriminating probe', () => {
    const graph = miniGraph();
    const raw = JSON.stringify({
      target_concept_id: 'backprop',
      turn_kind: 'attempt',
      struggling: false,
      observations: [{ concept_id: 'backprop', correct: true, misconception_id: null, confidence: 0.9 }],
    });
    const result = parseDiagnosis(raw, graph, { conceptId: 'backprop', misconceptionId: 'backprop.M1' });
    expect(result.observations[0].probeOfMisconceptionId).toBe('backprop.M1');
  });

  it('fails closed on unparseable output', async () => {
    const graph = miniGraph();
    const result = await diagnoseTurn(
      graph,
      { previousTutorMessage: null, pendingProbe: null, studentMessage: 'hi' },
      async () => 'not json at all'
    );
    expect(result.observations).toEqual([]);
    expect(result.warnings[0]).toMatch(/could not be parsed/);
  });

  it('includes the concept and misconception catalog in the prompt', () => {
    const prompt = buildDiagnoserPrompt(miniGraph(), {
      previousTutorMessage: 'Which way do gradients flow?',
      pendingProbe: { conceptId: 'backprop', misconceptionId: 'backprop.M1' },
      studentMessage: 'forward',
    });
    expect(prompt).toContain('backprop.M1: gradients flow forward');
    expect(prompt).toContain('designed to detect misconception backprop.M1');
  });
});
