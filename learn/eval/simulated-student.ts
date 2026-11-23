import type { ConceptGraph } from '@/lib/tutor/concept-graph';
import type { ChatTurn } from '@/lib/tutor/memory';
import type { TutorAction } from '@/lib/tutor/policy';
import type { Persona, SimMode } from '@/eval/trajectory-types';

/**
 * Simulated student for the multi-turn evaluation (J3).
 *
 * `opening` and `distractor` turns always use the persona's script. `respond` turns (and any turn
 * without a script) are generated:
 *   - scripted: deterministic, from the persona's hidden state and the tutor's structured action.
 *       Asked about a known concept → correct answer; about a gap or unlisted concept → a fixed wrong
 *       answer; about a concept the student holds a misconception on → always the misconception.
 *       The hidden state never changes, so results are exactly reproducible (headline numbers).
 *   - llm: an LLM role-plays the persona card and is told to stay consistent with the hidden state
 *       (temperature 0.7, 3 seeds; the sampling settings live in the injected `complete`).
 *
 * The tutor's action is passed alongside its text because the scripted student must know which
 * concept was probed. Every memory mode yields a TutorAction (policy or LLM), so this is
 * available in all conditions; when it is null the student asks for clarification.
 */

export interface TutorView {
  message: string;
  action: TutorAction | null;
}

export interface SimulateInput {
  persona: Persona;
  graph: ConceptGraph;
  /** 0-based index into persona.turns of the student turn being produced. */
  turnIndex: number;
  /** Conversation so far, oldest first (does not include the turn being produced). */
  history: ChatTurn[];
  /** The tutor's latest reply; null before the opening turn. */
  tutor: TutorView | null;
}

export type CompleteText = (prompt: string) => Promise<string>;

function conceptName(graph: ConceptGraph, conceptId: string): string {
  return graph.has(conceptId) ? graph.getConcept(conceptId).name : conceptId.replace(/_/g, ' ');
}

/** The persona's misconceptions on a concept (ids are `<concept>.M<n>`). */
export function heldMisconceptions(persona: Persona, conceptId: string): string[] {
  return persona.hidden_state.misconceptions.filter((id) => id.split('.')[0] === conceptId);
}

export function misconceptionAnswer(graph: ConceptGraph, misconceptionId: string): string {
  const description = graph.getMisconception(misconceptionId)?.description ?? misconceptionId;
  return `I'm pretty sure ${description}. That's how I understood it in lecture.`;
}

export function correctAnswer(graph: ConceptGraph, conceptId: string): string {
  const concept = graph.has(conceptId) ? graph.getConcept(conceptId) : null;
  const name = conceptName(graph, conceptId);
  return concept?.description
    ? `I think I know this one. ${name}: ${concept.description}`
    : `I'm comfortable with ${name}; we covered it and I can use it in exercises.`;
}

export function wrongAnswer(graph: ConceptGraph, conceptId: string): string {
  const name = conceptName(graph, conceptId);
  return `Honestly I'm not sure. I never really understood ${name}, so I'd just be guessing.`;
}

/** How the scripted student answers a question about `conceptId`. */
export function answerAbout(persona: Persona, graph: ConceptGraph, conceptId: string): string {
  const misconceptions = heldMisconceptions(persona, conceptId);
  if (misconceptions.length > 0) return misconceptionAnswer(graph, misconceptions[0]);
  if (persona.hidden_state.known.includes(conceptId)) return correctAnswer(graph, conceptId);
  return wrongAnswer(graph, conceptId);
}

/** Deterministic reply to the tutor's action. */
export function scriptedReply(persona: Persona, graph: ConceptGraph, action: TutorAction | null): string {
  const target = persona.target_concept;
  const targetName = conceptName(graph, target);

  if (!action) return `Sorry, I didn't follow that. Could you explain ${targetName} again?`;

  switch (action.type) {
    case 'probe_prerequisite':
      return answerAbout(persona, graph, action.prerequisiteId);
    case 'formative_question':
    case 'hint':
      return answerAbout(persona, graph, action.conceptId);
    case 'remediate_misconception':
      // Misconceptions are sticky in scripted mode: the student restates the one they hold.
      if (persona.hidden_state.misconceptions.includes(action.misconceptionId)) {
        return misconceptionAnswer(graph, action.misconceptionId);
      }
      return `That's not what I was thinking, but okay. How does that connect to ${targetName}?`;
    case 'remediate_prerequisite':
      return `Okay, thanks for going over ${conceptName(graph, action.prerequisiteId)}. How does that apply to ${targetName}?`;
    case 'answer':
    case 'advance': {
      const [misconception] = heldMisconceptions(persona, target);
      if (misconception) return `${misconceptionAnswer(graph, misconception)} Is that right?`;
      return `I'm still a bit lost. Can you walk me through ${targetName} step by step?`;
    }
  }
}

export function buildRoleplayPrompt(input: SimulateInput, graph: ConceptGraph): string {
  const { persona, history, tutor } = input;
  const list = (ids: string[]) => (ids.length ? ids.map((id) => `${id} (${conceptName(graph, id)})`).join(', ') : 'none');
  const misconceptions = persona.hidden_state.misconceptions.length
    ? persona.hidden_state.misconceptions.map((id) => `- ${id}: you believe that ${graph.getMisconception(id)?.description ?? id}`).join('\n')
    : '- none';
  const transcript = history.length
    ? history.map((turn) => `${turn.role === 'student' ? 'You' : 'Tutor'}: ${turn.content}`).join('\n')
    : '(no messages yet)';

  return [
    'You are role-playing a university student in a deep-learning course, chatting with a course tutor.',
    'Stay strictly consistent with this hidden profile. Never reveal it or mention that you are simulated.',
    `- You are trying to understand: ${conceptName(graph, persona.target_concept)}.`,
    `- You genuinely understand: ${list(persona.hidden_state.known)}. Answer questions on these correctly and briefly.`,
    `- You do NOT understand: ${list(persona.hidden_state.gaps)}. Answer questions on these vaguely or wrongly, as a confused student would. Do not suddenly understand them.`,
    '- You hold these misconceptions and answer according to them whenever they are relevant, even after the tutor explains:',
    misconceptions,
    'Reply in 1-3 sentences, casual student tone, plain text only.',
    '',
    'Conversation so far:',
    transcript,
    '',
    `Tutor: ${tutor?.message ?? '(the tutor has not said anything yet)'}`,
    'You:',
  ].join('\n');
}

export function cleanStudentText(text: string): string {
  return text
    .trim()
    .replace(/^(you|student)\s*:\s*/i, '')
    .replace(/^["'“]+|["'”]+$/g, '')
    .trim();
}

export async function simulateStudentTurn(input: SimulateInput, mode: SimMode, complete?: CompleteText): Promise<string> {
  const turn = input.persona.turns[input.turnIndex];
  if (!turn) throw new Error(`Persona ${input.persona.id} has no turn ${input.turnIndex}`);
  if (turn.script) return turn.script;
  if (turn.kind !== 'respond') throw new Error(`Persona ${input.persona.id} turn ${input.turnIndex} (${turn.kind}) needs a script`);

  const fallback = scriptedReply(input.persona, input.graph, input.tutor?.action ?? null);
  if (mode === 'scripted') return fallback;

  if (!complete) throw new Error("simulateStudentTurn: mode 'llm' needs a complete function");
  const text = cleanStudentText(await complete(buildRoleplayPrompt(input, input.graph)));
  // An empty role-play reply would stall the dialogue; fall back to the scripted answer.
  return text || fallback;
}
