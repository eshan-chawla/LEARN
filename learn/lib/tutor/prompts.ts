import { buildAskAiGuardrailPrompt } from '@/lib/ask-ai/guardrails';
import type { RetrievalHit } from '@/lib/retrieval/types';
import type { ConceptGraph } from '@/lib/tutor/concept-graph';
import type { CitedExcerpt } from '@/lib/tutor/critic-types';
import type { PolicyDecision, TutorAction } from '@/lib/tutor/policy';

export const ACTION_TYPES = [
  'answer',
  'hint',
  'probe_prerequisite',
  'remediate_prerequisite',
  'remediate_misconception',
  'formative_question',
  'advance',
] as const;

export function toCitedExcerpts(hits: RetrievalHit[]): CitedExcerpt[] {
  return hits.map((hit, i) => ({
    index: i + 1,
    text: hit.text,
    sourceId: hit.sourceId,
    pageNumber: hit.pageNumber,
    startSeconds: hit.startSeconds,
  }));
}

function name(graph: ConceptGraph, id: string): string {
  return graph.has(id) ? `${graph.getConcept(id).name} (${id})` : id;
}

/** Natural-language instruction realizing one policy action. */
export function describeAction(action: TutorAction, graph: ConceptGraph): string {
  switch (action.type) {
    case 'answer':
      return action.concise
        ? `Answer the question concisely (2-4 sentences); the student already knows ${action.conceptId ? name(graph, action.conceptId) : 'this'} well.`
        : 'Answer the question clearly, step by step, at an introductory level.';
    case 'hint':
      return `Do not give the full solution. Give a level-${action.level} hint on ${name(graph, action.conceptId)} (1 = gentle nudge, 3 = nearly explicit next step).`;
    case 'probe_prerequisite':
      return `Before addressing ${name(graph, action.conceptId)}, ask ONE short check question on the prerequisite ${name(graph, action.prerequisiteId)} to see whether the student understands it. Do not explain it yet.`;
    case 'remediate_prerequisite':
      return `The root cause is a gap in the prerequisite ${name(graph, action.prerequisiteId)}. Briefly re-teach it with one concrete example and connect it to ${name(graph, action.conceptId)}.`;
    case 'remediate_misconception': {
      const misconception = graph.getMisconception(action.misconceptionId);
      return [
        `The student holds the misconception that ${misconception?.description ?? action.misconceptionId}.`,
        'Refute it directly with a concrete contrasting example (do not just re-explain the topic).',
        misconception ? `Then ask exactly this check question: "${misconception.probe}"` : '',
      ].join(' ');
    }
    case 'formative_question':
      return `Ask ONE short question that checks understanding of ${name(graph, action.conceptId)}. Do not answer it.`;
    case 'advance':
      return `The student has mastered ${action.fromConceptId ? name(graph, action.fromConceptId) : 'the current topic'}. Confirm briefly, then introduce ${name(graph, action.nextConceptId)} in 2-3 sentences.`;
  }
}

function describeDecision(decision: PolicyDecision, graph: ConceptGraph): string {
  const followUp = decision.followUp ? ` Then: ${describeAction(decision.followUp, graph)}` : '';
  return `${describeAction(decision.primary, graph)}${followUp}`;
}

function conceptCatalog(graph: ConceptGraph): string {
  return graph.conceptIds
    .map((id) => {
      const misconceptions = graph.misconceptionsOf(id).map((m) => `${m.id}: ${m.description}`);
      return `- ${id}${misconceptions.length ? ` (misconceptions: ${misconceptions.join('; ')})` : ''}`;
    })
    .join('\n');
}

export interface TutorPromptArgs {
  studentMessage: string;
  excerpts: CitedExcerpt[];
  memoryBlock: string;
  /** Set in structured mode: the policy already chose the move. Null → the LLM chooses. */
  decision: PolicyDecision | null;
  graph: ConceptGraph;
  ragEnabled: boolean;
}

