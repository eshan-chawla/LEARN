import type { ConceptGraph } from '@/lib/tutor/concept-graph';
import {
  activeMisconceptionIds,
  deriveStatus,
  expectedInformationGain,
  getConceptState,
} from '@/lib/tutor/learner-state';
import { DEFAULT_THRESHOLDS, type LearnerState, type TutorThresholds } from '@/lib/tutor/types';

/** How the diagnoser classified the student's latest turn. */
export type TurnKind = 'question' | 'attempt' | 'other';

export type TutorAction =
  | { type: 'answer'; conceptId: string | null; concise: boolean }
  | { type: 'hint'; conceptId: string; level: number }
  | { type: 'probe_prerequisite'; conceptId: string; prerequisiteId: string; infoGain: number }
  | { type: 'remediate_prerequisite'; conceptId: string; prerequisiteId: string }
  | { type: 'remediate_misconception'; conceptId: string; misconceptionId: string }
  | { type: 'formative_question'; conceptId: string }
  | { type: 'advance'; fromConceptId: string | null; nextConceptId: string };

export interface PolicyInput {
  state: LearnerState;
  graph: ConceptGraph;
  /** Concept the turn is about, from the diagnoser. Null if off-graph or unclear. */
  targetConceptId: string | null;
  turnKind: TurnKind;
  /** True if the latest attempt on the target was wrong or the student expressed confusion. */
  struggling: boolean;
  thresholds?: TutorThresholds;
}

export interface PolicyDecision {
  primary: TutorAction;
  followUp: TutorAction | null;
  /** Human-readable trace, surfaced in the UI "steps" panel and logged for evaluation. */
  rationale: string[];
}

export interface GapCandidate {
  conceptId: string;
  depth: number;
  mastery: number;
  observations: number;
  infoGain: number;
}

/** Socratic hint level h = ⌈H_max·(1 - p_c)⌉, clamped to [1, H_max]. Higher = more explicit help. */
export function hintLevel(mastery: number, maxLevel: number): number {
  return Math.min(maxLevel, Math.max(1, Math.ceil(maxLevel * (1 - mastery))));
}

/**
 * Prerequisites of `conceptId` (within gapSearchDepth) whose mastery is below τ_gap.
 * Mastered/strong prerequisites are excluded, which is what prevents unnecessary remediation.
 */
export function findGapCandidates(
  state: LearnerState,
  graph: ConceptGraph,
  conceptId: string,
  thresholds: TutorThresholds = DEFAULT_THRESHOLDS
): GapCandidate[] {
  return graph
    .ancestorsWithin(conceptId, thresholds.gapSearchDepth)
    .map(({ conceptId: id, depth }) => {
      const conceptState = getConceptState(state, id);
      return {
        conceptId: id,
        depth,
        mastery: conceptState.mastery,
        observations: conceptState.observations,
        infoGain: expectedInformationGain(conceptState.mastery, graph.bktFor(id)),
      };
    })
    .filter((candidate) => candidate.mastery < thresholds.gap);
}

/** Max information gain first; ties → shallower, then more foundational (topological order). */
function sortProbeCandidates(graph: ConceptGraph, candidates: GapCandidate[]): GapCandidate[] {
  return [...candidates].sort(
    (a, b) => b.infoGain - a.infoGain || a.depth - b.depth || graph.topoIndex(a.conceptId) - graph.topoIndex(b.conceptId)
  );
}

type RootCause = { type: 'probe'; candidate: GapCandidate } | { type: 'remediate'; conceptId: string };

/**
 * Given a confirmed weak concept k, descend its prerequisites until the root cause is found:
 * probe an unobserved weak direct prerequisite of k if one is informative, follow a confirmed
 * weak one recursively, otherwise k itself is the root cause. Terminates because G is a DAG.
 */
export function localizeRootCause(
  state: LearnerState,
  graph: ConceptGraph,
  conceptId: string,
  thresholds: TutorThresholds = DEFAULT_THRESHOLDS
): RootCause {
  const below = findGapCandidates(state, graph, conceptId, { ...thresholds, gapSearchDepth: 1 });

  const [probe] = sortProbeCandidates(
    graph,
    below.filter((c) => c.observations < thresholds.minEvidence && c.infoGain >= thresholds.minInfoGain)
  );
  if (probe) return { type: 'probe', candidate: probe };

  const [deeper] = below
    .filter((c) => c.observations >= thresholds.minEvidence)
    .sort((a, b) => a.mastery - b.mastery || graph.topoIndex(a.conceptId) - graph.topoIndex(b.conceptId));
  if (deeper) return localizeRootCause(state, graph, deeper.conceptId, thresholds);

  return { type: 'remediate', conceptId };
}

/**
 * Next concept in the zone of proximal development: not mastered, all prerequisites mastered.
 * Prefers direct dependents of `fromConceptId`, then graph (topological) order.
 */
export function nextZpdConcept(
  state: LearnerState,
  graph: ConceptGraph,
  fromConceptId: string | null,
  thresholds: TutorThresholds = DEFAULT_THRESHOLDS
): string | null {
  const isMastered = (id: string) => deriveStatus(getConceptState(state, id), thresholds) === 'mastered';
  const inZpd = (id: string) =>
    id !== fromConceptId && !isMastered(id) && graph.prerequisitesOf(id).every(isMastered);

  const preferred = fromConceptId ? graph.dependentsOf(fromConceptId).filter(inZpd) : [];
  if (preferred.length > 0) return preferred[0];

  return graph.conceptIds.find(inZpd) ?? null;
}

