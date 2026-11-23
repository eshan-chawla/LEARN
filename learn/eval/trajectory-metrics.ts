import type { TutorAction } from '@/lib/tutor/policy';
import type { Trajectory, TrajectoryTurnLog } from '@/eval/trajectory-types';

/**
 * Multi-turn metrics (J3). Pure functions over logged turns; every metric works for all memory
 * modes because TutorTurnResult.action uses the same TutorAction vocabulary whether the policy
 * (structured) or the LLM (none/raw/summary) chose it.
 */

/** The id an action is "about", used in `type:id` match keys. */
export function actionTargetId(action: TutorAction): string {
  switch (action.type) {
    case 'probe_prerequisite':
    case 'remediate_prerequisite':
      return action.prerequisiteId;
    case 'remediate_misconception':
      return action.misconceptionId;
    case 'advance':
      return action.nextConceptId;
    case 'answer':
      return action.conceptId ?? '';
    case 'hint':
    case 'formative_question':
      return action.conceptId;
  }
}

/** `type:id`, e.g. `probe_prerequisite:chain_rule`, `remediate_misconception:backprop.M1`. */
export function actionKey(action: TutorAction): string {
  return `${action.type}:${actionTargetId(action)}`;
}

/** Gold keys are `type:id`, or a bare `type` that accepts any id. A null action never matches. */
export function matchesAcceptable(action: TutorAction | null, acceptable: string[]): boolean {
  if (!action) return false;
  const key = actionKey(action);
  return acceptable.some((gold) => (gold.includes(':') ? gold === key : gold === action.type));
}

/** Turns that count for scoring: retrieval-infrastructure failures are excluded. */
export function scoredTurns(trajectory: Trajectory): TrajectoryTurnLog[] {
  return trajectory.turns.filter((turn) => !turn.retrievalFailed);
}

/** Groups JSONL rows into trajectories by (condition, persona, seed), turns sorted by index. */
export function groupTrajectories(rows: TrajectoryTurnLog[]): Trajectory[] {
  const groups = new Map<string, Trajectory>();
  for (const row of rows) {
    const key = JSON.stringify([row.condition, row.personaId, row.seed]);
    let trajectory = groups.get(key);
    if (!trajectory) {
      trajectory = { personaId: row.personaId, condition: row.condition, seed: row.seed, hidden: row.hidden, turns: [] };
      groups.set(key, trajectory);
    }
    trajectory.turns.push(row);
  }
  for (const trajectory of groups.values()) trajectory.turns.sort((a, b) => a.turn - b.turn);
  return [...groups.values()];
}

/** Ratio helper: null when there is nothing to divide by (never 0/0 → 0). */
export function safeRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

// --- Next-action accuracy -------------------------------------------------------------------

export interface CountMetric {
  hits: number;
  total: number;
  /** hits / total, or null when total is 0. */
  value: number | null;
}

function countMetric(hits: number, total: number): CountMetric {
  return { hits, total, value: safeRatio(hits, total) };
}

/**
 * Fraction of scored turns whose action is in the turn's acceptable_actions.
 * A null action (unknown id / broken JSON from the LLM) counts as wrong, never skipped.
 * Turns with no acceptable_actions in gold are not scored.
 */
export function nextActionAccuracy(trajectory: Trajectory): CountMetric {
  let hits = 0;
  let total = 0;
  for (const turn of scoredTurns(trajectory)) {
    if (!turn.gold.acceptable_actions?.length) continue;
    total += 1;
    if (matchesAcceptable(turn.action, turn.gold.acceptable_actions)) hits += 1;
  }
  return countMetric(hits, total);
}

// --- Gap identification -----------------------------------------------------------------------

export interface GapIdentification {
  predicted: string[];
  gold: string[];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** 1-based number of turns until the first remediation of a gold gap; null if never. */
  turnsToDetection: number | null;
}

/**
 * Predicted gap = the prerequisite the tutor commits to remediating. A probe alone is a
 * hypothesis, not an identification, so only remediate_prerequisite counts (probed-then-
 * remediated and directly remediated are both covered). `predict: 'first'` (default, as in the
 * paper) keeps only the first such prerequisite; `'all'` keeps every distinct one, for personas
 * with several gaps.
 */
