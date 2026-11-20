import { DEFAULT_ASK_AI_MODEL, normalizeAskAiModel, type AskAiModel } from '@/lib/ask-ai/models';
import { ConceptGraph } from '@/lib/tutor/concept-graph';
import { createInitialState, deriveStatus, reconcileState } from '@/lib/tutor/learner-state';
import type { ConceptGraphSpec, ConceptStatus, LearnerState } from '@/lib/tutor/types';

/** Request/response helpers for /api/tutor/[classId], kept out of the route so they are testable. */
export const MAX_MESSAGE_CHARS = 4000;

export type MasteryView = Record<string, { mastery: number; status: ConceptStatus }>;

export type ParsedTutorRequest =
  | { ok: true; message: string; model: AskAiModel }
  | { ok: false; status: 400; error: string };

export function parseTutorRequest(body: unknown, defaultModel: AskAiModel = DEFAULT_ASK_AI_MODEL): ParsedTutorRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Request body must be a JSON object' };
  }
  const { message, model } = body as Record<string, unknown>;
  if (typeof message !== 'string' || !message.trim()) {
    return { ok: false, status: 400, error: 'message is required' };
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return { ok: false, status: 400, error: `message must be at most ${MAX_MESSAGE_CHARS} characters` };
  }
  return { ok: true, message: message.trim(), model: normalizeAskAiModel(model, defaultModel) };
}

/** Per-concept mastery and status for the mastery map; a null/stale state is reconciled to the graph. */
export function masteryView(spec: ConceptGraphSpec, state: LearnerState | null): MasteryView {
  const graph = new ConceptGraph(spec);
  const aligned = state ? reconcileState(state, graph) : createInitialState(graph);
  return Object.fromEntries(
    graph.conceptIds.map((id) => {
      const concept = aligned.concepts[id];
      return [id, { mastery: Number(concept.mastery.toFixed(4)), status: deriveStatus(concept) }];
    })
  );
}
