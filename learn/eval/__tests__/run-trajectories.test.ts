import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RetrievalHit } from '@/lib/retrieval/types';
import { loadConceptGraph } from '@/lib/tutor/graph-io';
import type { MemoryMode, TutorDeps } from '@/lib/tutor/pipeline';
import { MEMORY_CONDITIONS, parseMemoryList, runTrajectory } from '@/eval/run-trajectories';
import { answerAbout } from '@/eval/simulated-student';
import { loadPersonas } from '@/eval/personas';
import { summarizeRows } from '@/eval/trajectory-metrics';

const REPO = join(__dirname, '..', '..', '..');
const graph = loadConceptGraph(join(REPO, 'data', 'concept_graph', 'dl_course.json'));
const persona = loadPersonas(join(REPO, 'data', 'benchmark', 'trajectories')).find((p) => p.id === 'p01-chain-rule-gap')!;

/** Stands in for the LLM: answers diagnoser, summary and generator prompts plausibly. */
function fakeComplete(opts: { throwOnGenerateCall?: number } = {}) {
  let generateCalls = 0;
  return async (prompt: string): Promise<string> => {
    if (prompt.includes('diagnostic module')) {
      const student = prompt.slice(prompt.lastIndexOf('Student message:'));
      const observations = [];
      const unknown = student.match(/never really understood ([A-Za-z ]+?),/);
      const known = student.match(/comfortable with ([A-Za-z ]+?);/) ?? student.match(/I think I know this one\. ([A-Za-z ]+?):/);
      for (const [match, correct] of [[unknown, false], [known, true]] as const) {
        const id = match && graph.conceptIds.find((c) => graph.getConcept(c).name === match[1]);
        if (id) observations.push({ concept_id: id, correct, misconception_id: null, confidence: 0.9 });
      }
      if (/gradients flow forward/.test(student)) observations.push({ concept_id: 'backprop', correct: false, misconception_id: 'backprop.M1', confidence: 0.9 });
      return JSON.stringify({ target_concept_id: 'backprop', turn_kind: observations.length ? 'attempt' : 'question', struggling: true, observations });
    }
    if (prompt.includes('running summary')) return 'Student struggles with backprop and the chain rule.';
    generateCalls += 1;
    if (generateCalls === opts.throwOnGenerateCall) throw new Error('503 model overloaded');
    return JSON.stringify({ reply: 'Let us look at the chain rule [1].', action: { type: 'remediate_prerequisite', concept_id: 'backprop', prerequisite_id: 'chain_rule' } });
  };
}

function deps(opts: { throwOnGenerateCall?: number; retrieve?: () => Promise<RetrievalHit[]> } = {}): TutorDeps {
  return { complete: fakeComplete(opts), retrieve: opts.retrieve ?? (async () => []) };
}

function run(memory: MemoryMode, overrides: Partial<Parameters<typeof runTrajectory>[0]> = {}) {
  return runTrajectory({
    runId: 'test',
    persona,
    graph,
    classId: 'class-1',
    config: { rag: 'none', critic: false, memory },
    deps: deps(),
    sim: 'scripted',
    seed: 1,
    model: 'fake',
    ...overrides,
  });
}

