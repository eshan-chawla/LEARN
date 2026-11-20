import { describe, expect, it, vi } from 'vitest';
import { ABSTAIN_MESSAGE, type CriticVerdict } from '@/lib/tutor/critic-types';
import { createSession, runTutorTurn, type TutorConfig, type TutorSession } from '@/lib/tutor/pipeline';
import type { RetrievalHit } from '@/lib/retrieval/types';
import { miniGraph } from '@/lib/tutor/__tests__/fixtures';

const DIAGNOSER_MARKER = 'diagnostic module';
const SUMMARY_MARKER = 'running summary';

type Reply = string | object | Error;

function hit(text: string, conceptIds: string[] = [], score = 0.5): RetrievalHit {
  return {
    score, text, classId: 'class-1', contentType: 'pdf', sourceId: `src-${text}`, title: null, fileName: 'lec.pdf',
    storagePath: null, pageNumber: 1, pageChunkIndex: null, chunkIndex: null, startSeconds: null, endSeconds: null,
    transcriptChunkIndex: null, transcriptLanguage: null, conceptIds,
  };
}

function verdict(action: CriticVerdict['action'], revisedAnswer: string | null = null): CriticVerdict {
  return { claims: [], supportedFraction: action === 'accept' ? 1 : 0.5, integrityViolation: false, action, revisedAnswer, warnings: [] };
}

