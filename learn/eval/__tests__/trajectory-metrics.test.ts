import { describe, expect, it } from 'vitest';
import type { TutorAction } from '@/lib/tutor/policy';
import {
  actionKey,
  aggregateGapIdentification,
  gapIdentification,
  groupTrajectories,
  matchesAcceptable,
  misconceptionDetection,
  nextActionAccuracy,
  precisionRecallF1,
  safeRatio,
} from '@/eval/trajectory-metrics';
import type { Trajectory, TrajectoryTurnLog } from '@/eval/trajectory-types';
import type { LearnerState } from '@/lib/tutor/types';
import { ACT, HIDDEN, turnLog } from '@/eval/__tests__/trajectory-fixtures';

describe('action keys', () => {
  const cases: Array<[TutorAction, string]> = [
    [{ type: 'probe_prerequisite', conceptId: 'backprop', prerequisiteId: 'chain_rule', infoGain: 0.2 }, 'probe_prerequisite:chain_rule'],
    [{ type: 'remediate_prerequisite', conceptId: 'backprop', prerequisiteId: 'chain_rule' }, 'remediate_prerequisite:chain_rule'],
    [{ type: 'remediate_misconception', conceptId: 'backprop', misconceptionId: 'backprop.M1' }, 'remediate_misconception:backprop.M1'],
    [{ type: 'advance', fromConceptId: 'mlp', nextConceptId: 'backprop' }, 'advance:backprop'],
    [{ type: 'answer', conceptId: null, concise: true }, 'answer:'],
    [{ type: 'hint', conceptId: 'backprop', level: 2 }, 'hint:backprop'],
    [{ type: 'formative_question', conceptId: 'backprop' }, 'formative_question:backprop'],
  ];

  it.each(cases)('%j → %s', (action, key) => {
    expect(actionKey(action)).toBe(key);
  });

  it('matches exact keys, bare types as wildcards, and never a null action', () => {
    const probe: TutorAction = { type: 'probe_prerequisite', conceptId: 'backprop', prerequisiteId: 'chain_rule', infoGain: 0.1 };
    expect(matchesAcceptable(probe, ['probe_prerequisite:chain_rule'])).toBe(true);
    expect(matchesAcceptable(probe, ['probe_prerequisite:derivatives'])).toBe(false);
    expect(matchesAcceptable(probe, ['probe_prerequisite'])).toBe(true);
    expect(matchesAcceptable(null, ['probe_prerequisite', 'answer'])).toBe(false);
  });
});

describe('groupTrajectories', () => {
  it('groups by condition, persona and seed and sorts turns', () => {
    const rows = [
      turnLog({ turn: 1, personaId: 'p1', condition: 'M2' }),
      turnLog({ turn: 0, personaId: 'p1', condition: 'M2' }),
      turnLog({ turn: 0, personaId: 'p1', condition: 'M0' }),
      turnLog({ turn: 0, personaId: 'p1', condition: 'M2', seed: 2 }),
    ];
    const trajectories = groupTrajectories(rows);
    expect(trajectories).toHaveLength(3);
    const m2 = trajectories.find((t) => t.condition === 'M2' && t.seed === 1)!;
    expect(m2.turns.map((t) => t.turn)).toEqual([0, 1]);
    expect(m2.hidden).toEqual(HIDDEN);
  });

  it('safeRatio returns null on an empty denominator', () => {
    expect(safeRatio(0, 0)).toBeNull();
    expect(safeRatio(1, 4)).toBe(0.25);
  });
});

function trajectory(turns: Array<Partial<TrajectoryTurnLog>>): Trajectory {
  return { personaId: 'p', condition: 'M2', seed: 1, hidden: HIDDEN, turns: turns.map((t, i) => turnLog({ turn: i, ...t })) };
}

function stateWithMisconception(confidence: number): LearnerState {
  return {
    schemaVersion: 1,
    turn: 0,
    concepts: {
      backprop: { conceptId: 'backprop', mastery: 0.3, observations: 1, lastSeenTurn: 0, misconceptions: { 'backprop.M1': { confidence, evidenceTurns: [0] } } },
    },
  };
}

