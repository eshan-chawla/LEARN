import { describe, expect, it } from 'vitest';
import {
  CRITIC_ACCEPT_THRESHOLD,
  buildCriticPrompt,
  checkClaims,
  critiqueAnswer,
  decideAction,
  makeCritic,
  parseCriticOutput,
  toBool,
  toCitationList,
} from '@/lib/tutor/critic';
import type { CitedExcerpt, ClaimCheck } from '@/lib/tutor/critic-types';

const EXCERPTS: CitedExcerpt[] = [
  { index: 1, text: 'Backpropagation applies the chain rule layer by layer.', sourceId: 's1', pageNumber: 12, startSeconds: null },
  { index: 2, text: 'Gradients are propagated from the loss back to the inputs.', sourceId: 's1', pageNumber: 13, startSeconds: null },
  { index: 3, text: 'Vanishing gradients slow learning in deep sigmoid networks.', sourceId: 'v1', pageNumber: null, startSeconds: 95.4 },
];

describe('buildCriticPrompt', () => {
  it('numbers excerpts with their source location and includes question and answer', () => {
    const prompt = buildCriticPrompt({ question: 'What is backprop?', answer: 'It uses the chain rule [1].', excerpts: EXCERPTS });
    expect(prompt).toContain('[1] (page 12) Backpropagation applies the chain rule');
    expect(prompt).toContain('[3] (at 95s) Vanishing gradients');
    expect(prompt).toContain('QUESTION: What is backprop?');
    expect(prompt).toContain('ANSWER: It uses the chain rule [1].');
  });

  it('tells the model to judge only against cited excerpts and to flag graded work', () => {
    const prompt = buildCriticPrompt({ question: 'q', answer: 'a', excerpts: [] });
    expect(prompt).toContain('(no excerpts)');
    expect(prompt).toMatch(/cited excerpts, read on their own/);
    expect(prompt).toMatch(/graded assignment/);
  });
});

describe('tolerant field parsing', () => {
  it('reads booleans in several shapes and defaults to false', () => {
    expect([true, 'true', 'YES', 1, '1'].map(toBool)).toEqual([true, true, true, true, true]);
    expect([false, 'no', 0, null, undefined, {}].map(toBool)).toEqual([false, false, false, false, false, false]);
  });

  it('reads citation lists in several shapes, deduped, integers only', () => {
    expect(toCitationList([1, 2, 2])).toEqual([1, 2]);
    expect(toCitationList(['[1]', '3'])).toEqual([1, 3]);
    expect(toCitationList('1, 3')).toEqual([1, 3]);
    expect(toCitationList(2)).toEqual([2]);
    expect(toCitationList([1.5, 'x', null])).toEqual([]);
  });
});

