import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ConceptGraph } from '@/lib/tutor/concept-graph';
import type { TutorAction } from '@/lib/tutor/policy';
import { DEFAULT_THRESHOLDS } from '@/lib/tutor/types';
import type { Persona } from '@/eval/trajectory-types';

/** Persona cards live in data/benchmark/trajectories/<id>.json, one persona per file. */
export const PERSONA_LIMITS = { minTurns: 8, maxTurns: 12, minDistractors: 2 } as const;

const ACTION_TYPES: ReadonlySet<TutorAction['type']> = new Set([
  'answer',
  'hint',
  'probe_prerequisite',
  'remediate_prerequisite',
  'remediate_misconception',
  'formative_question',
  'advance',
]);

export function loadPersonas(dir: string): Persona[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const persona = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Persona;
      if (persona.id !== basename(file, '.json')) {
        throw new Error(`${file}: persona id "${persona.id}" must match the file name`);
      }
      return persona;
    });
}

/** Problems with one persona card; an empty list means it is valid. */
export function validatePersona(persona: Persona, graph: ConceptGraph): string[] {
  const errors: string[] = [];
  const where = (detail: string) => errors.push(`${persona.id ?? '(no id)'}: ${detail}`);
  const checkConcept = (id: unknown, field: string) => {
    if (typeof id !== 'string' || !graph.has(id)) where(`${field} "${String(id)}" is not a concept in the graph`);
  };
  const checkMisconception = (id: unknown, field: string) => {
    if (typeof id !== 'string' || !graph.getMisconception(id)) where(`${field} "${String(id)}" is not a misconception in the graph`);
  };

  if (!persona.id || !/^p\d{2}-[a-z0-9-]+$/.test(persona.id)) where('id must look like p01-short-name');
  if (!persona.author) where('author is required');
  checkConcept(persona.target_concept, 'target_concept');

  const hidden = persona.hidden_state ?? { known: [], gaps: [], misconceptions: [] };
  hidden.known.forEach((id) => checkConcept(id, 'hidden_state.known'));
  hidden.gaps.forEach((id) => checkConcept(id, 'hidden_state.gaps'));
  hidden.misconceptions.forEach((id) => checkMisconception(id, 'hidden_state.misconceptions'));
  const overlap = hidden.known.filter((id) => hidden.gaps.includes(id));
  if (overlap.length) where(`concepts both known and gaps: ${overlap.join(', ')}`);
  if (hidden.gaps.length + hidden.misconceptions.length === 0) where('needs at least one gap or misconception');

  // Every prerequisite the tutor may probe (ancestors of the target within the gap-search depth)
  // must be classified. Otherwise the scripted student answers "don't know" for it and the tutor
  // correctly chases a gap the persona author never intended.
  if (typeof persona.target_concept === 'string' && graph.has(persona.target_concept)) {
    const classified = new Set([...hidden.known, ...hidden.gaps]);
    const missing = graph
      .ancestorsWithin(persona.target_concept, DEFAULT_THRESHOLDS.gapSearchDepth)
      .filter((ancestor) => !classified.has(ancestor.conceptId))
      .map((ancestor) => ancestor.conceptId);
    if (missing.length) where(`prerequisites of ${persona.target_concept} not listed in known or gaps: ${missing.join(', ')}`);
  }

  const turns = persona.turns ?? [];
  if (turns.length < PERSONA_LIMITS.minTurns || turns.length > PERSONA_LIMITS.maxTurns) {
    where(`has ${turns.length} turns; expected ${PERSONA_LIMITS.minTurns}-${PERSONA_LIMITS.maxTurns}`);
  }
  if (turns[0]?.kind !== 'opening') where('first turn must be the opening');
  const distractors = turns.filter((turn) => turn.kind === 'distractor').length;
  if (distractors < PERSONA_LIMITS.minDistractors) where(`has ${distractors} distractor turns; expected at least ${PERSONA_LIMITS.minDistractors}`);

  turns.forEach((turn, index) => {
    const at = `turns[${index}]`;
    if (!['opening', 'respond', 'distractor'].includes(turn.kind)) where(`${at}.kind "${turn.kind}" is invalid`);
    if (index > 0 && turn.kind === 'opening') where(`${at} is a second opening`);
    if ((turn.kind === 'opening' || turn.kind === 'distractor') && !turn.script?.trim()) where(`${at} (${turn.kind}) needs a script`);
    if (!turn.gold || !Array.isArray(turn.gold.acceptable_actions) || turn.gold.acceptable_actions.length === 0) {
      where(`${at}.gold.acceptable_actions must be a non-empty list`);
      return;
    }
    if (turn.gold.gap) checkConcept(turn.gold.gap, `${at}.gold.gap`);
    turn.gold.active_misconceptions?.forEach((id) => checkMisconception(id, `${at}.gold.active_misconceptions`));
    turn.gold.do_not_remediate?.forEach((id) => checkConcept(id, `${at}.gold.do_not_remediate`));

    for (const key of turn.gold.acceptable_actions) {
      const [type, id] = key.split(':', 2) as [TutorAction['type'], string | undefined];
      if (!ACTION_TYPES.has(type)) {
        where(`${at} acceptable action "${key}" has unknown type`);
      } else if (id) {
        if (type === 'remediate_misconception') checkMisconception(id, `${at} acceptable action`);
        else checkConcept(id, `${at} acceptable action`);
      }
    }
  });

  return errors;
}

/** Validates every persona and checks ids are unique; throws with all problems at once. */
export function assertValidPersonas(personas: Persona[], graph: ConceptGraph): void {
  const errors = personas.flatMap((persona) => validatePersona(persona, graph));
  const seen = new Set<string>();
  for (const persona of personas) {
    if (seen.has(persona.id)) errors.push(`duplicate persona id ${persona.id}`);
    seen.add(persona.id);
  }
  if (errors.length) throw new Error(`Invalid personas:\n- ${errors.join('\n- ')}`);
}
