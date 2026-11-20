import type { RetrievalHit } from '@/lib/retrieval/types';
import type { ConceptGraph } from '@/lib/tutor/concept-graph';
import { buildConditionedQuery, rerankByConcepts, summarizeStateForPrompt } from '@/lib/tutor/conditioning';
import { ABSTAIN_MESSAGE, type CitedExcerpt, type CriticVerdict, type CritiqueFn } from '@/lib/tutor/critic-types';
import { diagnoseTurn, type DiagnosisResult } from '@/lib/tutor/diagnoser';
import { applyTurn, createInitialState } from '@/lib/tutor/learner-state';
import {
  buildSummaryPrompt,
  clampToBudget,
  DEFAULT_MEMORY_CHAR_BUDGET,
  lastTutorMessage,
  rawHistoryBlock,
  type ChatTurn,
} from '@/lib/tutor/memory';
import { selectNextAction, type PolicyDecision, type TutorAction } from '@/lib/tutor/policy';
import { buildTutorPrompt, parseTutorReply, toCitedExcerpts } from '@/lib/tutor/prompts';
import type { LearnerState, TutorThresholds } from '@/lib/tutor/types';

export type { ChatTurn } from '@/lib/tutor/memory';

/**
 * One tutor turn, headless. The app route and the eval runners both call this, so the paper
 * measures the code path that ships. Ablation flags:
 *   rag     none | dense | hybrid          (A0 / A1 / A2)
 *   critic  on | off                       (A3)
 *   memory  none | raw | summary | structured   (M0 / M1 / M1b / M2)
 */
export type RagMode = 'none' | 'dense' | 'hybrid';
export type MemoryMode = 'none' | 'raw' | 'summary' | 'structured';

export interface TutorConfig {
  rag: RagMode;
  critic: boolean;
  memory: MemoryMode;
  retrievalLimit?: number;
  memoryCharBudget?: number;
  thresholds?: TutorThresholds;
}

export interface PendingProbe {
  conceptId: string;
  misconceptionId: string | null;
}

export interface TutorSession {
  state: LearnerState;
  history: ChatTurn[];
  summary: string | null;
  pendingProbe: PendingProbe | null;
}

export interface TutorDeps {
  complete: (prompt: string, options: { json: boolean }) => Promise<string>;
  retrieve: (request: { query: string; classId: string; mode: 'dense' | 'hybrid'; limit: number }) => Promise<RetrievalHit[]>;
  critique?: CritiqueFn;
}

export interface TutorStep {
  id: string;
  kind: 'diagnose' | 'policy' | 'retrieve' | 'generate' | 'critic' | 'memory';
  title: string;
  detail: string;
  ok: boolean;
}

export interface TutorTurnResult {
  reply: string;
  action: TutorAction | null;
  actionSource: 'policy' | 'llm';
  session: TutorSession;
  diagnosis: DiagnosisResult | null;
  decision: PolicyDecision | null;
  excerpts: CitedExcerpt[];
  critic: CriticVerdict | null;
  steps: TutorStep[];
  latencyMs: Record<string, number>;
  warnings: string[];
}

export const DEFAULT_RETRIEVAL_LIMIT = 6;

export function createSession(graph: ConceptGraph): TutorSession {
  return { state: createInitialState(graph), history: [], summary: null, pendingProbe: null };
}

