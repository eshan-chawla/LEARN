/**
 * Core types for LEARN's structured learner model.
 *
 * Notation follows the paper: concept c ∈ C, mastery p_c, status σ_c,
 * active misconceptions A_c with confidence μ_m, observation count n_c,
 * last-seen turn ℓ_c.
 */

/** Bayesian Knowledge Tracing parameters for one concept. */
export interface BktParams {
  /** P(L0): prior probability the concept is already mastered. */
  pInit: number;
  /** T: probability of transitioning to mastered after a practice opportunity. */
  pTransit: number;
  /** s: probability a student who has mastered the concept answers incorrectly. */
  pSlip: number;
  /** g: probability a student who has not mastered the concept answers correctly. */
  pGuess: number;
}

export interface MisconceptionSpec {
  /** Globally unique id, conventionally `<conceptId>.M<n>`. */
  id: string;
  description: string;
  /** A discriminating question that a student holding this misconception answers incorrectly. */
  probe: string;
}

export interface ConceptSpec {
  id: string;
  name: string;
  description?: string;
  /** Terms used for retrieval query expansion and offline chunk tagging. */
  keywords?: string[];
  bkt?: Partial<BktParams>;
  misconceptions?: MisconceptionSpec[];
}

/** On-disk JSON format of a course prerequisite graph (data/concept_graph/*.json). */
export interface ConceptGraphSpec {
  version: number;
  course: string;
  defaults: { bkt: BktParams };
  concepts: ConceptSpec[];
  /** Directed edges [prerequisite, dependent]: `from` must be learned before `to`. */
  edges: Array<{ from: string; to: string }>;
}

export type ConceptStatus = 'unknown' | 'learning' | 'mastered' | 'misconception';

export interface MisconceptionEvidence {
  /** μ_m ∈ [0,1]. Active when ≥ thresholds.misconceptionActive. */
  confidence: number;
  evidenceTurns: number[];
}

export interface ConceptState {
  conceptId: string;
  /** p_c ∈ [0,1]. */
  mastery: number;
  /** n_c: number of graded observations (correct/incorrect evidence). */
  observations: number;
  /** ℓ_c: last turn at which the concept was observed (graded or mentioned). */
  lastSeenTurn: number | null;
  misconceptions: Record<string, MisconceptionEvidence>;
}

/** S_t: the full learner state. Stored as JSON (Supabase jsonb) and passed to the policy. */
export interface LearnerState {
  schemaVersion: 1;
  turn: number;
  concepts: Record<string, ConceptState>;
}

/**
 * o = (c, y, m, κ): one diagnosed piece of evidence from a student turn.
 * `correct: null` means the concept was discussed but there is no correctness evidence.
 */
export interface Observation {
  conceptId: string;
  correct: boolean | null;
  /** Misconception exhibited in this turn, if any. */
  misconceptionId?: string | null;
  /** Set when the student answered the discriminating probe of this misconception. */
  probeOfMisconceptionId?: string | null;
  /** κ ∈ [0,1]: diagnoser confidence. Scales how far the state moves. */
  confidence: number;
}

export interface TutorThresholds {
  /** τ_m: mastery at or above which a concept is `mastered`. */
  mastered: number;
  /** τ_gap: prerequisites below this mastery are gap candidates. */
  gap: number;
  /** τ_μ: misconception confidence at or above which it is active. */
  misconceptionActive: number;
  /** Graded observations needed before a weak prerequisite is remediated instead of probed. */
  minEvidence: number;
  /** Minimum expected information gain (bits) to justify a probe. */
  minInfoGain: number;
  /** Ancestor depth searched for prerequisite gaps. */
  gapSearchDepth: number;
  /** H_max: highest Socratic hint level. */
  maxHintLevel: number;
}

export const DEFAULT_THRESHOLDS: TutorThresholds = {
  mastered: 0.85,
  gap: 0.6,
  misconceptionActive: 0.6,
  minEvidence: 1,
  minInfoGain: 0.02,
  gapSearchDepth: 2,
  maxHintLevel: 3,
};
