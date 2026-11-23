import type { TutorAction } from '@/lib/tutor/policy';
import type { HiddenState, TrajectoryTurnLog, TurnGold } from '@/eval/trajectory-types';

/** Shared hidden state for hand-made trajectory logs: one gap (chain_rule), one misconception. */
export const HIDDEN: HiddenState = {
  known: ['derivatives', 'matrix_multiplication', 'gradient_descent'],
  gaps: ['chain_rule'],
  misconceptions: ['backprop.M1'],
};

export const GOLD: TurnGold = {
  gap: 'chain_rule',
  active_misconceptions: ['backprop.M1'],
  acceptable_actions: ['probe_prerequisite:chain_rule', 'remediate_misconception:backprop.M1'],
  do_not_remediate: ['derivatives', 'matrix_multiplication', 'gradient_descent'],
};

export function turnLog(patch: Partial<TrajectoryTurnLog> = {}): TrajectoryTurnLog {
  return {
    runId: 'test',
    personaId: 'p01-chain-rule-gap',
    condition: 'M2',
    memory: 'structured',
    sim: 'scripted',
    seed: 1,
    model: 'fake',
    turn: 0,
    kind: 'respond',
    studentMessage: 'student',
    reply: 'tutor',
    action: null,
    actionSource: 'policy',
    gold: GOLD,
    hidden: HIDDEN,
    state: null,
    retrievalFailed: false,
    memoryChars: 0,
    latencyMs: {},
    ...patch,
  };
}

export const ACT = {
  probe: (prerequisiteId: string): TutorAction => ({ type: 'probe_prerequisite', conceptId: 'backprop', prerequisiteId, infoGain: 0.2 }),
  remediate: (prerequisiteId: string): TutorAction => ({ type: 'remediate_prerequisite', conceptId: 'backprop', prerequisiteId }),
  misconception: (misconceptionId: string, conceptId = 'backprop'): TutorAction => ({
    type: 'remediate_misconception',
    conceptId,
    misconceptionId,
  }),
  answer: (conceptId: string | null = 'backprop'): TutorAction => ({ type: 'answer', conceptId, concise: false }),
};
