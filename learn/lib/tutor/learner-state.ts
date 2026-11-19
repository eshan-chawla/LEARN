import type { ConceptGraph } from '@/lib/tutor/concept-graph';
import {
  DEFAULT_THRESHOLDS,
  type BktParams,
  type ConceptState,
  type ConceptStatus,
  type LearnerState,
  type Observation,
  type TutorThresholds,
} from '@/lib/tutor/types';

const EPSILON = 1e-9;

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** S_0: every concept at its BKT prior P(L0), no observations. */
export function createInitialState(graph: ConceptGraph): LearnerState {
  const concepts: Record<string, ConceptState> = {};
  for (const conceptId of graph.conceptIds) {
    concepts[conceptId] = {
      conceptId,
      mastery: graph.bktFor(conceptId).pInit,
      observations: 0,
      lastSeenTurn: null,
      misconceptions: {},
    };
  }
  return { schemaVersion: 1, turn: 0, concepts };
}

/**
 * Re-aligns a persisted state with the current graph: concepts added to the graph get their
 * prior, concepts removed from the graph are dropped. Lets the graph evolve without migrations.
 */
export function reconcileState(state: LearnerState, graph: ConceptGraph): LearnerState {
  const fresh = createInitialState(graph);
  for (const conceptId of graph.conceptIds) {
    if (state.concepts[conceptId]) {
      fresh.concepts[conceptId] = structuredClone(state.concepts[conceptId]);
    }
  }
  fresh.turn = state.turn;
  return fresh;
}

/** P(y = 1 | p): probability of a correct answer under the BKT observation model. */
export function probabilityCorrect(mastery: number, params: BktParams): number {
  return mastery * (1 - params.pSlip) + (1 - mastery) * params.pGuess;
}

/** BKT posterior P(L | y) before the learning transition. */
export function bktPosterior(mastery: number, correct: boolean, params: BktParams): number {
  const { pSlip: s, pGuess: g } = params;
  const p = clamp01(mastery);
  if (correct) {
    const numerator = p * (1 - s);
    return numerator / Math.max(numerator + (1 - p) * g, EPSILON);
  }
  const numerator = p * s;
  return numerator / Math.max(numerator + (1 - p) * (1 - g), EPSILON);
}

/**
 * Confidence-weighted BKT update:
 *   p' = κ·P(L|y) + (1-κ)·p,   p ← p' + (1-p')·T
 * With κ = 1 this is standard BKT.
 */
export function bktUpdate(
  mastery: number,
  correct: boolean,
  confidence: number,
  params: BktParams
): number {
  const kappa = clamp01(confidence);
  const posterior = bktPosterior(mastery, correct, params);
  const blended = kappa * posterior + (1 - kappa) * mastery;
  return clamp01(blended + (1 - blended) * params.pTransit);
}

/** Binary entropy in bits. */
export function binaryEntropy(p: number): number {
  const q = clamp01(p);
  if (q <= EPSILON || q >= 1 - EPSILON) return 0;
  return -(q * Math.log2(q) + (1 - q) * Math.log2(1 - q));
}

/**
 * Expected information gain (bits) about mastery from asking one probe question:
 *   IG = H(p) - Σ_y P(y|p) · H(P(L|y))
 */
export function expectedInformationGain(mastery: number, params: BktParams): number {
  const pCorrect = probabilityCorrect(mastery, params);
  const expectedPosteriorEntropy =
    pCorrect * binaryEntropy(bktPosterior(mastery, true, params)) +
    (1 - pCorrect) * binaryEntropy(bktPosterior(mastery, false, params));
  return Math.max(0, binaryEntropy(mastery) - expectedPosteriorEntropy);
}

export function activeMisconceptionIds(
  conceptState: ConceptState,
  thresholds: TutorThresholds = DEFAULT_THRESHOLDS
): string[] {
  return Object.entries(conceptState.misconceptions)
    .filter(([, evidence]) => evidence.confidence >= thresholds.misconceptionActive)
    .sort((left, right) => right[1].confidence - left[1].confidence)
    .map(([id]) => id);
}

/**
 * σ_c derived from the numeric state (see paper Sec. III-C). `misconception` is checked first
 * so a concept flagged only through misconception evidence is not hidden as `unknown`.
 */
export function deriveStatus(
  conceptState: ConceptState,
  thresholds: TutorThresholds = DEFAULT_THRESHOLDS
): ConceptStatus {
  if (activeMisconceptionIds(conceptState, thresholds).length > 0) return 'misconception';
  if (conceptState.observations === 0) return 'unknown';
  if (conceptState.mastery >= thresholds.mastered) return 'mastered';
  return 'learning';
}

export function getConceptState(state: LearnerState, conceptId: string): ConceptState {
  const conceptState = state.concepts[conceptId];
  if (!conceptState) throw new Error(`Learner state has no entry for concept: ${conceptId}`);
  return conceptState;
}

/** Returns the new state after one observation. Does not mutate the input. */
export function applyObservation(
  state: LearnerState,
  graph: ConceptGraph,
  observation: Observation
): LearnerState {
  if (!graph.has(observation.conceptId)) {
    throw new Error(`Observation references unknown concept: ${observation.conceptId}`);
  }

  const next: LearnerState = structuredClone(state);
  const turn = next.turn;
  const kappa = clamp01(observation.confidence);
  const conceptState = getConceptState(next, observation.conceptId);
  conceptState.lastSeenTurn = turn;

  if (observation.correct !== null) {
    conceptState.mastery = bktUpdate(
      conceptState.mastery,
      observation.correct,
      kappa,
      graph.bktFor(observation.conceptId)
    );
    conceptState.observations += 1;
  }

  // Evidence for a misconception: μ ← 1 - (1-μ)(1-κ). A failed discriminating probe counts too.
  const exhibited =
    observation.misconceptionId ??
    (observation.probeOfMisconceptionId && observation.correct === false
      ? observation.probeOfMisconceptionId
      : null);
  if (exhibited) {
    const misconception = graph.getMisconception(exhibited);
    if (misconception) {
      const owner = getConceptState(next, misconception.conceptId);
      const previous = owner.misconceptions[exhibited] ?? { confidence: 0, evidenceTurns: [] };
      owner.misconceptions[exhibited] = {
        confidence: 1 - (1 - previous.confidence) * (1 - kappa),
        evidenceTurns: [...previous.evidenceTurns, turn],
      };
      owner.lastSeenTurn = turn;
    }
  }

  // Only a correct answer to the discriminating probe weakens a misconception: μ ← μ(1-κ).
  if (observation.probeOfMisconceptionId && observation.correct === true) {
    const misconception = graph.getMisconception(observation.probeOfMisconceptionId);
    if (misconception) {
      const owner = getConceptState(next, misconception.conceptId);
      const previous = owner.misconceptions[observation.probeOfMisconceptionId];
      if (previous) {
        owner.misconceptions[observation.probeOfMisconceptionId] = {
          ...previous,
          confidence: previous.confidence * (1 - kappa),
        };
      }
    }
  }

  return next;
}

/** Applies all observations of one student turn, then advances the turn counter. */
export function applyTurn(
  state: LearnerState,
  graph: ConceptGraph,
  observations: Observation[]
): LearnerState {
  let next = state;
  for (const observation of observations) {
    next = applyObservation(next, graph, observation);
  }
  return { ...next, turn: next.turn + 1 };
}
