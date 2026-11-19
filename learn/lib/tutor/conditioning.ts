import type { ConceptGraph } from '@/lib/tutor/concept-graph';
import { activeMisconceptionIds, deriveStatus, getConceptState } from '@/lib/tutor/learner-state';
import type { TutorAction } from '@/lib/tutor/policy';
import { DEFAULT_THRESHOLDS, type LearnerState, type TutorThresholds } from '@/lib/tutor/types';

export interface ConditionedQuery {
  /** q' = q ⊕ terms(target) ⊕ terms(W) ⊕ desc(A_c) */
  query: string;
  /** Concepts whose tagged chunks receive the rerank bonus (target ∪ W). */
  boostConceptIds: string[];
}

function conceptTerms(graph: ConceptGraph, conceptId: string, maxKeywords = 3): string[] {
  const concept = graph.getConcept(conceptId);
  return [concept.name, ...(concept.keywords ?? []).slice(0, maxKeywords)];
}

/** Concepts the chosen action is really about, in priority order. */
function focusConcepts(action: TutorAction): string[] {
  switch (action.type) {
    case 'probe_prerequisite':
    case 'remediate_prerequisite':
      return [action.prerequisiteId, action.conceptId];
    case 'advance':
      return [action.nextConceptId];
    case 'answer':
      return action.conceptId ? [action.conceptId] : [];
    default:
      return [action.conceptId];
  }
}

/** Expands the student's query with the concepts and misconceptions the policy chose to address. */
export function buildConditionedQuery(
  rawQuery: string,
  graph: ConceptGraph,
  state: LearnerState,
  action: TutorAction,
  thresholds: TutorThresholds = DEFAULT_THRESHOLDS
): ConditionedQuery {
  const focus = focusConcepts(action).filter((id) => graph.has(id));
  const terms = new Set<string>();

  for (const conceptId of focus) {
    for (const term of conceptTerms(graph, conceptId)) terms.add(term);
    for (const misconceptionId of activeMisconceptionIds(getConceptState(state, conceptId), thresholds)) {
      const misconception = graph.getMisconception(misconceptionId);
      if (misconception) terms.add(misconception.description);
    }
  }

  // Drop expansion terms already present in the query to avoid over-weighting them in BM25.
  const lowerQuery = rawQuery.toLowerCase();
  const expansion = [...terms].filter((term) => !lowerQuery.includes(term.toLowerCase()));

  return {
    query: expansion.length > 0 ? `${rawQuery}\n${expansion.join('; ')}` : rawQuery,
    boostConceptIds: focus,
  };
}

/** r' = r + λ·|concepts(d) ∩ W|. Stable for ties so the original fused order is preserved. */
export function rerankByConcepts<T extends { score: number; conceptIds?: string[] | null }>(
  hits: T[],
  boostConceptIds: string[],
  lambda = 0.1
): T[] {
  const boost = new Set(boostConceptIds);
  return hits
    .map((hit, index) => ({
      hit,
      index,
      score: hit.score + lambda * (hit.conceptIds ?? []).filter((id) => boost.has(id)).length,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ hit, score }) => ({ ...hit, score }));
}

/**
 * Compact, token-bounded description of the relevant slice of S_t for the generator prompt:
 * the target, its ancestors, and every concept with an active misconception.
 */
export function summarizeStateForPrompt(
  state: LearnerState,
  graph: ConceptGraph,
  targetConceptId: string | null,
  thresholds: TutorThresholds = DEFAULT_THRESHOLDS
): string {
  const ids = new Set<string>();
  if (targetConceptId && graph.has(targetConceptId)) {
    ids.add(targetConceptId);
    for (const { conceptId } of graph.ancestorsWithin(targetConceptId, thresholds.gapSearchDepth)) {
      ids.add(conceptId);
    }
  }
  for (const conceptId of graph.conceptIds) {
    if (activeMisconceptionIds(getConceptState(state, conceptId), thresholds).length > 0) ids.add(conceptId);
  }

  if (ids.size === 0) return 'No learner-state evidence relevant to this question yet.';

  return graph.conceptIds
    .filter((id) => ids.has(id))
    .map((id) => {
      const conceptState = getConceptState(state, id);
      const status = deriveStatus(conceptState, thresholds);
      const misconceptions = activeMisconceptionIds(conceptState, thresholds)
        .map((mid) => `"${graph.getMisconception(mid)?.description ?? mid}"`)
        .join(', ');
      return `- ${graph.getConcept(id).name} [${id}]: ${status}, mastery ${conceptState.mastery.toFixed(2)}, ${conceptState.observations} graded obs${misconceptions ? `; believes ${misconceptions}` : ''}`;
    })
    .join('\n');
}
