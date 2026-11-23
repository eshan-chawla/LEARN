import { describe, expect, it } from 'vitest';
import { miniGraph } from '@/lib/tutor/__tests__/fixtures';
import type { TutorAction } from '@/lib/tutor/policy';
import {
  answerAbout,
  buildRoleplayPrompt,
  cleanStudentText,
  heldMisconceptions,
  scriptedReply,
  simulateStudentTurn,
  type SimulateInput,
} from '@/eval/simulated-student';
import type { Persona } from '@/eval/trajectory-types';

const graph = miniGraph();

const PERSONA: Persona = {
  id: 'p-test',
  author: 'joao',
  target_concept: 'backprop',
  hidden_state: { known: ['derivatives', 'gradient_descent'], gaps: ['chain_rule'], misconceptions: ['backprop.M1'] },
  turns: [
    { kind: 'opening', script: "I don't get why we multiply all these gradients in backprop.", gold: { acceptable_actions: [] } },
    { kind: 'respond', gold: { acceptable_actions: [] } },
    { kind: 'distractor', script: 'When is the midterm?', gold: { acceptable_actions: ['answer'] } },
    { kind: 'respond', script: 'A fixed respond line.', gold: { acceptable_actions: [] } },
    { kind: 'distractor', gold: { acceptable_actions: [] } },
  ],
};

const probe = (prerequisiteId: string): TutorAction => ({ type: 'probe_prerequisite', conceptId: 'backprop', prerequisiteId, infoGain: 0.2 });

function input(patch: Partial<SimulateInput> = {}): SimulateInput {
  return { persona: PERSONA, graph, turnIndex: 1, history: [], tutor: { message: 'Quick check: what is the chain rule?', action: probe('chain_rule') }, ...patch };
}

describe('scripted student', () => {
  it('answers known concepts correctly and gaps wrongly', () => {
    expect(answerAbout(PERSONA, graph, 'derivatives')).toMatch(/comfortable with Derivatives/);
    expect(answerAbout(PERSONA, graph, 'chain_rule')).toMatch(/never really understood Chain rule/);
  });

  it('treats concepts outside the hidden state as not known', () => {
    expect(answerAbout(PERSONA, graph, 'matrix_multiplication')).toMatch(/not sure/);
  });

  it('always gives the misconception-consistent answer on a concept with a held misconception', () => {
    expect(heldMisconceptions(PERSONA, 'backprop')).toEqual(['backprop.M1']);
    const formative: TutorAction = { type: 'formative_question', conceptId: 'backprop' };
    const remediation: TutorAction = { type: 'remediate_misconception', conceptId: 'backprop', misconceptionId: 'backprop.M1' };
    for (const action of [formative, remediation, remediation]) {
      expect(scriptedReply(PERSONA, graph, action)).toContain('gradients flow forward from the input to the loss');
    }
  });

  it('reacts to remediations, answers and null actions', () => {
    expect(scriptedReply(PERSONA, graph, { type: 'remediate_prerequisite', conceptId: 'backprop', prerequisiteId: 'chain_rule' })).toMatch(
      /going over Chain rule.*Backpropagation/
    );
    expect(scriptedReply(PERSONA, graph, { type: 'answer', conceptId: 'backprop', concise: false })).toMatch(/flow forward.*Is that right\?/);
    expect(scriptedReply(PERSONA, graph, null)).toMatch(/didn't follow/);
    const noMisconception: Persona = { ...PERSONA, hidden_state: { ...PERSONA.hidden_state, misconceptions: [] } };
    expect(scriptedReply(noMisconception, graph, { type: 'answer', conceptId: 'backprop', concise: true })).toMatch(/step by step/);
  });

  it('is deterministic', async () => {
    const a = await simulateStudentTurn(input(), 'scripted');
    const b = await simulateStudentTurn(input(), 'scripted');
    expect(a).toBe(b);
    expect(a).toMatch(/Chain rule/);
  });
});

describe('simulateStudentTurn', () => {
  it('uses the script for opening and distractor turns, and for respond turns that have one', async () => {
    expect(await simulateStudentTurn(input({ turnIndex: 0, tutor: null }), 'llm')).toBe(PERSONA.turns[0].script);
    expect(await simulateStudentTurn(input({ turnIndex: 2 }), 'scripted')).toBe('When is the midterm?');
    expect(await simulateStudentTurn(input({ turnIndex: 3 }), 'scripted')).toBe('A fixed respond line.');
  });

  it('rejects scriptless opening/distractor turns and missing turns', async () => {
    await expect(simulateStudentTurn(input({ turnIndex: 4 }), 'scripted')).rejects.toThrow(/needs a script/);
    await expect(simulateStudentTurn(input({ turnIndex: 9 }), 'scripted')).rejects.toThrow(/no turn 9/);
  });

  it('llm mode role-plays with the hidden state in the prompt and cleans the reply', async () => {
    const prompts: string[] = [];
    const complete = async (prompt: string) => {
      prompts.push(prompt);
      return 'You: "um, I think you multiply the derivatives? not sure"';
    };
    const reply = await simulateStudentTurn(
      input({ history: [{ role: 'student', content: 'hi' }, { role: 'tutor', content: 'hello' }] }),
      'llm',
      complete
    );
    expect(reply).toBe('um, I think you multiply the derivatives? not sure');
    expect(prompts[0]).toContain('chain_rule (Chain rule)');
    expect(prompts[0]).toContain('backprop.M1: you believe that gradients flow forward');
    expect(prompts[0]).toContain('You: hi\nTutor: hello');
    expect(prompts[0]).toContain('Tutor: Quick check: what is the chain rule?');
  });

  it('llm mode falls back to the scripted answer on an empty reply and needs complete', async () => {
    expect(await simulateStudentTurn(input(), 'llm', async () => '  ')).toBe(scriptedReply(PERSONA, graph, probe('chain_rule')));
    await expect(simulateStudentTurn(input(), 'llm')).rejects.toThrow(/needs a complete/);
  });

  it('prompt handles an empty profile and no tutor message', () => {
    const blank: Persona = { ...PERSONA, hidden_state: { known: [], gaps: [], misconceptions: [] } };
    const prompt = buildRoleplayPrompt(input({ persona: blank, tutor: null }), graph);
    expect(prompt).toContain('You genuinely understand: none');
    expect(prompt).toContain('- none');
    expect(prompt).toContain('(the tutor has not said anything yet)');
  });

  it('cleanStudentText strips speaker labels and quotes', () => {
    expect(cleanStudentText('Student: “hello there”')).toBe('hello there');
  });
});