export function gapIdentification(trajectory: Trajectory, predict: 'first' | 'all' = 'first'): GapIdentification {
  const gold = [...new Set(trajectory.hidden.gaps)];
  const goldSet = new Set(gold);
  const predicted: string[] = [];
  let turnsToDetection: number | null = null;

  scoredTurns(trajectory).forEach((turn) => {
    if (turn.action?.type !== 'remediate_prerequisite') return;
    const prerequisite = turn.action.prerequisiteId;
    if (turnsToDetection === null && goldSet.has(prerequisite)) turnsToDetection = turn.turn + 1;
    if (!predicted.includes(prerequisite)) predicted.push(prerequisite);
  });

  const kept = predict === 'first' ? predicted.slice(0, 1) : predicted;
  const truePositives = kept.filter((id) => goldSet.has(id)).length;
  // In 'first' mode a detection after a wrong first guess does not count as the identification.
  const detectedTurn = predict === 'first' && truePositives === 0 ? null : turnsToDetection;

  return {
    predicted: kept,
    gold,
    truePositives,
    falsePositives: kept.length - truePositives,
    falseNegatives: gold.length - truePositives,
    turnsToDetection: detectedTurn,
  };
}

export interface PrecisionRecallF1 {
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export function precisionRecallF1(tp: number, fp: number, fn: number): PrecisionRecallF1 {
  const precision = safeRatio(tp, tp + fp);
  const recall = safeRatio(tp, tp + fn);
  const f1 =
    precision === null || recall === null ? null : precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

/** Micro-averaged P/R/F1 over trajectories (pooled TP/FP/FN). */
export function aggregateGapIdentification(results: GapIdentification[]): PrecisionRecallF1 {
  const sum = (key: 'truePositives' | 'falsePositives' | 'falseNegatives') => results.reduce((acc, r) => acc + r[key], 0);
  return precisionRecallF1(sum('truePositives'), sum('falsePositives'), sum('falseNegatives'));
}

// --- Misconception detection and persistence -------------------------------------------------

/** τ_μ, same default as DEFAULT_THRESHOLDS.misconceptionActive. */
export const MISCONCEPTION_ACTIVE_THRESHOLD = 0.6;
/** Distractor turns that must pass after detection before persistence is checked. */
export const PERSISTENCE_DISTRACTORS = 2;

export interface MisconceptionResult {
  misconceptionId: string;
  detected: boolean;
  /** 0-based turn of the first remediate_misconception for this id. */
  detectedAtTurn: number | null;
  /**
   * After ≥ 2 distractor turns following detection, is it still tracked? true/false, or null when
   * not measurable (not detected, or fewer than 2 distractor turns afterwards).
   */
  persistent: boolean | null;
}

export interface MisconceptionDetection {
  results: MisconceptionResult[];
  /** remediate_misconception actions for ids the student does not hold. */
  falseAlarms: number;
}

function misconceptionConfidence(turn: TrajectoryTurnLog, misconceptionId: string): number | null {
  if (!turn.state) return null;
  const conceptId = misconceptionId.split('.')[0];
  const confidence = turn.state.concepts[conceptId]?.misconceptions?.[misconceptionId]?.confidence;
  return typeof confidence === 'number' ? confidence : 0;
}

/** Still tracked at this turn: the logged state keeps it active, or the tutor addresses it again. */
function stillTracked(turn: TrajectoryTurnLog, misconceptionId: string, threshold: number): boolean {
  if (turn.action?.type === 'remediate_misconception' && turn.action.misconceptionId === misconceptionId) return true;
  const confidence = misconceptionConfidence(turn, misconceptionId);
  return confidence !== null && confidence >= threshold;
}

export function misconceptionDetection(
  trajectory: Trajectory,
  threshold: number = MISCONCEPTION_ACTIVE_THRESHOLD
): MisconceptionDetection {
  const turns = scoredTurns(trajectory);
  const goldIds = [...new Set(trajectory.hidden.misconceptions)];
  const goldSet = new Set(goldIds);

  const falseAlarms = turns.filter(
    (turn) => turn.action?.type === 'remediate_misconception' && !goldSet.has(turn.action.misconceptionId)
  ).length;

  const results = goldIds.map((misconceptionId): MisconceptionResult => {
    const detectionIndex = turns.findIndex(
      (turn) => turn.action?.type === 'remediate_misconception' && turn.action.misconceptionId === misconceptionId
    );
    if (detectionIndex === -1) return { misconceptionId, detected: false, detectedAtTurn: null, persistent: null };

    // Find the first turn after PERSISTENCE_DISTRACTORS distractors have passed since detection.
    let distractors = 0;
    let checkIndex = -1;
    for (let i = detectionIndex + 1; i < turns.length; i += 1) {
      if (distractors >= PERSISTENCE_DISTRACTORS) {
        checkIndex = i;
        break;
      }
      if (turns[i].kind === 'distractor') distractors += 1;
    }
    // If the last distractor is the final turn, check that turn itself.
    if (checkIndex === -1 && distractors >= PERSISTENCE_DISTRACTORS) checkIndex = turns.length - 1;

    const persistent =
      checkIndex === -1 ? null : turns.slice(checkIndex).some((turn) => stillTracked(turn, misconceptionId, threshold));

    return { misconceptionId, detected: true, detectedAtTurn: turns[detectionIndex].turn, persistent };
  });

  return { results, falseAlarms };
}
