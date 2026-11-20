import { describe, expect, it } from 'vitest';
import { ABLATIONS } from '@/eval/configs';
import { judgeCorrectness } from '@/eval/judge';
import { newRunId, parseJsonl } from '@/eval/io';

describe('ABLATIONS', () => {
  it('ABLATIONS differ only in rag/critic and all use memory none', () => {
    expect(ABLATIONS).toEqual({
      A0: { rag: 'none', critic: false, memory: 'none' },
      A1: { rag: 'dense', critic: false, memory: 'none' },
      A2: { rag: 'hybrid', critic: false, memory: 'none' },
      A3: { rag: 'hybrid', critic: true, memory: 'none' },
    });
  });
});

describe('judgeCorrectness', () => {
  const input = { question: 'q', goldAnswer: 'g', answer: 'a' };

  it('parses the verdict and snaps scores to 0 / 0.5 / 1', async () => {
    expect(await judgeCorrectness(input, async () => '{"correct": 1, "reason": "matches"}')).toEqual({ correct: 1, reason: 'matches' });
    expect((await judgeCorrectness(input, async () => '```json\n{"correct": 0.6, "reason": "partly"}\n```')).correct).toBe(0.5);
  });

  it('fails closed on unparseable output', async () => {
    expect(await judgeCorrectness(input, async () => 'looks right to me')).toEqual({ correct: null, reason: 'judge parse error' });
  });

  it('puts gold answer and candidate in the prompt', async () => {
    let seen = '';
    await judgeCorrectness(input, async (prompt) => {
      seen = prompt;
      return '{"correct":0,"reason":"x"}';
    });
    expect(seen).toContain('Reference answer: g');
    expect(seen).toContain('Candidate answer: a');
  });
});

describe('io', () => {
  it('parseJsonl skips blank lines and newRunId is prefixed and unique', () => {
    expect(parseJsonl('{"a":1}\n\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
    const a = newRunId('A1');
    expect(a).toMatch(/^A1-\d{4}-\d{2}-\d{2}T[\d-]+-[0-9a-f]{6}$/);
    expect(newRunId('A1')).not.toBe(a);
  });
});