/**
 * π(S_t, u_t): ordered, inspectable decision rules.
 *  1. Active misconception on the target → targeted refutation + its probe.
 *  2. Struggling → look for prerequisite gaps:
 *     a. a weak prerequisite with enough evidence → descend to its root cause (probing its own
 *        unobserved prerequisites first), then remediate the root cause;
 *     b. otherwise probe the uncertain prerequisite with maximum expected information gain;
 *     c. no gap → Socratic hint scaled by mastery.
 *  3. Correct attempt → advance if now mastered, else another formative question.
 *  4. Question → answer (concise if mastered) and check understanding if evidence is thin.
 */
export function selectNextAction(input: PolicyInput): PolicyDecision {
  const { state, graph, targetConceptId, turnKind, struggling } = input;
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const rationale: string[] = [];

  if (!targetConceptId || !graph.has(targetConceptId)) {
    rationale.push('No target concept in the course graph; answering from retrieved material only.');
    return { primary: { type: 'answer', conceptId: null, concise: false }, followUp: null, rationale };
  }

  const target = getConceptState(state, targetConceptId);
  const status = deriveStatus(target, thresholds);
  rationale.push(
    `Target ${targetConceptId}: status=${status}, p=${target.mastery.toFixed(2)}, n=${target.observations}.`
  );

  // Rule 1: misconceptions take priority — re-explaining over a misconception rarely fixes it.
  const [misconceptionId] = activeMisconceptionIds(target, thresholds);
  if (misconceptionId) {
    rationale.push(`Active misconception ${misconceptionId}; issuing targeted refutation and discriminating probe.`);
    return {
      primary: { type: 'remediate_misconception', conceptId: targetConceptId, misconceptionId },
      followUp: null,
      rationale,
    };
  }

  // Rule 2: struggling on the target.
  if (struggling) {
    const candidates = findGapCandidates(state, graph, targetConceptId, thresholds);
    rationale.push(
      candidates.length > 0
        ? `Gap candidates (p<${thresholds.gap}): ${candidates
            .map((c) => `${c.conceptId}[p=${c.mastery.toFixed(2)},n=${c.observations},IG=${c.infoGain.toFixed(3)}]`)
            .join(', ')}.`
        : 'No prerequisite below the gap threshold.'
    );

    const confirmed = candidates
      .filter((c) => c.observations >= thresholds.minEvidence)
      .sort((a, b) => b.depth - a.depth || a.mastery - b.mastery || graph.topoIndex(a.conceptId) - graph.topoIndex(b.conceptId));
    if (confirmed.length > 0) {
      const localized = localizeRootCause(state, graph, confirmed[0].conceptId, thresholds);
      if (localized.type === 'probe') {
        rationale.push(
          `Confirmed gap ${confirmed[0].conceptId}; probing its prerequisite ${localized.candidate.conceptId} (IG ${localized.candidate.infoGain.toFixed(3)} bits) to find the root cause.`
        );
        return {
          primary: {
            type: 'probe_prerequisite',
            conceptId: targetConceptId,
            prerequisiteId: localized.candidate.conceptId,
            infoGain: localized.candidate.infoGain,
          },
          followUp: null,
          rationale,
        };
      }
      rationale.push(`Root-cause gap ${localized.conceptId}; remediating it before the target.`);
      return {
        primary: { type: 'remediate_prerequisite', conceptId: targetConceptId, prerequisiteId: localized.conceptId },
        followUp: { type: 'formative_question', conceptId: localized.conceptId },
        rationale,
      };
    }

    const probes = sortProbeCandidates(
      graph,
      candidates.filter((c) => c.observations < thresholds.minEvidence && c.infoGain >= thresholds.minInfoGain)
    );
    if (probes.length > 0) {
      const probe = probes[0];
      rationale.push(`Probing ${probe.conceptId} (max expected information gain ${probe.infoGain.toFixed(3)} bits).`);
      return {
        primary: {
          type: 'probe_prerequisite',
          conceptId: targetConceptId,
          prerequisiteId: probe.conceptId,
          infoGain: probe.infoGain,
        },
        followUp: null,
        rationale,
      };
    }

    const level = hintLevel(target.mastery, thresholds.maxHintLevel);
    rationale.push(`Prerequisites look sound; giving a level-${level} Socratic hint on the target.`);
    return {
      primary: { type: 'hint', conceptId: targetConceptId, level },
      followUp: null,
      rationale,
    };
  }

  // Rule 3: successful attempt.
  if (turnKind === 'attempt') {
    if (status === 'mastered') {
      const nextConceptId = nextZpdConcept(state, graph, targetConceptId, thresholds);
      if (nextConceptId) {
        rationale.push(`Target mastered; advancing to ZPD concept ${nextConceptId}.`);
        return {
          primary: { type: 'advance', fromConceptId: targetConceptId, nextConceptId },
          followUp: { type: 'formative_question', conceptId: nextConceptId },
          rationale,
        };
      }
      rationale.push('Target mastered and no unmastered concept is ready; confirming completion.');
      return { primary: { type: 'answer', conceptId: targetConceptId, concise: true }, followUp: null, rationale };
    }
    rationale.push('Correct attempt but not yet mastered; asking another formative question.');
    return { primary: { type: 'formative_question', conceptId: targetConceptId }, followUp: null, rationale };
  }

  // Rule 4: a question (or other turn) about the target.
  const concise = status === 'mastered';
  const needsEvidence = target.observations < thresholds.minEvidence + 1 && !concise;
  rationale.push(
    concise
      ? 'Target mastered; giving a concise answer.'
      : `Answering; ${needsEvidence ? 'little evidence on the target, so following up with a check question.' : 'no follow-up needed.'}`
  );
  return {
    primary: { type: 'answer', conceptId: targetConceptId, concise },
    followUp: needsEvidence ? { type: 'formative_question', conceptId: targetConceptId } : null,
    rationale,
  };
}
