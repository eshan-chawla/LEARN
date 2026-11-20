import type { AskAiModel } from '@/lib/ask-ai/models';
import { createTutorDeps, makeComplete } from '@/lib/tutor/app-deps';
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

/**
 * Real dependencies for headless runs. Same factory as the app route (lib/tutor/app-deps.ts).
 * `critique` is optional because the Critic (J2) may not be merged yet; critic-on configs then
 * run without it and the runner records that.
 */
export function createEvalDeps(opts: { model: AskAiModel; classId: string; critique?: CritiqueFn }): TutorDeps {
  return createTutorDeps({ model: opts.model, critique: opts.critique });
}

export { makeComplete };
