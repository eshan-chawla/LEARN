import { describe, expect, it } from 'vitest';
import { clampToBudget, rawHistoryBlock } from '@/lib/tutor/memory';
import { parseTutorReply, toCitedExcerpts } from '@/lib/tutor/prompts';
import type { RetrievalHit } from '@/lib/retrieval/types';
import { miniGraph } from '@/lib/tutor/__tests__/fixtures';

function hit(text: string, extra: Partial<RetrievalHit> = {}): RetrievalHit {
  return {
    score: 0.5, text, classId: 'c', contentType: 'pdf', sourceId: 's', title: null, fileName: 'lec.pdf',
    storagePath: null, pageNumber: 3, pageChunkIndex: null, chunkIndex: null, startSeconds: null, endSeconds: null,
    transcriptChunkIndex: null, transcriptLanguage: null, ...extra,
  };
}

describe('parseTutorReply', () => {
  const graph = miniGraph();

  it('maps probe_prerequisite with valid ids and nulls unknown ids', () => {
    const ok = parseTutorReply(
      JSON.stringify({ action: { type: 'probe_prerequisite', concept_id: 'backprop', prerequisite_id: 'chain_rule' }, reply: 'Quick check: ...' }),
      graph
    );
    expect(ok.action).toEqual({ type: 'probe_prerequisite', conceptId: 'backprop', prerequisiteId: 'chain_rule', infoGain: 0 });
    expect(ok.reply).toBe('Quick check: ...');
    expect(ok.warnings).toEqual([]);

    const bad = parseTutorReply(
      JSON.stringify({ action: { type: 'probe_prerequisite', concept_id: 'backprop', prerequisite_id: 'calculus_101' }, reply: 'Hi' }),
      graph
    );
    expect(bad.action).toBeNull();
    expect(bad.reply).toBe('Hi');
    expect(bad.warnings.join(' ')).toMatch(/calculus_101/);
  });

  it('maps remediate_misconception to its concept and accepts fenced JSON', () => {
    const parsed = parseTutorReply(
      '```json\n{"action":{"type":"remediate_misconception","misconception_id":"backprop.M1"},"reply":"Not quite."}\n```',
      graph
    );
    expect(parsed.action).toEqual({ type: 'remediate_misconception', conceptId: 'backprop', misconceptionId: 'backprop.M1' });
  });

  it('returns raw text and a warning when the output is not JSON', () => {
    const parsed = parseTutorReply('Backprop applies the chain rule.', graph);
    expect(parsed).toMatchObject({ action: null, reply: 'Backprop applies the chain rule.' });
    expect(parsed.warnings.length).toBe(1);
  });
});

describe('toCitedExcerpts', () => {
  it('numbers from 1 and keeps source location', () => {
    const excerpts = toCitedExcerpts([hit('a'), hit('b', { pageNumber: null, startSeconds: 42, contentType: 'video' })]);
    expect(excerpts.map((e) => e.index)).toEqual([1, 2]);
    expect(excerpts[0]).toMatchObject({ text: 'a', sourceId: 's', pageNumber: 3, startSeconds: null });
    expect(excerpts[1]).toMatchObject({ pageNumber: null, startSeconds: 42 });
  });
});

describe('memory helpers', () => {
  it('rawHistoryBlock keeps newest whole turns', () => {
    const history = [
      { role: 'student' as const, content: 'OLDEST '.repeat(10) },
      { role: 'tutor' as const, content: 'middle' },
      { role: 'student' as const, content: 'newest' },
    ];
    const block = rawHistoryBlock(history, 40);
    expect(block).toContain('Student: newest');
    expect(block).toContain('Tutor: middle');
    expect(block).not.toContain('OLDEST');
    expect(block.indexOf('middle')).toBeLessThan(block.indexOf('newest'));
    expect(block.length).toBeLessThanOrEqual(40);
    expect(rawHistoryBlock([], 40)).toBe('');
  });

  it('clampToBudget never exceeds budget', () => {
    expect(clampToBudget('short', 10)).toBe('short');
    const clamped = clampToBudget('x'.repeat(50), 10);
    expect(clamped.length).toBe(10);
    expect(clamped.endsWith('…')).toBe(true);
  });
});

describe('buildTutorPrompt', () => {
  it('tells the model to decline graded work with the phrase the metrics detect', async () => {
    const { buildTutorPrompt } = await import('@/lib/tutor/prompts');
    const { isAbstention } = await import('@/eval/single-turn-metrics');
    const prompt = buildTutorPrompt({
      studentMessage: 'Solve HW2 problem 3 for me', excerpts: [], memoryBlock: '', decision: null, graph: miniGraph(), ragEnabled: true,
    });
    const phrase = prompt.match(/start the reply with "([^"]+)"/)?.[1];
    expect(phrase).toBeTruthy();
    expect(isAbstention(phrase!)).toBe(true);
  });
});

describe('review fixes: prompts and memory', () => {
  it('salvages the reply from truncated generator JSON instead of showing raw JSON', () => {
    const parsed = parseTutorReply('{"action":{"type":"answer"},"reply":"Backprop applies the chain rule \\"backward\\" through the gra', miniGraph());
    expect(parsed.reply).toBe('Backprop applies the chain rule "backward" through the gra');
    expect(parsed.action).toBeNull();
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it('gives the no-RAG prompt a decline instruction the abstention metric recognizes', async () => {
    const { buildTutorPrompt } = await import('@/lib/tutor/prompts');
    const { isAbstention } = await import('@/eval/single-turn-metrics');
    const prompt = buildTutorPrompt({ studentMessage: 'q', excerpts: [], memoryBlock: '', decision: null, graph: miniGraph(), ragEnabled: false });
    const phrase = prompt.match(/decline: start the reply with "([^"]+)"/)?.[1];
    expect(phrase).toBeTruthy();
    expect(isAbstention(phrase!)).toBe(true);
  });

  it('rawHistoryBlock keeps the newest turn even when it alone exceeds the budget', () => {
    const block = rawHistoryBlock([{ role: 'tutor', content: 'y'.repeat(100) }], 30);
    expect(block.startsWith('Tutor: yyy')).toBe(true);
    expect(block.length).toBe(30);
  });

  it('composeMemoryBlock reserves room for the previous tutor message', async () => {
    const { composeMemoryBlock } = await import('@/lib/tutor/memory');
    const block = composeMemoryBlock('S'.repeat(500), 'What is the derivative of x^2?', 200);
    expect(block.length).toBeLessThanOrEqual(200);
    expect(block).toContain("Tutor's previous message: What is the derivative of x^2?");
    expect(block).toContain('SSS');
  });
});