describe('nextActionAccuracy', () => {
  it('counts null actions as wrong, skips turns without gold and retrieval failures', () => {
    const result = nextActionAccuracy(
      trajectory([
        { action: ACT.probe('chain_rule') },
        { action: null },
        { action: ACT.answer(), gold: { acceptable_actions: [] } },
        { action: null, retrievalFailed: true },
      ])
    );
    expect(result).toEqual({ hits: 1, total: 2, value: 0.5 });
  });
});

describe('gapIdentification', () => {
  it('a probe alone is not an identification; probe then remediate is, with turns-to-detection', () => {
    expect(gapIdentification(trajectory([{ action: ACT.probe('chain_rule') }])).predicted).toEqual([]);
    const result = gapIdentification(
      trajectory([{ action: ACT.answer() }, { action: ACT.probe('chain_rule') }, { action: ACT.remediate('chain_rule') }])
    );
    expect(result).toMatchObject({ predicted: ['chain_rule'], truePositives: 1, falsePositives: 0, falseNegatives: 0, turnsToDetection: 3 });
  });

  it("'first' keeps only the first remediated prerequisite; 'all' keeps every one", () => {
    const t = trajectory([{ action: ACT.remediate('derivatives') }, { action: ACT.remediate('chain_rule') }]);
    expect(gapIdentification(t)).toMatchObject({ predicted: ['derivatives'], truePositives: 0, falsePositives: 1, turnsToDetection: null });
    expect(gapIdentification(t, 'all')).toMatchObject({ predicted: ['derivatives', 'chain_rule'], truePositives: 1, turnsToDetection: 2 });
  });

  it('micro-averages P/R/F1 and returns null on empty denominators', () => {
    const hit = gapIdentification(trajectory([{ action: ACT.remediate('chain_rule') }]));
    const miss = gapIdentification(trajectory([{ action: ACT.answer() }]));
    expect(aggregateGapIdentification([hit, miss])).toEqual({ precision: 1, recall: 0.5, f1: 2 / 3 });
    expect(precisionRecallF1(0, 0, 0)).toEqual({ precision: null, recall: null, f1: null });
    expect(precisionRecallF1(0, 1, 1).f1).toBe(0);
  });
});

describe('misconceptionDetection', () => {
  it('detects via remediate_misconception and counts false alarms', () => {
    const result = misconceptionDetection(
      trajectory([{ action: ACT.misconception('softmax.M1', 'softmax_cross_entropy') }, { action: ACT.misconception('backprop.M1') }])
    );
    expect(result.falseAlarms).toBe(1);
    expect(result.results).toEqual([{ misconceptionId: 'backprop.M1', detected: true, detectedAtTurn: 1, persistent: null }]);
  });

  it('persistent when the state still holds it after two distractors', () => {
    const result = misconceptionDetection(
      trajectory([
        { action: ACT.misconception('backprop.M1'), state: stateWithMisconception(0.8) },
        { kind: 'distractor', action: ACT.answer(null), state: stateWithMisconception(0.8) },
        { kind: 'distractor', action: ACT.answer(null), state: stateWithMisconception(0.8) },
        { action: ACT.answer(), state: stateWithMisconception(0.75) },
      ])
    );
    expect(result.results[0].persistent).toBe(true);
  });

  it('not persistent when the state dropped it and the tutor never returns to it', () => {
    const result = misconceptionDetection(
      trajectory([
        { action: ACT.misconception('backprop.M1'), state: stateWithMisconception(0.8) },
        { kind: 'distractor', action: ACT.answer(null) },
        { kind: 'distractor', action: ACT.answer(null) },
        { action: ACT.answer(), state: stateWithMisconception(0.2) },
      ])
    );
    expect(result.results[0].persistent).toBe(false);
  });

  it('without state (LLM memory modes) persistence means the tutor addresses it again', () => {
    const result = misconceptionDetection(
      trajectory([
        { action: ACT.misconception('backprop.M1') },
        { kind: 'distractor', action: ACT.answer(null) },
        { kind: 'distractor', action: ACT.answer(null) },
        { action: ACT.misconception('backprop.M1') },
      ])
    );
    expect(result.results[0].persistent).toBe(true);
  });

  it('persistence is null with fewer than two distractors after detection', () => {
    const result = misconceptionDetection(
      trajectory([{ action: ACT.misconception('backprop.M1') }, { kind: 'distractor', action: ACT.answer(null) }, { action: ACT.answer() }])
    );
    expect(result.results[0].persistent).toBeNull();
  });
});
