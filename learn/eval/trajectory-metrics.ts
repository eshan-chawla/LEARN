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
