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
  outOfRangeCitations,
  recallAtK,
  retrievalFailure,
  summarize,
  type ScoredRow,
  type SingleTurnItem,
} from '@/eval/single-turn-metrics';

/** Wire these once lib/tutor/critic.ts (J2) is merged:
 *  - SYSTEM_CRITIC: the critic inside the system under test (A3), on the system model:
 *      makeCritic((p) => makeComplete(model)(p, { json: true }))
 *  - EVALUATOR_CRITIC: faithfulness measurement for every config, on the *judge* model, so A3
 *    is not graded by the same critic that already revised its answers:
 *      makeCritic((p) => makeComplete(judgeModel)(p, { json: true })) */
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
  let infrastructureFailures = 0;
  let warningCount = 0;

  for (const item of items) {
    let hits: RetrievalHit[] = [];
    const base = createEvalDeps({ model, classId, critique: SYSTEM_CRITIC });
    const deps = { ...base, retrieve: async (request: Parameters<typeof base.retrieve>[0]) => (hits = await base.retrieve(request)) };
    const started = performance.now();
    try {
      const result = await runTutorTurn({ classId, graph, session: createSession(graph), studentMessage: item.question }, config, deps);
      const latencyTotalMs = Math.round(performance.now() - started);
      // An outage would otherwise score as a correct refusal (out-of-scope) or a wrong answer.
      const failure = retrievalFailure(result.steps);
      if (failure) {
        infrastructureFailures += 1;
        appendJsonl(outPath, { runId, itemId: item.id, config: configId, model, error: `retrieval failed: ${failure}`, infrastructure: true });
        console.error(`${item.id}: RETRIEVAL FAILED (excluded) ${failure}`);
        continue;
      }
      warningCount += result.warnings.length;
      const cited = citedIndices(result.reply);
      const verdict =
        item.type === 'in_scope' && item.gold_answer
          ? await judgeCorrectness({ question: item.question, goldAnswer: item.gold_answer, answer: result.reply }, (p) => judge(p, { json: true }))
          : null;
      const evaluation =
        EVALUATOR_CRITIC && result.excerpts.length > 0
          ? await EVALUATOR_CRITIC({ question: item.question, answer: result.reply, excerpts: result.excerpts })
          : null;
      const row: ScoredRow = {
        itemType: item.type,
        judge: verdict?.correct ?? null,
        judgeError: verdict !== null && verdict.correct === null,
        citationPrecision: citationPrecision(cited, hits, item.gold_sources),
        recallAt5: recallAtK(hits, item.gold_sources, 5),
        abstentionCorrect: abstentionCorrect(item.type, result.reply),
        faithfulness: evaluation?.supportedFraction ?? null,
        latencyTotalMs,
      };
      scored.push(row);
      appendJsonl(outPath, {
        runId, itemId: item.id, config: configId, model, ...row,
        judgeReason: verdict?.reason ?? null, outOfRangeCitations: outOfRangeCitations(cited, hits),
        memoryChars: result.memoryChars, reply: result.reply, action: result.action,
        retrieved: hits.map((h) => ({ fileName: h.fileName, page: h.pageNumber, score: h.score, conceptIds: h.conceptIds ?? [] })),
        critic: result.critic, latencyMs: result.latencyMs, warnings: result.warnings,
      });
      console.log(`${item.id}: judge=${row.judge ?? '-'} abst=${row.abstentionCorrect} ${latencyTotalMs}ms`);
    } catch (error) {
      appendJsonl(outPath, { runId, itemId: item.id, config: configId, model, error: error instanceof Error ? error.message : String(error) });
      console.error(`${item.id}: ERROR ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const summary = {
    runId, config: configId, configFlags: config, model, judgeModel, items: items.length,
    failed: items.length - scored.length, infrastructureFailures, warnings: warningCount,
    // An A3 file with criticWired=false is really A2: never report it as A3.
    criticWired: Boolean(SYSTEM_CRITIC), evaluatorCriticWired: Boolean(EVALUATOR_CRITIC),
    ...summarize(scored),
  };
  writeFileSync(repoPath('results', 'single_turn', `${runId}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
