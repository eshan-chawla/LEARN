/**
 * Multi-turn trajectory runner (J3): memory comparison M0 / M1 / M1b / M2.
 *
 *   npx tsx --env-file=.env.local eval/run-trajectories.ts --memory structured --rag hybrid \
 *       --sim scripted --seed 1 --limit 2 --model gemini-2.5-flash-lite [--critic] [--persona p01-chain-rule-gap]
 *
 * --memory takes none | raw | summary | structured, a comma list, or `all` (every condition in one
 * run file, convenient for smoke runs). Reads data/benchmark/trajectories/*.json and writes
 * results/trajectories/<runId>.jsonl (one row per tutor turn) and <runId>.summary.json.
 * Requires EVAL_CLASS_ID unless --rag none.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { callAskAiModel } from '@/lib/ask-ai/chat-provider';
import { DEFAULT_ASK_AI_MODEL, normalizeAskAiModel, type AskAiModel } from '@/lib/ask-ai/models';
import type { ConceptGraph } from '@/lib/tutor/concept-graph';
import type { CritiqueFn } from '@/lib/tutor/critic-types';
import { loadConceptGraph } from '@/lib/tutor/graph-io';
import { createSession, runTutorTurn, type MemoryMode, type RagMode, type TutorConfig, type TutorDeps } from '@/lib/tutor/pipeline';
import { createEvalDeps } from '@/eval/configs';
import { appendJsonl, newRunId, readJsonl, repoPath } from '@/eval/io';
import { assertValidPersonas, loadPersonas } from '@/eval/personas';
import { simulateStudentTurn, type CompleteText, type TutorView } from '@/eval/simulated-student';
import { retrievalFailure } from '@/eval/single-turn-metrics';
import { summarizeRows } from '@/eval/trajectory-metrics';
import type { Persona, SimMode, TrajectoryTurnLog } from '@/eval/trajectory-types';

/** Paper labels for the memory conditions. */
export const MEMORY_CONDITIONS: Record<MemoryMode, string> = {
  none: 'M0',
  raw: 'M1',
  summary: 'M1b',
  structured: 'M2',
};

/** Temperature of the LLM-simulated student (the tutor itself runs at temperature 0). */
export const SIM_TEMPERATURE = 0.7;

/**
 * Wire once lib/tutor/critic.ts (J2) is merged into this branch's base:
 *   makeCritic((p) => makeComplete(model)(p, { json: true }))
 * Until then critic=on runs without a critic and the summary records criticWired=false.
 */
const SYSTEM_CRITIC: CritiqueFn | undefined = undefined;

