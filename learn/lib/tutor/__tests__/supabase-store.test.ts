import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createSupabaseTutorStore } from '@/lib/tutor/supabase-store';

type Result = { data: unknown; error: { code?: string; message: string } | null };

/** Records the query chain and resolves with a canned result, like a PostgREST builder. */
function fakeClient(result: Result) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'eq', 'maybeSingle']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: Result) => unknown) => resolve(result);
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const ROW = {
  graphId: 'g1',
  state: { schemaVersion: 1 as const, turn: 1, concepts: {} },
  tutorContext: { history: [], summary: null, pendingProbe: null },
};

describe('createSupabaseTutorStore.saveLearnerState', () => {
  it('updates only the row with the expected updated_at and reports conflict when none matched', async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    const outcome = await createSupabaseTutorStore(client).saveLearnerState('u', 'c', ROW, '2026-11-20T10:00:00+00:00');
    expect(outcome).toBe('conflict');
    expect(calls).toContainEqual(['from', 'learner_states']);
    expect(calls).toContainEqual(['eq', 'updated_at', '2026-11-20T10:00:00+00:00']);
    expect(calls).toContainEqual(['eq', 'user_id', 'u']);
    const update = calls.find(([method]) => method === 'update')![1] as Record<string, unknown>;
    expect(update).toMatchObject({ graph_id: 'g1', state: ROW.state, tutor_context: ROW.tutorContext });
    expect(typeof update.updated_at).toBe('string');
  });

  it('reports ok when the update matched a row', async () => {
    const { client } = fakeClient({ data: [{ id: 'x' }], error: null });
    expect(await createSupabaseTutorStore(client).saveLearnerState('u', 'c', ROW, 't')).toBe('ok');
  });

  it('inserts on first save and maps a unique violation to conflict', async () => {
    const { client, calls } = fakeClient({ data: null, error: { code: '23505', message: 'duplicate key' } });
    expect(await createSupabaseTutorStore(client).saveLearnerState('u', 'c', ROW, null)).toBe('conflict');
    expect(calls.some(([method]) => method === 'insert')).toBe(true);
  });

  it('throws on other database errors', async () => {
    const { client } = fakeClient({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(createSupabaseTutorStore(client).saveLearnerState('u', 'c', ROW, null)).rejects.toThrow('permission denied');
  });
});

describe('createSupabaseTutorStore loaders', () => {
  it('maps the learner_states row to StoredLearnerState', async () => {
    const { client } = fakeClient({
      data: { graph_id: 'g1', state: ROW.state, tutor_context: {}, updated_at: 't1' },
      error: null,
    });
    expect(await createSupabaseTutorStore(client).loadLearnerState('u', 'c')).toEqual({
      graphId: 'g1',
      state: ROW.state,
      tutorContext: { history: [], summary: null, pendingProbe: null },
      updatedAt: 't1',
    });
  });

  it('returns null when the class has no active graph', async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    expect(await createSupabaseTutorStore(client).loadActiveGraph('c')).toBeNull();
    expect(calls).toContainEqual(['eq', 'is_active', true]);
  });
});
