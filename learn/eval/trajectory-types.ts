import type { TutorAction } from '@/lib/tutor/policy';
import type { LearnerState } from '@/lib/tutor/types';

/**
 * Multi-turn evaluation (J3) data shapes: persona cards in data/benchmark/trajectories/*.json
 * and the JSONL rows that eval/run-trajectories.ts writes to results/trajectories/<run-id>.jsonl.
 * Every log row repeats the persona's hidden state and the turn's gold, so a results file can be
 * scored on its own without the persona files.
 */

/** What the simulated student really knows. Ids must exist in data/concept_graph/dl_course.json. */
export interface HiddenState {
  known: string[];
  gaps: string[];
  /** Misconception ids, `<concept>.M<n>`. */
  misconceptions: string[];
}

export type PersonaTurnKind = 'opening' | 'respond' | 'distractor';

export interface TurnGold {
  /** The gap the tutor should be homing in on at this turn, if any. */
  gap?: string | null;
  active_misconceptions?: string[];
  /** Acceptable next actions as `type:id` keys (see actionKey). A bare `type` accepts any id. */
  acceptable_actions: string[];
  /** Concepts the student already knows; remediating them is unnecessary. Defaults to hidden.known. */
  do_not_remediate?: string[];
}

export interface PersonaTurn {
  kind: PersonaTurnKind;
  /** Fixed student text (opening and distractor turns). `respond` turns are produced by the simulator. */
  script?: string;
  gold: TurnGold;
}

export interface Persona {
  id: string;
  author: string;
  target_concept: string;
  description?: string;
  hidden_state: HiddenState;
  turns: PersonaTurn[];
}

export type SimMode = 'scripted' | 'llm';

/** One JSONL row: one tutor turn of one persona under one condition. */
export interface TrajectoryTurnLog {
  runId: string;
  personaId: string;
  /** Condition label, e.g. "M2" or "memory=structured,rag=hybrid,critic=on". */
  condition: string;
  memory: string;
  sim: SimMode;
  seed: number;
  model: string;
  /** 0-based index into the persona's turns. */
  turn: number;
  kind: PersonaTurnKind;
  studentMessage: string;
  reply: string;
  /** Null when the LLM named an unknown action or returned broken JSON. Counts as wrong. */
  action: TutorAction | null;
  actionSource: 'policy' | 'llm';
  gold: TurnGold;
  hidden: HiddenState;
  /** Learner state after the turn (meaningful for memory=structured). */
  state: LearnerState | null;
  /** Retrieval infrastructure failed this turn; excluded from scoring like the single-turn runner. */
  retrievalFailed: boolean;
  /** The tutor turn threw (model/API outage). The turn is logged and excluded from scoring. */
  error?: string | null;
  memoryChars: number;
  latencyMs: Record<string, number>;
}

/** All turns of one persona under one condition and seed, in turn order. */
export interface Trajectory {
  personaId: string;
  condition: string;
  seed: number;
  hidden: HiddenState;
  turns: TrajectoryTurnLog[];
}
