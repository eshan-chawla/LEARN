import { describe, expect, it } from 'vitest';
import type { TutorAction } from '@/lib/tutor/policy';
import { actionKey, groupTrajectories, matchesAcceptable, safeRatio } from '@/eval/trajectory-metrics';
import { HIDDEN, turnLog } from '@/eval/__tests__/trajectory-fixtures';

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
