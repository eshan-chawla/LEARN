import type { ConceptGraph } from '@/lib/tutor/concept-graph';
import type { TurnKind } from '@/lib/tutor/policy';
import type { Observation } from '@/lib/tutor/types';

/**
 * The Diagnoser turns a free-text student turn into structured evidence o = (c, y, m, κ).
 * The LLM call is injected (`complete`) so this module stays provider-agnostic and testable.
 */
export interface DiagnosisResult {
  targetConceptId: string | null;
  turnKind: TurnKind;
  struggling: boolean;
  observations: Observation[];
  /** Diagnoser output problems (unknown ids, malformed fields) — logged for failure analysis. */
  warnings: string[];
}

export interface DiagnoserContext {
  /** The tutor's previous message, so answers to probes/questions can be graded. */
  previousTutorMessage: string | null;
  /** Concept/misconception the previous tutor message was probing, if any. */
  pendingProbe: { conceptId: string; misconceptionId: string | null } | null;
  studentMessage: string;
}

export const DIAGNOSER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    target_concept_id: { type: ['string', 'null'] },
    turn_kind: { type: 'string', enum: ['question', 'attempt', 'other'] },
    struggling: { type: 'boolean' },
    observations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          concept_id: { type: 'string' },
          correct: { type: ['boolean', 'null'] },
          misconception_id: { type: ['string', 'null'] },
          confidence: { type: 'number' },
        },
        required: ['concept_id', 'correct', 'misconception_id', 'confidence'],
      },
    },
  },
  required: ['target_concept_id', 'turn_kind', 'struggling', 'observations'],
} as const;

export function buildDiagnoserPrompt(graph: ConceptGraph, context: DiagnoserContext): string {
  const catalog = graph.conceptIds
    .map((id) => {
      const concept = graph.getConcept(id);
      const misconceptions = (concept.misconceptions ?? [])
        .map((m) => `    - ${m.id}: ${m.description}`)
        .join('\n');
      return `- ${id}: ${concept.name}${concept.description ? ` — ${concept.description}` : ''}${misconceptions ? `\n${misconceptions}` : ''}`;
    })
    .join('\n');

  return [
    'You are the diagnostic module of a course tutor. Analyze ONLY the student message below and output JSON.',
    'Use only concept ids and misconception ids from the catalog. Never invent ids.',
    '',
    'Fields:',
    '- target_concept_id: the catalog concept the student is asking about or answering on; null if none fits.',
    '- turn_kind: "question" if the student asks something, "attempt" if the student answers/solves something the tutor asked, otherwise "other".',
    '- struggling: true if the attempt is wrong or the student expresses confusion.',
    '- observations: evidence about the student\'s knowledge. correct=true/false only when the message contains a gradable answer or claim; correct=null if the concept is merely mentioned.',
    '  Set misconception_id only when the student states or clearly relies on that specific misconception.',
    '  confidence in [0,1]: how sure you are of this observation. Use <=0.5 for ambiguous evidence.',
    '- Asking a question is NOT evidence of not knowing a concept. Do not mark prerequisites incorrect unless the student\'s own words show an error in them.',
    '',
    'Concept catalog:',
    catalog,
    '',
    context.pendingProbe
      ? `The tutor's previous message was a check question on ${context.pendingProbe.conceptId}${context.pendingProbe.misconceptionId ? ` designed to detect misconception ${context.pendingProbe.misconceptionId}` : ''}.`
      : 'The tutor\'s previous message was not a check question.',
    `Tutor's previous message: ${context.previousTutorMessage ?? '(none)'}`,
    `Student message: ${context.studentMessage}`,
  ].join('\n');
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Diagnoser output contains no JSON object');
  return JSON.parse(candidate.slice(start, end + 1));
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.min(1, Math.max(0, numeric));
}

/**
 * Parses and validates diagnoser output against the graph. Invalid parts are dropped with a
 * warning rather than failing the whole turn, so one bad id cannot corrupt the learner state.
 */
export function parseDiagnosis(
  rawText: string,
  graph: ConceptGraph,
  pendingProbe: DiagnoserContext['pendingProbe'] = null
): DiagnosisResult {
  const warnings: string[] = [];
  const raw = extractJsonObject(rawText) as Record<string, unknown>;

  let targetConceptId = typeof raw.target_concept_id === 'string' ? raw.target_concept_id : null;
  if (targetConceptId && !graph.has(targetConceptId)) {
    warnings.push(`Unknown target concept "${targetConceptId}" dropped.`);
    targetConceptId = null;
  }

  const turnKind: TurnKind =
    raw.turn_kind === 'question' || raw.turn_kind === 'attempt' ? raw.turn_kind : 'other';

  const observations: Observation[] = [];
  for (const item of Array.isArray(raw.observations) ? raw.observations : []) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const conceptId = typeof entry.concept_id === 'string' ? entry.concept_id : '';
    if (!graph.has(conceptId)) {
      warnings.push(`Observation on unknown concept "${conceptId}" dropped.`);
      continue;
    }

    let misconceptionId = typeof entry.misconception_id === 'string' ? entry.misconception_id : null;
    if (misconceptionId && !graph.getMisconception(misconceptionId)) {
      warnings.push(`Unknown misconception "${misconceptionId}" dropped.`);
      misconceptionId = null;
    }

    const correct = typeof entry.correct === 'boolean' ? entry.correct : null;
    const answersProbe =
      pendingProbe?.misconceptionId && pendingProbe.conceptId === conceptId && turnKind === 'attempt'
        ? pendingProbe.misconceptionId
        : null;

    observations.push({
      conceptId,
      correct,
      misconceptionId,
      probeOfMisconceptionId: answersProbe,
      confidence: clampConfidence(entry.confidence),
    });
  }

  const struggling =
    raw.struggling === true ||
    observations.some((o) => o.conceptId === targetConceptId && o.correct === false);

  return { targetConceptId, turnKind, struggling, observations, warnings };
}

/** Runs the diagnoser with an injected completion function (e.g. Gemini JSON mode). */
export async function diagnoseTurn(
  graph: ConceptGraph,
  context: DiagnoserContext,
  complete: (prompt: string) => Promise<string>
): Promise<DiagnosisResult> {
  const output = await complete(buildDiagnoserPrompt(graph, context));
  try {
    return parseDiagnosis(output, graph, context.pendingProbe);
  } catch (error) {
    // Fail closed: no state change, and the failure is visible in the eval logs.
    return {
      targetConceptId: null,
      turnKind: 'other',
      struggling: false,
      observations: [],
      warnings: [`Diagnoser output could not be parsed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
