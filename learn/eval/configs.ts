import { callAskAiModel } from '@/lib/ask-ai/chat-provider';
import type { AskAiModel } from '@/lib/ask-ai/models';
import { searchModalRetrieval } from '@/lib/retrieval/modal-client';
import type { CritiqueFn } from '@/lib/tutor/critic-types';
import type { TutorConfig, TutorDeps } from '@/lib/tutor/pipeline';

/** Single-turn ablation ladder (A4 = + structured state is evaluated on trajectories). */
export const ABLATIONS = {
  A0: { rag: 'none', critic: false, memory: 'none' },
  A1: { rag: 'dense', critic: false, memory: 'none' },
  A2: { rag: 'hybrid', critic: false, memory: 'none' },
  A3: { rag: 'hybrid', critic: true, memory: 'none' },
} satisfies Record<string, TutorConfig>;

export type AblationId = keyof typeof ABLATIONS;

/** A deterministic (temperature 0) text completion bound to one model. */
export function makeComplete(model: AskAiModel) {
  return async (prompt: string, options: { json: boolean } = { json: false }) => {
    const response = await callAskAiModel([{ role: 'user', parts: [{ text: prompt }] }], model, {
      json: options.json,
      temperature: 0,
      maxOutputTokens: 1200,
    });
    return response.text;
  };
}

/**
 * Real dependencies for headless runs (eval scripts). `critique` is injected because the Critic
 * (lib/tutor/critic.ts, J2) is optional: when absent, critic-on configs run without it and the
 * runner records that.
 */
export function createEvalDeps(opts: { model: AskAiModel; classId: string; critique?: CritiqueFn }): TutorDeps {
  return {
    complete: makeComplete(opts.model),
    retrieve: async (request) => (await searchModalRetrieval(request)).hits,
    critique: opts.critique,
  };
}
