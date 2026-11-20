import { callAskAiModel } from '@/lib/ask-ai/chat-provider';
import type { AskAiModel } from '@/lib/ask-ai/models';
import { searchModalRetrieval } from '@/lib/retrieval/modal-client';
import type { CritiqueFn } from '@/lib/tutor/critic-types';
import type { TutorDeps } from '@/lib/tutor/pipeline';

/** A deterministic (temperature 0) single-prompt completion bound to one model. */
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
 * Production dependencies for runTutorTurn: shared by /api/tutor and the eval runners so both
 * exercise the same model and retrieval calls. `critique` stays undefined until the Critic
 * (lib/tutor/critic.ts, J2) is merged; then pass makeCritic(...) here.
 */
export function createTutorDeps(opts: { model: AskAiModel; critique?: CritiqueFn }): TutorDeps {
  return {
    complete: makeComplete(opts.model),
    retrieve: async (request) => (await searchModalRetrieval(request)).hits,
    critique: opts.critique,
  };
}