describe('checkClaims citation rules', () => {
  it('keeps a supported claim that cites existing excerpts', () => {
    const warnings: string[] = [];
    const [claim] = checkClaims(
      [{ claim: 'Backprop uses the chain rule.', citations: [1], supported: true, reason: 'Stated in [1].' }],
      EXCERPTS,
      warnings
    );
    expect(claim).toEqual({ claim: 'Backprop uses the chain rule.', citations: [1], supported: true, reason: 'Stated in [1].' });
    expect(warnings).toEqual([]);
  });

  it('marks an uncited claim unsupported even if the model said supported', () => {
    const [claim] = checkClaims([{ claim: 'ReLU fixes everything.', citations: [], supported: true, reason: 'common knowledge' }], EXCERPTS, []);
    expect(claim.supported).toBe(false);
    expect(claim.reason).toMatch(/No citation/);
  });

  it('marks a claim citing a missing excerpt unsupported and warns', () => {
    const warnings: string[] = [];
    const [claim] = checkClaims([{ claim: 'Adam converges faster.', citations: [1, 7], supported: true, reason: 'ok' }], EXCERPTS, warnings);
    expect(claim.supported).toBe(false);
    expect(claim.reason).toMatch(/missing excerpt\(s\) \[7\]/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('[7]');
  });

  it('skips malformed entries but throws when claims is not an array', () => {
    expect(checkClaims([null, 'x', { claim: '' }, { claim: 'ok', citations: [2], supported: true }], EXCERPTS, [])).toHaveLength(1);
    expect(() => checkClaims({ claim: 'x' }, EXCERPTS, [])).toThrow(/claims array/);
  });
});

const supported = (claim: string, citations = [1]): ClaimCheck => ({ claim, citations, supported: true, reason: 'ok' });
const unsupported = (claim: string, citations = [2]): ClaimCheck => ({ claim, citations, supported: false, reason: 'no' });

/** Mocked model: returns `reply` (object → JSON) and records prompts. */
function mockComplete(reply: unknown) {
  const prompts: string[] = [];
  const complete = async (prompt: string) => {
    prompts.push(prompt);
    return typeof reply === 'string' ? reply : JSON.stringify(reply);
  };
  return { complete, prompts };
}

const INPUT = {
  question: 'Why do we multiply gradients in backprop?',
  answer: 'Backprop applies the chain rule [1]. Gradients flow from the loss to the inputs [2]. It was invented in 2015 [2].',
  excerpts: EXCERPTS,
};

describe('decideAction', () => {
  it('accepts at or above tau, revises below with some support, abstains with none', () => {
    expect(CRITIC_ACCEPT_THRESHOLD).toBe(0.8);
    const fourOfFive = [supported('a'), supported('b'), supported('c'), supported('d'), unsupported('e')];
    expect(decideAction(fourOfFive, false)).toEqual({ action: 'accept', supportedFraction: 0.8 });
    expect(decideAction([supported('a'), unsupported('b')], false)).toEqual({ action: 'revise', supportedFraction: 0.5 });
    expect(decideAction([unsupported('a')], false)).toEqual({ action: 'abstain', supportedFraction: 0 });
  });

  it('abstains on an integrity violation even when everything is supported', () => {
    expect(decideAction([supported('a')], true)).toEqual({ action: 'abstain', supportedFraction: 1 });
  });

  it('treats zero claims as fraction 1 (accept)', () => {
    expect(decideAction([], false)).toEqual({ action: 'accept', supportedFraction: 1 });
  });

  it('honours a custom tau', () => {
    expect(decideAction([supported('a'), unsupported('b')], false, 0.5).action).toBe('accept');
  });
});

describe('critiqueAnswer', () => {
  it('accepts a fully supported answer', async () => {
    const { complete, prompts } = mockComplete({
      claims: [
        { claim: 'Backprop applies the chain rule.', citations: [1], supported: true, reason: '[1] says so.' },
        { claim: 'Gradients flow from the loss to the inputs.', citations: [2], supported: true, reason: '[2] says so.' },
      ],
      integrity_violation: false,
      integrity_reason: null,
      revised_answer: null,
    });
    const verdict = await critiqueAnswer(INPUT, complete);
    expect(prompts).toHaveLength(1);
    expect(verdict.action).toBe('accept');
    expect(verdict.supportedFraction).toBe(1);
    expect(verdict.revisedAnswer).toBeNull();
    expect(verdict.warnings).toEqual([]);
  });

  it('revises when some claims are unsupported, using the model revision', async () => {
    const { complete } = mockComplete({
      claims: [
        { claim: 'Backprop applies the chain rule.', citations: [1], supported: true, reason: 'ok' },
        { claim: 'It was invented in 2015.', citations: [2], supported: false, reason: '[2] says nothing about dates.' },
      ],
      integrity_violation: false,
      integrity_reason: null,
      revised_answer: 'Backprop applies the chain rule [1].',
    });
    const verdict = await critiqueAnswer(INPUT, complete);
    expect(verdict.action).toBe('revise');
    expect(verdict.supportedFraction).toBe(0.5);
    expect(verdict.revisedAnswer).toBe('Backprop applies the chain rule [1].');
  });

  it('abstains when no claim is supported', async () => {
    const { complete } = mockComplete({
      claims: [{ claim: 'It was invented in 2015.', citations: [2], supported: false, reason: 'not stated' }],
      integrity_violation: false,
      integrity_reason: null,
      revised_answer: 'should be ignored',
    });
    const verdict = await critiqueAnswer(INPUT, complete);
    expect(verdict.action).toBe('abstain');
    expect(verdict.revisedAnswer).toBeNull();
  });

  it('makeCritic binds the model call', async () => {
    const { complete, prompts } = mockComplete({ claims: [], integrity_violation: false, integrity_reason: null, revised_answer: null });
    const critique = makeCritic(complete);
    const verdict = await critique(INPUT);
    expect(verdict.action).toBe('accept');
    expect(prompts[0]).toContain(INPUT.answer);
  });

  it('parseCriticOutput is usable on its own', () => {
    const verdict = parseCriticOutput(
      JSON.stringify({ claims: [supported('x')], integrity_violation: false, integrity_reason: null, revised_answer: null }),
      EXCERPTS
    );
    expect(verdict.action).toBe('accept');
  });
});

describe('critiqueAnswer edge cases (handoff checklist)', () => {
  const reply = (claims: unknown[], extra: Record<string, unknown> = {}) => ({
    claims,
    integrity_violation: false,
    integrity_reason: null,
    revised_answer: null,
    ...extra,
  });

  it('uncited claim: unsupported even if the model called it supported, and pulls the answer below tau', async () => {
    const { complete } = mockComplete(
      reply(
        [
          { claim: 'Backprop applies the chain rule.', citations: [1], supported: true, reason: 'ok' },
          { claim: 'Everyone uses ReLU.', citations: [], supported: true, reason: 'well known' },
        ],
        { revised_answer: 'Backprop applies the chain rule [1].' }
      )
    );
    const verdict = await critiqueAnswer(INPUT, complete);
    expect(verdict.claims[1].supported).toBe(false);
    expect(verdict.supportedFraction).toBe(0.5);
    expect(verdict.action).toBe('revise');
  });

  it('citation to a missing excerpt: unsupported plus a warning', async () => {
    const { complete } = mockComplete(reply([{ claim: 'Adam converges faster.', citations: [9], supported: true, reason: 'ok' }]));
    const verdict = await critiqueAnswer(INPUT, complete);
    expect(verdict.claims[0].supported).toBe(false);
    expect(verdict.action).toBe('abstain');
    expect(verdict.warnings.some((w) => w.includes('[9]'))).toBe(true);
  });

  it('integrity violation: abstains, warns with the reason, no revision', async () => {
    const { complete } = mockComplete(
      reply([{ claim: 'The answer to HW2 problem 3 is 0.25.', citations: [1], supported: true, reason: 'ok' }], {
        integrity_violation: true,
        integrity_reason: 'Full solution to a graded homework problem.',
        revised_answer: 'Here is a hint instead [1].',
      })
    );
    const verdict = await critiqueAnswer({ ...INPUT, question: 'Solve problem 3 of HW2' }, complete);
    expect(verdict.integrityViolation).toBe(true);
    expect(verdict.action).toBe('abstain');
    expect(verdict.revisedAnswer).toBeNull();
    expect(verdict.warnings).toContain('Integrity violation: Full solution to a graded homework problem.');
  });

  it('integrity flag given as a string is still honoured', async () => {
    const { complete } = mockComplete(reply([], { integrity_violation: 'true' }));
    expect((await critiqueAnswer(INPUT, complete)).action).toBe('abstain');
  });

  it.each([
    ['not JSON at all', 'Sure! The answer looks fine.'],
    ['truncated JSON', '{"claims": [{"claim": "x", '],
    ['claims is not an array', JSON.stringify({ claims: 'none', integrity_violation: false })],
    ['missing claims', JSON.stringify({ integrity_violation: false })],
    ['a JSON array instead of an object', '[1, 2]'],
    ['empty string', ''],
  ])('malformed output (%s): fails closed to accept with NaN and a warning', async (_label, output) => {
    const { complete } = mockComplete(output);
    const verdict = await critiqueAnswer(INPUT, complete);
    expect(verdict.action).toBe('accept');
    expect(verdict.revisedAnswer).toBeNull();
    expect(Number.isNaN(verdict.supportedFraction)).toBe(true);
    expect(verdict.claims).toEqual([]);
    expect(verdict.integrityViolation).toBe(false);
    expect(verdict.warnings).toHaveLength(1);
    expect(verdict.warnings[0]).toMatch(/could not be parsed/);
  });

  it('accepts JSON wrapped in json fences and surrounding prose', async () => {
    const body = JSON.stringify(reply([{ claim: 'Backprop applies the chain rule.', citations: [1], supported: true, reason: 'ok' }]));
    const fence = '`'.repeat(3);
    const { complete } = mockComplete(`Here is my check:\n${fence}json\n${body}\n${fence}\nDone.`);
    const verdict = await critiqueAnswer(INPUT, complete);
    expect(verdict.action).toBe('accept');
    expect(verdict.supportedFraction).toBe(1);
  });

  it.each(['', '   \n  '])('empty answer %j: abstains without calling the model', async (answer) => {
    const { complete, prompts } = mockComplete(reply([]));
    const verdict = await critiqueAnswer({ ...INPUT, answer }, complete);
    expect(prompts).toHaveLength(0);
    expect(verdict.action).toBe('abstain');
    expect(verdict.revisedAnswer).toBeNull();
    expect(verdict.warnings[0]).toMatch(/Empty answer/);
  });

  it('a model error propagates so the pipeline records a failed critic step', async () => {
    const failing = async (): Promise<string> => {
      throw new Error('429 quota');
    };
    await expect(critiqueAnswer(INPUT, failing)).rejects.toThrow('429 quota');
  });

  it('revision strips markers to missing excerpts and warns', async () => {
    const { complete } = mockComplete(
      reply(
        [
          { claim: 'Backprop applies the chain rule.', citations: [1], supported: true, reason: 'ok' },
          { claim: 'It was invented in 2015.', citations: [2], supported: false, reason: 'no' },
        ],
        { revised_answer: 'Backprop applies the chain rule [1] [8].' }
      )
    );
    const verdict = await critiqueAnswer(INPUT, complete);
    expect(verdict.revisedAnswer).toBe('Backprop applies the chain rule [1].');
    expect(verdict.warnings.some((w) => w.includes('[8]'))).toBe(true);
  });

  it('revision falls back to supported claims when the model gives none', async () => {
    const { complete } = mockComplete(
      reply([
        { claim: 'Backprop applies the chain rule.', citations: [1], supported: true, reason: 'ok' },
        { claim: 'Gradients flow backwards.', citations: [2, 1], supported: true, reason: 'ok' },
        { claim: 'It was invented in 2015.', citations: [2], supported: false, reason: 'no' },
      ])
    );
    const verdict = await critiqueAnswer(INPUT, complete, 0.9);
    expect(verdict.action).toBe('revise');
    expect(verdict.revisedAnswer).toBe('Backprop applies the chain rule [1]. Gradients flow backwards [2][1].');
    expect(verdict.warnings).toContain('Critic gave no usable revised answer; built one from the supported claims.');
  });

  it('invariant: revisedAnswer is non-null iff action is revise', async () => {
    const S = { claim: 'Backprop applies the chain rule.', citations: [1], supported: true, reason: 'ok' };
    const U = { claim: 'It was invented in 2015.', citations: [2], supported: false, reason: 'no' };
    const scenarios: unknown[] = [
      reply([S], { revised_answer: 'ignored on accept' }),
      reply([S, U], { revised_answer: 'Backprop applies the chain rule [1].' }),
      reply([S, U]),
      reply([U], { revised_answer: 'ignored on abstain' }),
      reply([S], { integrity_violation: true, revised_answer: 'ignored on integrity abstain' }),
      'garbage',
    ];
    const actions = new Set<string>();
    for (const scenario of scenarios) {
      const verdict = await critiqueAnswer(INPUT, mockComplete(scenario).complete);
      actions.add(verdict.action);
      expect(verdict.revisedAnswer !== null).toBe(verdict.action === 'revise');
      if (verdict.action === 'revise') expect(verdict.revisedAnswer?.length).toBeGreaterThan(0);
    }
    expect(actions).toEqual(new Set(['accept', 'revise', 'abstain']));
  });
});
