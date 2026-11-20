import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoredLearnerState, TutorContext, TutorStore } from '@/lib/tutor/session-store';
import type { ConceptGraphSpec } from '@/lib/tutor/types';

/**
 * TutorStore backed by Supabase tables from supabase/06_LEARNER_STATE.sql.
 * Pass a client created with the *user's* access token so RLS enforces class membership.
 */
const UNIQUE_VIOLATION = '23505';

function normalizeContext(value: unknown): TutorContext {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<TutorContext>;
  return {
    history: Array.isArray(raw.history) ? raw.history : [],
    summary: typeof raw.summary === 'string' ? raw.summary : null,
    pendingProbe: raw.pendingProbe ?? null,
  };
}

export function createSupabaseTutorStore(client: SupabaseClient): TutorStore {
  return {
    async loadActiveGraph(classId) {
      const { data, error } = await client
        .from('concept_graphs')
        .select('id, spec')
        .eq('class_id', classId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { id: data.id as string, spec: data.spec as ConceptGraphSpec } : null;
    },

    async loadLearnerState(userId, classId) {
      const { data, error } = await client
        .from('learner_states')
        .select('graph_id, state, tutor_context, updated_at')
        .eq('user_id', userId)
        .eq('class_id', classId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        graphId: data.graph_id,
        state: data.state,
        tutorContext: normalizeContext(data.tutor_context),
        updatedAt: data.updated_at,
      } satisfies StoredLearnerState;
    },

    async saveLearnerState(userId, classId, row, expectedUpdatedAt) {
      const values = {
        graph_id: row.graphId,
        state: row.state,
        tutor_context: row.tutorContext,
        updated_at: new Date().toISOString(),
      };

      if (expectedUpdatedAt === null) {
        const { error } = await client.from('learner_states').insert({ user_id: userId, class_id: classId, ...values });
        if (error?.code === UNIQUE_VIOLATION) return 'conflict';
        if (error) throw new Error(error.message);
        return 'ok';
      }

      const { data, error } = await client
        .from('learner_states')
        .update(values)
        .eq('user_id', userId)
        .eq('class_id', classId)
        .eq('updated_at', expectedUpdatedAt)
        .select('id');
      if (error) throw new Error(error.message);
      return Array.isArray(data) && data.length > 0 ? 'ok' : 'conflict';
    },

    async appendEvent(event) {
      const { error } = await client.from('learner_events').insert({
        user_id: event.userId,
        class_id: event.classId,
        graph_id: event.graphId,
        turn: event.turn,
        diagnosis: event.diagnosis ?? {},
        decision: event.decision ?? {},
        mastery_after: event.masteryAfter,
      });
      if (error) throw new Error(error.message);
    },
  };
}