export interface RunTrajectoryOptions {
  runId: string;
  persona: Persona;
  graph: ConceptGraph;
  classId: string;
  config: TutorConfig;
  deps: TutorDeps;
  sim: SimMode;
  seed: number;
  model: string;
  /** Needed for sim=llm. */
  simComplete?: CompleteText;
  /** Called after every turn (the CLI appends the row to the JSONL file). */
  onTurn?: (row: TrajectoryTurnLog) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Plays one persona through runTutorTurn under one condition. A turn whose tutor call throws is
 * logged with `error` (excluded from scoring) and the dialogue continues, so one outage does not
 * discard the whole trajectory.
 */
export async function runTrajectory(options: RunTrajectoryOptions): Promise<TrajectoryTurnLog[]> {
  const { runId, persona, graph, classId, config, deps, sim, seed, model, simComplete, onTurn } = options;
  const condition = MEMORY_CONDITIONS[config.memory];
  let session = createSession(graph);
  let tutor: TutorView | null = null;
  const rows: TrajectoryTurnLog[] = [];

  for (let turnIndex = 0; turnIndex < persona.turns.length; turnIndex += 1) {
    const personaTurn = persona.turns[turnIndex];
    const studentMessage = await simulateStudentTurn({ persona, graph, turnIndex, history: session.history, tutor }, sim, simComplete);
    const base = {
      runId,
      personaId: persona.id,
      condition,
      memory: config.memory,
      sim,
      seed,
      model,
      turn: turnIndex,
      kind: personaTurn.kind,
      studentMessage,
      gold: personaTurn.gold,
      hidden: persona.hidden_state,
    };

    let row: TrajectoryTurnLog;
    const started = performance.now();
    try {
      const result = await runTutorTurn({ classId, graph, session, studentMessage }, config, deps);
      session = result.session;
      tutor = { message: result.reply, action: result.action };
      row = {
        ...base,
        reply: result.reply,
        action: result.action,
        actionSource: result.actionSource,
        state: result.session.state,
        retrievalFailed: retrievalFailure(result.steps) !== null,
        error: null,
        memoryChars: result.memoryChars,
        latencyMs: { ...result.latencyMs, total: Math.round(performance.now() - started) },
      };
    } catch (error) {
      // Keep the student's message in the history so the next turn still makes sense.
      session = { ...session, history: [...session.history, { role: 'student', content: studentMessage }] };
      tutor = null;
      row = {
        ...base,
        reply: '',
        action: null,
        actionSource: config.memory === 'structured' ? 'policy' : 'llm',
        state: session.state,
        retrievalFailed: false,
        error: errorText(error),
        memoryChars: 0,
        latencyMs: { total: Math.round(performance.now() - started) },
      };
    }
    rows.push(row);
    onTurn?.(row);
  }
  return rows;
}

/** Sampled (temperature 0.7) plain-text completion for the LLM-simulated student. */
export function makeSimComplete(model: AskAiModel): CompleteText {
  return async (prompt) => {
    const response = await callAskAiModel([{ role: 'user', parts: [{ text: prompt }] }], model, {
      json: false,
      temperature: SIM_TEMPERATURE,
      maxOutputTokens: 512,
    });
    return response.text;
  };
}

export function parseMemoryList(value: string): MemoryMode[] {
  const all = Object.keys(MEMORY_CONDITIONS) as MemoryMode[];
  if (value === 'all') return all;
  const modes = value.split(',').map((m) => m.trim()) as MemoryMode[];
  const bad = modes.filter((m) => !all.includes(m));
  if (bad.length) throw new Error(`Unknown --memory ${bad.join(', ')}; use ${all.join(' | ')} or all`);
  return modes;
}

async function main() {
  const { values } = parseArgs({
    options: {
      memory: { type: 'string', default: 'structured' },
      rag: { type: 'string', default: 'hybrid' },
      critic: { type: 'boolean', default: false },
      sim: { type: 'string', default: 'scripted' },
      seed: { type: 'string', default: '1' },
      limit: { type: 'string' },
      persona: { type: 'string', multiple: true },
      model: { type: 'string', default: DEFAULT_ASK_AI_MODEL },
      'run-id': { type: 'string' },
    },
  });

  const memories = parseMemoryList(values.memory!);
  const rag = values.rag as RagMode;
  if (!['none', 'dense', 'hybrid'].includes(rag)) throw new Error(`Unknown --rag ${values.rag}`);
  const sim = values.sim as SimMode;
  if (sim !== 'scripted' && sim !== 'llm') throw new Error(`Unknown --sim ${values.sim}`);
  const seed = Number(values.seed);
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
  const model = normalizeAskAiModel(values.model, DEFAULT_ASK_AI_MODEL);
  const classId = process.env.EVAL_CLASS_ID ?? '';
  if (rag !== 'none' && !classId) throw new Error('Set EVAL_CLASS_ID in .env.local (class with the lecture PDFs), or pass --rag none.');
  if (values.critic && !SYSTEM_CRITIC) console.warn('[warn] --critic set but no critic is wired yet (J2); running without it.');

  const graph = loadConceptGraph(repoPath('data', 'concept_graph', 'dl_course.json'));
  let personas = loadPersonas(repoPath('data', 'benchmark', 'trajectories'));
  assertValidPersonas(personas, graph);
  if (values.persona?.length) personas = personas.filter((p) => values.persona!.includes(p.id));
  if (values.limit) personas = personas.slice(0, Number(values.limit));
  if (personas.length === 0) throw new Error('No personas selected.');

  const runId = values['run-id'] ?? newRunId(`traj-${sim}-s${seed}`);
  const outPath = repoPath('results', 'trajectories', `${runId}.jsonl`);
  const deps = createEvalDeps({ model, classId, critique: values.critic ? SYSTEM_CRITIC : undefined });
  const simComplete = sim === 'llm' ? makeSimComplete(model) : undefined;

  for (const memory of memories) {
    const config: TutorConfig = { rag, critic: values.critic!, memory };
    for (const persona of personas) {
      const rows = await runTrajectory({
        runId, persona, graph, classId, config, deps, sim, seed, model, simComplete,
        onTurn: (row) => {
          appendJsonl(outPath, row);
          const action = row.action ? `${row.action.type}` : row.error ? `ERROR ${row.error}` : 'null';
          console.log(`${MEMORY_CONDITIONS[memory]} ${persona.id} t${row.turn} (${row.kind}): ${action}${row.retrievalFailed ? ' [retrieval failed]' : ''}`);
        },
      });
      console.log(`${MEMORY_CONDITIONS[memory]} ${persona.id}: ${rows.length} turns`);
    }
  }

  const summary = {
    runId,
    flags: { memory: memories, rag, critic: values.critic, sim, seed, model, personas: personas.map((p) => p.id) },
    // A critic=on file with criticWired=false did not run a critic: never report it as critic-on.
    criticWired: Boolean(values.critic && SYSTEM_CRITIC),
    conditions: summarizeRows(readJsonl<TrajectoryTurnLog>(outPath), seed),
  };
  writeFileSync(repoPath('results', 'trajectories', `${runId}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('eval/run-trajectories.ts')) {
  main().catch((error) => {
    console.error(errorText(error));
    process.exit(1);
  });
}
