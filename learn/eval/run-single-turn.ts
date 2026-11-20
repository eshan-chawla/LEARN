/**
 * Single-turn ablation runner (A0–A3).
 *   npx tsx --env-file=.env.local eval/run-single-turn.ts --config A1 [--limit 10]
 *        [--model gemini-2.5-flash-lite] [--judge-model gemini-2.5-flash]
 * Reads data/benchmark/single_turn.jsonl, writes results/single_turn/<runId>.jsonl + .summary.json.
 * Requires EVAL_CLASS_ID (the class holding the uploaded lecture PDFs) unless --config A0.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { normalizeAskAiModel, DEFAULT_ASK_AI_MODEL } from '@/lib/ask-ai/models';
import type { RetrievalHit } from '@/lib/retrieval/types';
import type { CritiqueFn } from '@/lib/tutor/critic-types';
import { loadConceptGraph } from '@/lib/tutor/graph-io';
import { createSession, runTutorTurn } from '@/lib/tutor/pipeline';
import { ABLATIONS, createEvalDeps, makeComplete, type AblationId } from '@/eval/configs';
import { appendJsonl, newRunId, readJsonl, repoPath } from '@/eval/io';
import { judgeCorrectness } from '@/eval/judge';
import {
  abstentionCorrect,
  citationPrecision,
  citedIndices,
  recallAtK,
  summarize,
  type ScoredRow,
  type SingleTurnItem,
} from '@/eval/single-turn-metrics';

/** Critic used by the system under test in A3, and as the faithfulness evaluator for every config.
 *  Set both once lib/tutor/critic.ts (J2) is merged:  makeCritic((p) => makeComplete(model)(p, { json: true })) */
const SYSTEM_CRITIC: CritiqueFn | undefined = undefined;
const EVALUATOR_CRITIC: CritiqueFn | undefined = undefined;

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', default: 'A1' },
      limit: { type: 'string' },
      model: { type: 'string', default: DEFAULT_ASK_AI_MODEL },
      'judge-model': { type: 'string', default: 'gemini-2.5-flash' },
    },
  });

  const configId = values.config as AblationId;
  const config = ABLATIONS[configId];
  if (!config) throw new Error(`Unknown --config ${values.config}; use one of ${Object.keys(ABLATIONS).join(', ')}`);
  const model = normalizeAskAiModel(values.model, DEFAULT_ASK_AI_MODEL);
  const judgeModel = normalizeAskAiModel(values['judge-model'], 'gemini-2.5-flash');
  const classId = process.env.EVAL_CLASS_ID ?? '';
  if (config.rag !== 'none' && !classId) throw new Error('Set EVAL_CLASS_ID in .env.local (class with the lecture PDFs).');
  if (config.critic && !SYSTEM_CRITIC) console.warn(`[warn] ${configId} has critic=true but no critic is wired yet (J2); running without it.`);

  const graph = loadConceptGraph(repoPath('data', 'concept_graph', 'dl_course.json'));
  const allItems = readJsonl<SingleTurnItem>(repoPath('data', 'benchmark', 'single_turn.jsonl'));
  const items = values.limit ? allItems.slice(0, Number(values.limit)) : allItems;
  const runId = newRunId(configId);
  const outPath = repoPath('results', 'single_turn', `${runId}.jsonl`);
  const judge = makeComplete(judgeModel);
  const scored: ScoredRow[] = [];

  for (const item of items) {
    let hits: RetrievalHit[] = [];
    const base = createEvalDeps({ model, classId, critique: SYSTEM_CRITIC });
    const deps = { ...base, retrieve: async (request: Parameters<typeof base.retrieve>[0]) => (hits = await base.retrieve(request)) };
    const started = performance.now();
    try {
      const result = await runTutorTurn({ classId, graph, session: createSession(graph), studentMessage: item.question }, config, deps);
      const latencyTotalMs = Math.round(performance.now() - started);
      const verdict =
        item.type === 'in_scope' && item.gold_answer
          ? await judgeCorrectness({ question: item.question, goldAnswer: item.gold_answer, answer: result.reply }, (p) => judge(p, { json: true }))
          : null;
      const evaluation =
        EVALUATOR_CRITIC && result.excerpts.length > 0
          ? await EVALUATOR_CRITIC({ question: item.question, answer: result.reply, excerpts: result.excerpts })
          : null;
      const row: ScoredRow = {
        judge: verdict?.correct ?? null,
        citationPrecision: citationPrecision(citedIndices(result.reply), hits, item.gold_sources),
        recallAt5: recallAtK(hits, item.gold_sources, 5),
        abstentionCorrect: abstentionCorrect(item.type, result.reply),
        faithfulness: evaluation?.supportedFraction ?? null,
        latencyTotalMs,
      };
      scored.push(row);
      appendJsonl(outPath, {
        runId, itemId: item.id, itemType: item.type, config: configId, model, ...row,
        judgeReason: verdict?.reason ?? null, reply: result.reply, action: result.action,
        retrieved: hits.map((h) => ({ fileName: h.fileName, page: h.pageNumber, score: h.score, conceptIds: h.conceptIds ?? [] })),
        critic: result.critic, latencyMs: result.latencyMs, warnings: result.warnings,
      });
      console.log(`${item.id}: judge=${row.judge ?? '-'} abst=${row.abstentionCorrect} ${latencyTotalMs}ms`);
    } catch (error) {
      appendJsonl(outPath, { runId, itemId: item.id, config: configId, model, error: error instanceof Error ? error.message : String(error) });
      console.error(`${item.id}: ERROR ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const summary = { runId, config: configId, configFlags: config, model, judgeModel, items: items.length, failed: items.length - scored.length, ...summarize(scored) };
  writeFileSync(repoPath('results', 'single_turn', `${runId}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
