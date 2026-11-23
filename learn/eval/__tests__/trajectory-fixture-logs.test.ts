import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupTrajectories, scoreTrajectory, type TrajectoryScore } from '@/eval/trajectory-metrics';
import type { TrajectoryTurnLog } from '@/eval/trajectory-types';

/**
 * Three hand-made 6-turn logs of the same persona (gap: chain_rule, misconception: backprop.M1,
 * two distractor turns), shaped exactly like run-trajectories.ts output:
 *   perfect               M2: probe → remediate gap → remediate misconception → 2 distractors → follow-up
 *   remediate-everything  M1: remediates every prerequisite it can think of
 *   never-detects         M1b: only answers; one turn has an unparseable (null) action
 */
const FIXTURE_DIR = join(__dirname, 'fixtures', 'trajectories');

function score(name: string): TrajectoryScore {
  const rows = readFileSync(join(FIXTURE_DIR, `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TrajectoryTurnLog);
  const trajectories = groupTrajectories(rows);
  expect(trajectories).toHaveLength(1);
  return scoreTrajectory(trajectories[0]);
}

describe('hand-made trajectory logs', () => {
  it('perfect: every metric at its best', () => {
    const s = score('perfect');
    expect(s.condition).toBe('M2');
    expect(s.nextActionAccuracy).toEqual({ hits: 6, total: 6, value: 1 });
    expect(s.gap).toEqual({
      predicted: ['chain_rule'],
      gold: ['chain_rule'],
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 0,
      turnsToDetection: 2,
    });
    expect(s.misconceptions).toEqual({
      results: [{ misconceptionId: 'backprop.M1', detected: true, detectedAtTurn: 2, persistent: true }],
      falseAlarms: 0,
    });
    expect(s.unnecessaryRemediation).toEqual({ hits: 0, total: 2, value: 0 });
    expect(s.calibration?.pairs.map((p) => [p.conceptId, p.actual])).toEqual([
      ['derivatives', 1],
      ['gradient_descent', 1],
      ['chain_rule', 0],
    ]);
    expect(s.calibration?.auc).toBe(1);
    expect(s.calibration?.brier).toBeCloseTo((0.12 ** 2 + 0.15 ** 2 + 0.2 ** 2) / 3, 10);
    expect(s.maxMemoryChars).toBe(2480);
  });

  it('remediate-everything: wrong gap first, half of remediations unnecessary', () => {
    const s = score('remediate-everything');
    expect(s.nextActionAccuracy).toEqual({ hits: 1, total: 6, value: 1 / 6 });
    expect(s.gap).toMatchObject({ predicted: ['derivatives'], truePositives: 0, falsePositives: 1, falseNegatives: 1, turnsToDetection: null });
    expect(s.misconceptions.results[0]).toEqual({ misconceptionId: 'backprop.M1', detected: true, detectedAtTurn: 4, persistent: null });
    expect(s.unnecessaryRemediation).toEqual({ hits: 3, total: 6, value: 0.5 });
    expect(s.calibration).toBeNull();
    expect(s.maxMemoryChars).toBeLessThanOrEqual(4000);
  });

  it('never-detects: no gap, no misconception, null action counted wrong', () => {
    const s = score('never-detects');
    expect(s.nextActionAccuracy).toEqual({ hits: 2, total: 6, value: 2 / 6 });
    expect(s.gap).toMatchObject({ predicted: [], truePositives: 0, falsePositives: 0, falseNegatives: 1, turnsToDetection: null });
    expect(s.misconceptions.results[0]).toMatchObject({ detected: false, persistent: null });
    expect(s.misconceptions.falseAlarms).toBe(0);
    expect(s.unnecessaryRemediation.value).toBeNull();
    expect(s.calibration).toBeNull();
  });

  it('the three logs rank in the expected order on every headline metric', () => {
    const [perfect, everything, never] = ['perfect', 'remediate-everything', 'never-detects'].map(score);
    expect(perfect.nextActionAccuracy.value!).toBeGreaterThan(never.nextActionAccuracy.value!);
    expect(never.nextActionAccuracy.value!).toBeGreaterThan(everything.nextActionAccuracy.value!);
    expect(perfect.unnecessaryRemediation.value!).toBeLessThan(everything.unnecessaryRemediation.value!);
    expect(perfect.gap.truePositives).toBeGreaterThan(everything.gap.truePositives + never.gap.truePositives);
  });
});
