import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/lib/tutor/learner-state';
import type { TutorDeps } from '@/lib/tutor/pipeline';
import {
  appTutorConfig,
  handleTutorTurn,
  type StoredLearnerState,
  type TutorEvent,
  type TutorStore,
} from '@/lib/tutor/session-store';
import { ConceptGraph } from '@/lib/tutor/concept-graph';
import type { ConceptGraphSpec } from '@/lib/tutor/types';
import { MINI_SPEC } from '@/lib/tutor/__tests__/fixtures';

const USER = 'user-1';
const CLASS = 'class-1';

/** In-memory TutorStore with the same optimistic-concurrency contract as the Supabase store. */
function memoryStore(graph: { id: string; spec: ConceptGraphSpec } | null, initial: StoredLearnerState | null = null) {
  let row = initial;
  let clock = 0;
  const events: TutorEvent[] = [];
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const store: TutorStore = {
    async loadActiveGraph() {
      await tick();
      return graph;
    },
    async loadLearnerState() {
      await tick();
      return row ? structuredClone(row) : null;
    },
    async saveLearnerState(_user, _klass, next, expectedUpdatedAt) {
      await tick();
      if ((row?.updatedAt ?? null) !== expectedUpdatedAt) return 'conflict';
      clock += 1;
      row = { ...structuredClone(next), updatedAt: `t${clock}` };
      return 'ok';
    },
    async appendEvent(event) {
      events.push(event);
    },
  };
  return { store, events, current: () => row };
}

function fakeDeps(diagnosis: object = { target_concept_id: null, turn_kind: 'other', struggling: false, observations: [] }) {
  const prompts: string[] = [];
  const deps: TutorDeps = {
    complete: vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return prompt.includes('diagnostic module')
        ? JSON.stringify(diagnosis)
        : JSON.stringify({ action: { type: 'answer' }, reply: 'Reply.' });
    }),
    retrieve: vi.fn(async () => []),
  };
  return { deps, prompts };
}

describe('handleTutorTurn', () => {
  it('creates initial state on first turn and appends one event', async () => {
    const { store, events, current } = memoryStore({ id: 'g1', spec: MINI_SPEC });
    const { deps } = fakeDeps({
      target_concept_id: 'chain_rule', turn_kind: 'attempt', struggling: true,
      observations: [{ concept_id: 'chain_rule', correct: false, misconception_id: null, confidence: 1 }],
    });

    const outcome = await handleTutorTurn(store, { userId: USER, classId: CLASS, message: 'wrong answer' }, deps);

    expect(outcome.status).toBe('ok');
    const saved = current()!;
    expect(saved.graphId).toBe('g1');
    expect(saved.state.concepts.chain_rule.observations).toBe(1);
    expect(saved.tutorContext.history).toHaveLength(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: USER, classId: CLASS, graphId: 'g1', turn: saved.state.turn });
    expect(events[0].masteryAfter.chain_rule).toBeCloseTo(saved.state.concepts.chain_rule.mastery);
    expect(events[0].decision).toBeTruthy();
  });

  it('returns no_graph when the class has no active graph', async () => {
    const { store, events } = memoryStore(null);
    const { deps } = fakeDeps();
    expect(await handleTutorTurn(store, { userId: USER, classId: CLASS, message: 'hi' }, deps)).toEqual({ status: 'no_graph' });
    expect(deps.complete).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('returns conflict when the state changed since it was loaded', async () => {
    const { store, events } = memoryStore({ id: 'g1', spec: MINI_SPEC });
    const [a, b] = await Promise.all([
      handleTutorTurn(store, { userId: USER, classId: CLASS, message: 'tab one' }, fakeDeps().deps),
      handleTutorTurn(store, { userId: USER, classId: CLASS, message: 'tab two' }, fakeDeps().deps),
    ]);
    expect([a.status, b.status].sort()).toEqual(['conflict', 'ok']);
    expect(events).toHaveLength(1);
  });

  it('reconciles state when the active graph version changed', async () => {
    const oldSpec: ConceptGraphSpec = {
      ...MINI_SPEC,
      concepts: MINI_SPEC.concepts.filter((c) => c.id !== 'vanishing_gradients').concat({ id: 'old_concept', name: 'Old' }),
      edges: MINI_SPEC.edges.filter((e) => e.to !== 'vanishing_gradients'),
    };
    const oldState = createInitialState(new ConceptGraph(oldSpec));
    oldState.concepts.backprop.mastery = 0.77;
    const { store, current } = memoryStore(
      { id: 'g2', spec: MINI_SPEC },
      {
        graphId: 'g1',
        state: oldState,
        tutorContext: { history: [], summary: null, pendingProbe: { conceptId: 'old_concept', misconceptionId: null } },
        updatedAt: 't0',
      }
    );
    const { deps, prompts } = fakeDeps();

    const outcome = await handleTutorTurn(store, { userId: USER, classId: CLASS, message: 'hi' }, deps);

    expect(outcome.status).toBe('ok');
    const saved = current()!;
    expect(saved.graphId).toBe('g2');
    expect(saved.state.concepts.vanishing_gradients).toBeDefined();
    expect(saved.state.concepts).not.toHaveProperty('old_concept');
    expect(saved.state.concepts.backprop.mastery).toBe(0.77);
    expect(prompts[0]).not.toContain('old_concept');
  });

  it('caps stored history at 6 turns', async () => {
    const { store, current } = memoryStore({ id: 'g1', spec: MINI_SPEC });
    for (let i = 0; i < 5; i += 1) {
      const outcome = await handleTutorTurn(store, { userId: USER, classId: CLASS, message: `message ${i}` }, fakeDeps().deps);
      expect(outcome.status).toBe('ok');
    }
    const history = current()!.tutorContext.history;
    expect(history).toHaveLength(6);
    expect(history.at(-2)).toEqual({ role: 'student', content: 'message 4' });
  });
});

describe('appTutorConfig', () => {
  it('uses structured memory with the critic and dense retrieval unless hybrid is enabled', () => {
    expect(appTutorConfig({})).toEqual({ rag: 'dense', critic: true, memory: 'structured' });
    expect(appTutorConfig({ TUTOR_RAG_MODE: 'hybrid' }).rag).toBe('hybrid');
  });
});
