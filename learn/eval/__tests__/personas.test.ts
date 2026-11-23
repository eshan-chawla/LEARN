import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConceptGraph } from '@/lib/tutor/graph-io';
import { assertValidPersonas, loadPersonas, validatePersona } from '@/eval/personas';
import type { Persona } from '@/eval/trajectory-types';

const REPO = join(__dirname, '..', '..', '..');
const graph = loadConceptGraph(join(REPO, 'data', 'concept_graph', 'dl_course.json'));
const personas = loadPersonas(join(REPO, 'data', 'benchmark', 'trajectories'));

describe('committed personas', () => {
  it('there is at least one persona', () => {
    expect(personas.length).toBeGreaterThan(0);
  });

  it.each(personas.map((p) => [p.id, p] as const))('%s only uses concept and misconception ids from dl_course.json', (_id, persona) => {
    expect(validatePersona(persona, graph)).toEqual([]);
  });

  it('ids are unique', () => {
    expect(() => assertValidPersonas(personas, graph)).not.toThrow();
  });
});

describe('validatePersona', () => {
  const valid = personas.find((p) => p.id === 'p01-chain-rule-gap')!;
  const clone = (): Persona => JSON.parse(JSON.stringify(valid));

  it('flags unknown concept and misconception ids everywhere they appear', () => {
    const p = clone();
    p.target_concept = 'not_a_concept';
    p.hidden_state.known.push('also_fake');
    p.hidden_state.misconceptions.push('backprop.M99');
    p.turns[1].gold.acceptable_actions.push('remediate_misconception:fake.M1', 'probe_prerequisite:ghost');
    p.turns[1].gold.do_not_remediate = ['nope'];
    const errors = validatePersona(p, graph).join('\n');
    for (const bad of ['not_a_concept', 'also_fake', 'backprop.M99', 'fake.M1', 'ghost', 'nope']) {
      expect(errors).toContain(`"${bad}"`);
    }
  });

  it('enforces structure: turn count, distractors, opening, scripts, action types, hidden-state sanity', () => {
    const p = clone();
    p.turns = p.turns.slice(0, 3).map((t) => ({ ...t }));
    p.turns[0] = { ...p.turns[0], kind: 'respond' };
    p.turns[2] = { ...p.turns[2], kind: 'distractor', script: undefined };
    p.turns[1].gold = { acceptable_actions: ['teleport:backprop'] };
    p.hidden_state.gaps = ['derivatives'];
    p.hidden_state.misconceptions = [];
    const errors = validatePersona(p, graph).join('\n');
    expect(errors).toMatch(/3 turns; expected 8-12/);
    expect(errors).toMatch(/0 distractor turns|1 distractor turns/);
    expect(errors).toMatch(/first turn must be the opening/);
    expect(errors).toMatch(/turns\[2\] \(distractor\) needs a script/);
    expect(errors).toMatch(/"teleport:backprop" has unknown type/);
    expect(errors).toMatch(/both known and gaps: derivatives/);
  });

  it('assertValidPersonas reports duplicates', () => {
    expect(() => assertValidPersonas([valid, valid], graph)).toThrow(/duplicate persona id p01-chain-rule-gap/);
  });
});
