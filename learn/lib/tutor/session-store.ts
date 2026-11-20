import { ConceptGraph } from '@/lib/tutor/concept-graph';
import { reconcileState } from '@/lib/tutor/learner-state';
import {
  createSession,
  runTutorTurn,
  type ChatTurn,
  type PendingProbe,
  type TutorConfig,
  type TutorDeps,
  type TutorSession,
  type TutorTurnResult,
} from '@/lib/tutor/pipeline';
import type { ConceptGraphSpec, LearnerState } from '@/lib/tutor/types';

/** Persisted in learner_states.tutor_context. */
export interface TutorContext {
  history: ChatTurn[];
  summary: string | null;
  pendingProbe: PendingProbe | null;
}

export interface StoredLearnerState {
  graphId: string;
  state: LearnerState;
  tutorContext: TutorContext;
  updatedAt: string;
}

export interface TutorEvent {
  userId: string;
  classId: string;
  graphId: string;
  turn: number;
  diagnosis: unknown;
  decision: unknown;
  masteryAfter: Record<string, number>;
}

export interface TutorStore {
  loadActiveGraph(classId: string): Promise<{ id: string; spec: ConceptGraphSpec } | null>;
  loadLearnerState(userId: string, classId: string): Promise<StoredLearnerState | null>;
  /** Insert when expectedUpdatedAt is null, otherwise update only if the row is unchanged. */
  saveLearnerState(
    userId: string,
    classId: string,
    row: Omit<StoredLearnerState, 'updatedAt'>,
    expectedUpdatedAt: string | null
  ): Promise<'ok' | 'conflict'>;
  appendEvent(event: TutorEvent): Promise<void>;
}

export type TutorTurnOutcome =
  | { status: 'ok'; result: TutorTurnResult; graph: ConceptGraphSpec }
  | { status: 'no_graph' }
  | { status: 'conflict' };

export const STORED_HISTORY_TURNS = 6;

/** The app always runs the full system: structured state + critic; hybrid once J1 is deployed. */
export function appTutorConfig(env: Record<string, string | undefined> = process.env): TutorConfig {
  return { rag: env.TUTOR_RAG_MODE === 'hybrid' ? 'hybrid' : 'dense', critic: true, memory: 'structured' };
}

function restoreSession(stored: StoredLearnerState | null, graph: ConceptGraph): TutorSession {
  if (!stored) return createSession(graph);
  const context = stored.tutorContext ?? { history: [], summary: null, pendingProbe: null };
  const probe = context.pendingProbe;
  const probeValid =
    probe && graph.has(probe.conceptId) && (!probe.misconceptionId || graph.getMisconception(probe.misconceptionId));
  return {
    state: reconcileState(stored.state, graph),
    history: Array.isArray(context.history) ? context.history : [],
    summary: context.summary ?? null,
    pendingProbe: probeValid ? probe : null,
  };
}

export function masterySnapshot(state: LearnerState): Record<string, number> {
  return Object.fromEntries(Object.entries(state.concepts).map(([id, c]) => [id, Number(c.mastery.toFixed(4))]));
}

/** Load → run one structured tutor turn → save with optimistic concurrency → log the event. */
export async function handleTutorTurn(
  store: TutorStore,
  args: { userId: string; classId: string; message: string },
  deps: TutorDeps,
  config: TutorConfig = appTutorConfig()
): Promise<TutorTurnOutcome> {
  const active = await store.loadActiveGraph(args.classId);
  if (!active) return { status: 'no_graph' };
  const graph = new ConceptGraph(active.spec);

  const stored = await store.loadLearnerState(args.userId, args.classId);
  const result = await runTutorTurn(
    { classId: args.classId, graph, session: restoreSession(stored, graph), studentMessage: args.message },
    config,
    deps
  );

  const saved = await store.saveLearnerState(
    args.userId,
    args.classId,
    {
      graphId: active.id,
      state: result.session.state,
      tutorContext: {
        history: result.session.history.slice(-STORED_HISTORY_TURNS),
        summary: result.session.summary,
        pendingProbe: result.session.pendingProbe,
      },
    },
    stored?.updatedAt ?? null
  );
  if (saved === 'conflict') return { status: 'conflict' };

  try {
    await store.appendEvent({
      userId: args.userId,
      classId: args.classId,
      graphId: active.id,
      turn: result.session.state.turn,
      diagnosis: result.diagnosis,
      decision: result.decision,
      masteryAfter: masterySnapshot(result.session.state),
    });
  } catch (error) {
    // The state is already saved; a missing log row must not turn the reply into an error.
    result.warnings.push(`Event log write failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { status: 'ok', result, graph: active.spec };
}