/** The check question this turn's reply ends with, so the next answer can be graded against it. */
export function pendingProbeFor(decision: PolicyDecision): PendingProbe | null {
  const { primary, followUp } = decision;
  if (primary.type === 'probe_prerequisite') return { conceptId: primary.prerequisiteId, misconceptionId: null };
  if (primary.type === 'remediate_misconception') {
    return { conceptId: primary.conceptId, misconceptionId: primary.misconceptionId };
  }
  if (primary.type === 'formative_question') return { conceptId: primary.conceptId, misconceptionId: null };
  if (followUp?.type === 'formative_question') return { conceptId: followUp.conceptId, misconceptionId: null };
  return null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runTutorTurn(
  input: { classId: string; graph: ConceptGraph; session: TutorSession; studentMessage: string },
  config: TutorConfig,
  deps: TutorDeps
): Promise<TutorTurnResult> {
  const { classId, graph, session, studentMessage } = input;
  const budget = config.memoryCharBudget ?? DEFAULT_MEMORY_CHAR_BUDGET;
  const steps: TutorStep[] = [];
  const warnings: string[] = [];
  const latencyMs: Record<string, number> = {};
  const timed = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      latencyMs[stage] = Math.round(performance.now() - start);
    }
  };
  const structured = config.memory === 'structured';
  const previousTutorMessage = lastTutorMessage(session.history);

  // 1–3. Diagnose → update S_t → policy (structured memory only).
  let state = session.state;
  let diagnosis: DiagnosisResult | null = null;
  let decision: PolicyDecision | null = null;
  if (structured) {
    diagnosis = await timed('diagnose', () =>
      diagnoseTurn(
        graph,
        { previousTutorMessage, pendingProbe: session.pendingProbe, studentMessage },
        (prompt) => deps.complete(prompt, { json: true })
      ).catch(
        (error): DiagnosisResult => ({
          targetConceptId: null,
          turnKind: 'other',
          struggling: false,
          observations: [],
          warnings: [`Diagnoser call failed: ${errorText(error)}`],
        })
      )
    );
    warnings.push(...diagnosis.warnings);
    if (diagnosis.observations.length > 0) state = applyTurn(state, graph, diagnosis.observations);
    steps.push({
      id: 'diagnose',
      kind: 'diagnose',
      title: 'Diagnosed the student turn',
      detail: `target=${diagnosis.targetConceptId ?? 'none'}, kind=${diagnosis.turnKind}, struggling=${diagnosis.struggling}, ${diagnosis.observations.length} observation(s)`,
      ok: diagnosis.warnings.length === 0,
    });

    decision = selectNextAction({
      state,
      graph,
      targetConceptId: diagnosis.targetConceptId,
      turnKind: diagnosis.turnKind,
      struggling: diagnosis.struggling,
      thresholds: config.thresholds,
    });
    steps.push({ id: 'policy', kind: 'policy', title: `Chose ${decision.primary.type}`, detail: decision.rationale.join(' '), ok: true });
  }

  // 4. Retrieval (state-conditioned query and rerank in structured mode).
  let hits: RetrievalHit[] = [];
  if (config.rag !== 'none') {
    const conditioned = decision ? buildConditionedQuery(studentMessage, graph, state, decision.primary, config.thresholds) : null;
    try {
      const raw = await timed('retrieve', () =>
        deps.retrieve({
          query: conditioned?.query ?? studentMessage,
          classId,
          mode: config.rag as 'dense' | 'hybrid',
          limit: config.retrievalLimit ?? DEFAULT_RETRIEVAL_LIMIT,
        })
      );
      hits = conditioned ? rerankByConcepts(raw, conditioned.boostConceptIds) : raw;
      steps.push({
        id: 'retrieve',
        kind: 'retrieve',
        title: `Retrieved ${hits.length} excerpt(s)`,
        detail: `${config.rag} search${conditioned ? `, boosted concepts: ${conditioned.boostConceptIds.join(', ') || 'none'}` : ''}`,
        ok: true,
      });
    } catch (error) {
      warnings.push(`Retrieval failed: ${errorText(error)}`);
      steps.push({ id: 'retrieve', kind: 'retrieve', title: 'Retrieval failed', detail: errorText(error), ok: false });
    }
  }
  const excerpts = toCitedExcerpts(hits);

  // 5. Generate under the memory condition's (budget-matched) context.
  let memoryBlock = '';
  if (config.memory === 'raw') memoryBlock = rawHistoryBlock(session.history, budget);
  if (config.memory === 'summary') {
    memoryBlock = clampToBudget(
      `Summary of the conversation so far: ${session.summary ?? '(none yet)'}\nTutor's previous message: ${previousTutorMessage ?? '(none)'}`,
      budget
    );
  }
  if (structured) {
    memoryBlock = clampToBudget(
      `Learner model:\n${summarizeStateForPrompt(state, graph, diagnosis?.targetConceptId ?? null, config.thresholds)}\nTutor's previous message: ${previousTutorMessage ?? '(none)'}`,
      budget
    );
  }

  const prompt = buildTutorPrompt({ studentMessage, excerpts, memoryBlock, decision, graph, ragEnabled: config.rag !== 'none' });
  const generated = parseTutorReply(await timed('generate', () => deps.complete(prompt, { json: true })), graph);
  warnings.push(...generated.warnings);
  let reply = generated.reply;
  const action = decision ? decision.primary : generated.action;
  steps.push({
    id: 'generate',
    kind: 'generate',
    title: 'Generated the reply',
    detail: decision ? `Realized policy move ${decision.primary.type}` : `Model chose ${generated.action?.type ?? 'no valid move'}`,
    ok: generated.warnings.length === 0,
  });

  // 6. Grounding critic.
  let critic: CriticVerdict | null = null;
  if (config.critic && deps.critique && excerpts.length > 0) {
    try {
      const answer = reply;
      critic = await timed('critic', () => deps.critique!({ question: studentMessage, answer, excerpts }));
      if (critic.action === 'revise' && critic.revisedAnswer) reply = critic.revisedAnswer;
      if (critic.action === 'abstain') reply = ABSTAIN_MESSAGE;
      warnings.push(...critic.warnings);
      steps.push({
        id: 'critic',
        kind: 'critic',
        title: `Critic: ${critic.action}`,
        detail: `${critic.claims.filter((c) => c.supported).length}/${critic.claims.length} claims supported`,
        ok: true,
      });
    } catch (error) {
      warnings.push(`Critic failed: ${errorText(error)}`);
      steps.push({ id: 'critic', kind: 'critic', title: 'Critic failed', detail: errorText(error), ok: false });
    }
  }

  // 7. Memory update.
  let summary = session.summary;
  if (config.memory === 'summary') {
    try {
      const updated = await timed('summary', () =>
        deps.complete(buildSummaryPrompt(session.summary, studentMessage, reply, budget), { json: false })
      );
      summary = clampToBudget(updated.trim(), budget);
      steps.push({ id: 'memory', kind: 'memory', title: 'Updated conversation summary', detail: `${summary.length} chars`, ok: true });
    } catch (error) {
      warnings.push(`Summary update failed: ${errorText(error)}`);
      steps.push({ id: 'memory', kind: 'memory', title: 'Summary update failed', detail: errorText(error), ok: false });
    }
  }

  return {
    reply,
    action,
    actionSource: decision ? 'policy' : 'llm',
    session: {
      state,
      history: [...session.history, { role: 'student', content: studentMessage }, { role: 'tutor', content: reply }],
      summary,
      pendingProbe: decision ? pendingProbeFor(decision) : null,
    },
    diagnosis,
    decision,
    excerpts,
    critic,
    steps,
    latencyMs,
    warnings,
  };
}