describe('runTrajectory', () => {
  it.each(Object.keys(MEMORY_CONDITIONS) as MemoryMode[])('memory=%s logs one valid row per persona turn', async (memory) => {
    const rows = await run(memory);
    expect(rows).toHaveLength(persona.turns.length);
    expect(rows.map((r) => r.turn)).toEqual(persona.turns.map((_, i) => i));
    expect(new Set(rows.map((r) => r.condition))).toEqual(new Set([MEMORY_CONDITIONS[memory]]));
    for (const row of rows) {
      expect(row.actionSource).toBe(memory === 'structured' ? 'policy' : 'llm');
      expect(row.memoryChars).toBeLessThanOrEqual(4000);
      expect(row.error).toBeNull();
      expect(row.hidden).toEqual(persona.hidden_state);
      expect(row.gold).toEqual(persona.turns[row.turn].gold);
    }
    expect(rows[0].studentMessage).toBe(persona.turns[0].script);
  });

  it('structured mode logs the learner state and the policy action', async () => {
    const rows = await run('structured');
    expect(rows.every((r) => r.state !== null && r.action !== null)).toBe(true);
    // Probed known prerequisites are graded correct, so they climb above the gap threshold (0.6).
    const observed = Object.values(rows.at(-1)!.state!.concepts).filter((c) => c.observations > 0);
    expect(observed.length).toBeGreaterThan(0);
    for (const concept of observed) {
      if (persona.hidden_state.known.includes(concept.conceptId)) expect(concept.mastery).toBeGreaterThan(0.6);
    }
  });

  it('the scripted student answers what the tutor just asked', async () => {
    const rows = await run('structured');
    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1].action;
      if (persona.turns[i].script || previous?.type !== 'probe_prerequisite') continue;
      expect(rows[i].studentMessage).toBe(answerAbout(persona, graph, previous.prerequisiteId));
    }
  });

  it('flags retrieval failures for exclusion', async () => {
    const rows = await run('none', {
      config: { rag: 'dense', critic: false, memory: 'none' },
      deps: deps({ retrieve: async () => Promise.reject(new Error('Modal timeout')) }),
    });
    expect(rows.every((r) => r.retrievalFailed)).toBe(true);
    expect(summarizeRows(rows)[0]).toMatchObject({ scoredTurns: 0, excludedTurns: persona.turns.length });
  });

  it('logs a tutor error, excludes it from scoring and keeps going', async () => {
    const rows = await run('none', { deps: deps({ throwOnGenerateCall: 2 }) });
    expect(rows).toHaveLength(persona.turns.length);
    expect(rows[1]).toMatchObject({ error: '503 model overloaded', action: null, reply: '' });
    expect(rows[2].error).toBeNull();
    const [summary] = summarizeRows(rows);
    expect(summary.excludedTurns).toBe(1);
  });

  it('streams rows through onTurn', async () => {
    const seen: number[] = [];
    await run('raw', { onTurn: (row) => seen.push(row.turn) });
    expect(seen).toEqual(persona.turns.map((_, i) => i));
  });

  it('llm sim mode uses the injected completion for respond turns only', async () => {
    const prompts: string[] = [];
    const rows = await run('none', {
      sim: 'llm',
      simComplete: async (prompt) => {
        prompts.push(prompt);
        return 'I guess you multiply the derivatives?';
      },
    });
    const unscripted = persona.turns.filter((t) => !t.script).length;
    expect(prompts).toHaveLength(unscripted);
    expect(rows.filter((r) => r.studentMessage === 'I guess you multiply the derivatives?')).toHaveLength(unscripted);
  });
});

describe('run summary', () => {
  it('summarizes the four conditions of a smoke-sized run', async () => {
    const rows = (await Promise.all((Object.keys(MEMORY_CONDITIONS) as MemoryMode[]).map((m) => run(m)))).flat();
    const summaries = summarizeRows(rows);
    expect(summaries.map((s) => s.condition)).toEqual(['M0', 'M1', 'M1b', 'M2']);
    for (const s of summaries) {
      expect(s.trajectories).toBe(1);
      expect(s.nextActionAccuracy).not.toBeNull();
      expect(s.maxMemoryChars).toBeLessThanOrEqual(4000);
    }
    expect(summaries.find((s) => s.condition === 'M2')!.brier).not.toBeNull();
    expect(summaries.find((s) => s.condition === 'M0')!.brier).toBeNull();
  });
});

describe('parseMemoryList', () => {
  it('accepts one mode, a list, or all', () => {
    expect(parseMemoryList('structured')).toEqual(['structured']);
    expect(parseMemoryList('none, raw')).toEqual(['none', 'raw']);
    expect(parseMemoryList('all')).toEqual(['none', 'raw', 'summary', 'structured']);
    expect(() => parseMemoryList('episodic')).toThrow(/Unknown --memory episodic/);
  });
});