export function buildTutorPrompt(args: TutorPromptArgs): string {
  const { studentMessage, excerpts, memoryBlock, decision, graph, ragEnabled } = args;
  const lines: string[] = ['You are LEARN, a patient tutor for a university deep learning course.', ''];

  if (ragEnabled) {
    lines.push(buildAskAiGuardrailPrompt('the retrieved course excerpts'), '');
    lines.push('Course excerpts (cite them in the reply as [n]):');
    lines.push(excerpts.length > 0 ? excerpts.map((e) => `[${e.index}] ${e.text}`).join('\n\n') : '(no excerpts were retrieved)');
    lines.push('');
  } else {
    lines.push('No course excerpts are available; rely on standard deep learning knowledge.', '');
  }

  if (memoryBlock) lines.push('What you know about this student and conversation:', memoryBlock, '');

  if (decision) {
    lines.push(`Tutoring move (chosen by the learner model, follow it): ${describeDecision(decision, graph)}`);
  } else {
    lines.push(
      `Choose the single best tutoring move from: ${ACTION_TYPES.join(', ')}.`,
      'Probe or remediate a prerequisite only if you have evidence it is the cause of the difficulty.',
      'Course concepts (use these ids exactly):',
      conceptCatalog(graph)
    );
  }

  lines.push(
    '',
    'Respond with JSON only, in this shape:',
    '{"action": {"type": "<move>", "concept_id": "<id or null>", "prerequisite_id": "<id or null>", "misconception_id": "<id or null>", "next_concept_id": "<id or null>", "level": <1-3 or null>}, "reply": "<message to the student, markdown allowed>"}',
    '',
    `Student message: ${studentMessage}`
  );
  return lines.join('\n');
}

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toAction(raw: Record<string, unknown>, graph: ConceptGraph, warnings: string[]): TutorAction | null {
  const type = str(raw.type);
  const concept = str(raw.concept_id);
  const prerequisite = str(raw.prerequisite_id);
  const next = str(raw.next_concept_id);
  const known = (id: string | null, field: string): id is string => {
    if (id && graph.has(id)) return true;
    warnings.push(`Generator action ${type}: unknown or missing ${field} "${id}"`);
    return false;
  };

  switch (type) {
    case 'answer':
      return { type, conceptId: concept && graph.has(concept) ? concept : null, concise: false };
    case 'hint': {
      if (!known(concept, 'concept_id')) return null;
      const level = Number(raw.level);
      return { type, conceptId: concept, level: Number.isFinite(level) ? Math.min(3, Math.max(1, Math.round(level))) : 1 };
    }
    case 'probe_prerequisite':
    case 'remediate_prerequisite':
      if (!known(concept, 'concept_id') || !known(prerequisite, 'prerequisite_id')) return null;
      return type === 'probe_prerequisite'
        ? { type, conceptId: concept, prerequisiteId: prerequisite, infoGain: 0 }
        : { type, conceptId: concept, prerequisiteId: prerequisite };
    case 'remediate_misconception': {
      const misconceptionId = str(raw.misconception_id);
      const misconception = misconceptionId ? graph.getMisconception(misconceptionId) : undefined;
      if (!misconceptionId || !misconception) {
        warnings.push(`Generator action remediate_misconception: unknown misconception_id "${misconceptionId}"`);
        return null;
      }
      return { type, conceptId: misconception.conceptId, misconceptionId };
    }
    case 'formative_question':
      return known(concept, 'concept_id') ? { type, conceptId: concept } : null;
    case 'advance':
      return known(next, 'next_concept_id')
        ? { type, fromConceptId: concept && graph.has(concept) ? concept : null, nextConceptId: next }
        : null;
    default:
      warnings.push(`Generator returned unknown action type "${type}"`);
      return null;
  }
}

/** Tolerant parse of the generator's JSON; prose output becomes the reply with no action. */
export function parseTutorReply(
  text: string,
  graph: ConceptGraph
): { action: TutorAction | null; reply: string; warnings: string[] } {
  const warnings: string[] = [];
  const json = extractJson(text);
  const reply = json ? str(json.reply) : null;
  if (!json || !reply) {
    warnings.push('Generator output was not the expected JSON; using raw text as the reply.');
    return { action: null, reply: text.trim(), warnings };
  }
  const rawAction = json.action && typeof json.action === 'object' ? (json.action as Record<string, unknown>) : null;
  if (!rawAction) warnings.push('Generator output has no action object.');
  return { action: rawAction ? toAction(rawAction, graph, warnings) : null, reply, warnings };
}