function fakeDeps(opts: { diagnosis?: Reply; generator?: Reply; summary?: Reply; hits?: RetrievalHit[] | Error; critic?: CriticVerdict } = {}) {
  const prompts: Array<{ kind: 'diagnose' | 'summary' | 'generate'; prompt: string; json: boolean }> = [];
  const answer = (reply: Reply | undefined, fallback: object) => {
    if (reply instanceof Error) throw reply;
    const value = reply ?? fallback;
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  const complete = vi.fn(async (prompt: string, options: { json: boolean }) => {
    if (prompt.includes(DIAGNOSER_MARKER)) {
      prompts.push({ kind: 'diagnose', prompt, json: options.json });
      return answer(opts.diagnosis, { target_concept_id: null, turn_kind: 'other', struggling: false, observations: [] });
    }
    if (prompt.includes(SUMMARY_MARKER)) {
      prompts.push({ kind: 'summary', prompt, json: options.json });
      return answer(opts.summary, {});
    }
    prompts.push({ kind: 'generate', prompt, json: options.json });
    return answer(opts.generator, { action: { type: 'answer', concept_id: null }, reply: 'Tutor reply [1].' });
  });
  const retrieve = vi.fn(async () => {
    if (opts.hits instanceof Error) throw opts.hits;
    return opts.hits ?? [hit('excerpt')];
  });
  const critique = vi.fn(async () => opts.critic ?? verdict('accept'));
  return { deps: { complete, retrieve, critique }, prompts, retrieve, critique };
}

const STRUCTURED: TutorConfig = { rag: 'dense', critic: false, memory: 'structured' };
const graph = miniGraph();

function sessionWith(patch: Partial<TutorSession> = {}): TutorSession {
  return { ...createSession(graph), ...patch };
}

describe('runTutorTurn — structured memory', () => {
  it('structured: wrong answer to a pending chain_rule probe lowers chain_rule mastery and sets the next pending probe', async () => {
    const session = sessionWith({
      history: [{ role: 'tutor', content: 'What is the derivative of f(g(x))?' }],
      pendingProbe: { conceptId: 'chain_rule', misconceptionId: null },
    });
    const { deps, prompts } = fakeDeps({
      diagnosis: {
        target_concept_id: 'chain_rule', turn_kind: 'attempt', struggling: true,
        observations: [{ concept_id: 'chain_rule', correct: false, misconception_id: null, confidence: 1 }],
      },
    });

    const result = await runTutorTurn({ classId: 'class-1', graph, session, studentMessage: "f'(g(x))?" }, STRUCTURED, deps);

    expect(prompts[0].kind).toBe('diagnose');
    expect(prompts[0].json).toBe(true);
    expect(prompts[0].prompt).toContain('check question on chain_rule');
    expect(prompts[0].prompt).toContain('What is the derivative of f(g(x))?');
    expect(result.session.state.concepts.chain_rule.mastery).toBeLessThan(session.state.concepts.chain_rule.mastery);
    expect(result.actionSource).toBe('policy');
    expect(result.action).toMatchObject({ type: 'probe_prerequisite', prerequisiteId: 'derivatives' });
    expect(result.session.pendingProbe).toEqual({ conceptId: 'derivatives', misconceptionId: null });
    expect(result.decision?.rationale.length).toBeGreaterThan(0);
    expect(result.session.history.slice(-2)).toEqual([
      { role: 'student', content: "f'(g(x))?" },
      { role: 'tutor', content: result.reply },
    ]);
  });

  it('structured: active misconception yields remediate_misconception and a pending misconception probe', async () => {
    const { deps, prompts } = fakeDeps({
      diagnosis: {
        target_concept_id: 'backprop', turn_kind: 'attempt', struggling: true,
        observations: [{ concept_id: 'backprop', correct: false, misconception_id: 'backprop.M1', confidence: 0.9 }],
      },
    });

    const result = await runTutorTurn(
      { classId: 'class-1', graph, session: sessionWith(), studentMessage: 'Gradients go from input to loss.' },
      STRUCTURED,
      deps
    );

    expect(result.action).toEqual({ type: 'remediate_misconception', conceptId: 'backprop', misconceptionId: 'backprop.M1' });
    expect(result.session.pendingProbe).toEqual({ conceptId: 'backprop', misconceptionId: 'backprop.M1' });
    const generatorPrompt = prompts.find((p) => p.kind === 'generate')!.prompt;
    expect(generatorPrompt).toContain('In which direction are gradients propagated');
  });

  it('structured: retrieval query is conditioned and hits tagged with the focus concept rank first', async () => {
    const { deps, retrieve } = fakeDeps({
      diagnosis: { target_concept_id: 'backprop', turn_kind: 'question', struggling: false, observations: [] },
      hits: [hit('untagged', [], 0.5), hit('tagged', ['backprop'], 0.45)],
    });

    const result = await runTutorTurn(
      { classId: 'class-1', graph, session: sessionWith(), studentMessage: 'Why does this work?' },
      STRUCTURED,
      deps
    );

    const request = (retrieve.mock.calls[0] as unknown[])[0] as { query: string; mode: string; limit: number; classId: string };
    expect(request.query).toContain('Why does this work?');
    expect(request.query).toContain('Backpropagation');
    expect(request).toMatchObject({ mode: 'dense', limit: 6, classId: 'class-1' });
    expect(result.excerpts.map((e) => e.text)).toEqual(['tagged', 'untagged']);
  });

  it('diagnoser failure leaves state unchanged', async () => {
    const session = sessionWith();
    const { deps } = fakeDeps({ diagnosis: 'I think the student is confused.' });
    const result = await runTutorTurn({ classId: 'class-1', graph, session, studentMessage: 'hmm' }, STRUCTURED, deps);
    expect(result.session.state).toEqual(session.state);
    expect(result.warnings.join(' ')).toMatch(/Diagnoser/);
    expect(result.reply).toBe('Tutor reply [1].');
  });

  it('diagnoser network error is treated like a failed diagnosis', async () => {
    const session = sessionWith();
    const { deps } = fakeDeps({ diagnosis: new Error('ECONNRESET') });
    const result = await runTutorTurn({ classId: 'class-1', graph, session, studentMessage: 'hmm' }, STRUCTURED, deps);
    expect(result.session.state).toEqual(session.state);
    expect(result.warnings.join(' ')).toMatch(/ECONNRESET/);
  });
});

describe('runTutorTurn — baseline memory modes', () => {
  it('none: diagnoser is never called and the state is unchanged', async () => {
    const session = sessionWith({ history: [{ role: 'tutor', content: 'EARLIER TUTOR MESSAGE' }] });
    const { deps, prompts } = fakeDeps({
      generator: { action: { type: 'hint', concept_id: 'backprop', level: 2 }, reply: 'Think about the chain rule.' },
    });

    const result = await runTutorTurn(
      { classId: 'class-1', graph, session, studentMessage: 'I am stuck on backprop' },
      { rag: 'dense', critic: false, memory: 'none' },
      deps
    );

    expect(prompts.filter((p) => p.kind === 'diagnose')).toHaveLength(0);
    expect(prompts[0].prompt).not.toContain('EARLIER TUTOR MESSAGE');
    expect(result.session.state).toEqual(session.state);
    expect(result.actionSource).toBe('llm');
    expect(result.action).toEqual({ type: 'hint', conceptId: 'backprop', level: 2 });
    expect(result.session.pendingProbe).toBeNull();
  });

  it('raw: the memory block holds only whole turns within memoryCharBudget', async () => {
    const session = sessionWith({
      history: [
        { role: 'student', content: `OLDEST ${'x'.repeat(200)}` },
        { role: 'tutor', content: 'NEWEST TUTOR TURN' },
      ],
    });
    const { deps, prompts } = fakeDeps();
    await runTutorTurn(
      { classId: 'class-1', graph, session, studentMessage: 'next' },
      { rag: 'dense', critic: false, memory: 'raw', memoryCharBudget: 100 },
      deps
    );
    expect(prompts[0].prompt).toContain('Tutor: NEWEST TUTOR TURN');
    expect(prompts[0].prompt).not.toContain('OLDEST');
  });

  it('summary: makes exactly one extra completion and stores the new summary', async () => {
    const { deps, prompts } = fakeDeps({ summary: 'Student is unsure about the chain rule.' });
    const result = await runTutorTurn(
      { classId: 'class-1', graph, session: sessionWith({ summary: 'PREVIOUS SUMMARY' }), studentMessage: 'help' },
      { rag: 'dense', critic: false, memory: 'summary' },
      deps
    );
    expect(prompts.map((p) => p.kind)).toEqual(['generate', 'summary']);
    expect(prompts[0].prompt).toContain('PREVIOUS SUMMARY');
    expect(prompts[1].json).toBe(false);
    expect(result.session.summary).toBe('Student is unsure about the chain rule.');
  });

  it('falls back to raw text when generator JSON is malformed', async () => {
    const { deps } = fakeDeps({ generator: 'Backprop multiplies local gradients [1].' });
    const result = await runTutorTurn(
      { classId: 'class-1', graph, session: sessionWith(), studentMessage: 'why?' },
      { rag: 'dense', critic: false, memory: 'none' },
      deps
    );
    expect(result.reply).toBe('Backprop multiplies local gradients [1].');
    expect(result.action).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('runTutorTurn — retrieval and critic flags', () => {
  it('rag none: retrieve is not called and excerpts are empty', async () => {
    const { deps, retrieve, prompts } = fakeDeps();
    const result = await runTutorTurn(
      { classId: 'class-1', graph, session: sessionWith(), studentMessage: 'what is a gradient?' },
      { rag: 'none', critic: true, memory: 'none' },
      deps
    );
    expect(retrieve).not.toHaveBeenCalled();
    expect(result.excerpts).toEqual([]);
    expect(prompts[0].prompt).not.toContain('Guardrails:');
    expect(result.critic).toBeNull();
  });

  it('passes the hybrid mode through to retrieve and adds guardrails', async () => {
    const { deps, retrieve, prompts } = fakeDeps();
    await runTutorTurn(
      { classId: 'class-1', graph, session: sessionWith(), studentMessage: 'q' },
      { rag: 'hybrid', critic: false, memory: 'none' },
      deps
    );
    expect((retrieve.mock.calls[0] as unknown[])[0]).toMatchObject({ mode: 'hybrid', query: 'q' });
    expect(prompts[0].prompt).toContain('Guardrails:');
    expect(prompts[0].prompt).toContain('[1] excerpt');
  });

  it('continues without excerpts when retrieve throws', async () => {
    const { deps } = fakeDeps({ hits: new Error('Modal timeout') });
    const result = await runTutorTurn(
      { classId: 'class-1', graph, session: sessionWith(), studentMessage: 'q' },
      { rag: 'dense', critic: false, memory: 'none' },
      deps
    );
    expect(result.excerpts).toEqual([]);
    expect(result.steps.find((s) => s.kind === 'retrieve')).toMatchObject({ ok: false });
    expect(result.steps.find((s) => s.kind === 'retrieve')?.detail).toContain('Modal timeout');
    expect(result.reply).toBe('Tutor reply [1].');
  });

  it('critic revise replaces the reply', async () => {
    const { deps, critique } = fakeDeps({ critic: verdict('revise', 'Revised [1].') });
    const result = await runTutorTurn(
      { classId: 'class-1', graph, session: sessionWith(), studentMessage: 'q' },
      { rag: 'dense', critic: true, memory: 'none' },
      deps
    );
    expect(critique).toHaveBeenCalledWith({ question: 'q', answer: 'Tutor reply [1].', excerpts: result.excerpts });
    expect(result.reply).toBe('Revised [1].');
    expect(result.critic?.action).toBe('revise');
  });

  it('critic abstain returns ABSTAIN_MESSAGE', async () => {
    const { deps } = fakeDeps({ critic: verdict('abstain') });
    const result = await runTutorTurn(
      { classId: 'class-1', graph, session: sessionWith(), studentMessage: 'q' },
      { rag: 'dense', critic: true, memory: 'none' },
      deps
    );
    expect(result.reply).toBe(ABSTAIN_MESSAGE);
  });

  it('critic off never calls critique', async () => {
    const { deps, critique } = fakeDeps({ critic: verdict('abstain') });
    const result = await runTutorTurn(
      { classId: 'class-1', graph, session: sessionWith(), studentMessage: 'q' },
      { rag: 'dense', critic: false, memory: 'none' },
      deps
    );
    expect(critique).not.toHaveBeenCalled();
    expect(result.reply).toBe('Tutor reply [1].');
  });
});

describe('review fixes: pipeline', () => {
  it('structured mode ignores the generator action, so bad ids do not mark the step as failed', async () => {
    const { deps } = fakeDeps({
      diagnosis: { target_concept_id: 'backprop', turn_kind: 'question', struggling: false, observations: [] },
      generator: { action: { type: 'hint', concept_id: 'not_a_concept' }, reply: 'Here is how it works [1].' },
    });
    const result = await runTutorTurn({ classId: 'class-1', graph, session: sessionWith(), studentMessage: 'q' }, STRUCTURED, deps);
    expect(result.steps.find((s) => s.kind === 'generate')?.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('keeps the previous tutor message in summary mode even when the summary fills the budget', async () => {
    const session = sessionWith({ summary: 'S'.repeat(5000), history: [{ role: 'tutor', content: 'PROBE: what is dL/dw?' }] });
    const { deps, prompts } = fakeDeps({ summary: 'new' });
    const result = await runTutorTurn(
      { classId: 'class-1', graph, session, studentMessage: 'yes' },
      { rag: 'none', critic: false, memory: 'summary', memoryCharBudget: 300 },
      deps
    );
    expect(prompts[0].prompt).toContain('PROBE: what is dL/dw?');
    expect(result.memoryChars).toBeGreaterThan(0);
    expect(result.memoryChars).toBeLessThanOrEqual(300);
  });
});
