/**
 * Contract between the tutor pipeline (Eshan) and the grounding & integrity Critic (Joao,
 * `lib/tutor/critic.ts`). Change only by PR reviewed by both.
 */

/** One retrieved excerpt as shown to the generator; `index` matches the [n] marker in the answer. */
export interface CitedExcerpt {
  index: number;
  text: string;
  sourceId: string;
  pageNumber: number | null;
  startSeconds: number | null;
}

export interface ClaimCheck {
  claim: string;
  citations: number[];
  supported: boolean;
  reason: string;
}

export interface CriticVerdict {
  claims: ClaimCheck[];
  /** supported / total claims; 1 when there are no claims; NaN when the critic output was unusable. */
  supportedFraction: number;
  /** e.g. the answer fully solves a graded assignment or exam question. */
  integrityViolation: boolean;
  action: 'accept' | 'revise' | 'abstain';
  /** Non-null iff action === 'revise'. */
  revisedAnswer: string | null;
  warnings: string[];
}

/** A critic with its LLM call already bound (see `makeCritic` in critic.ts). */
export type CritiqueFn = (input: { question: string; answer: string; excerpts: CitedExcerpt[] }) => Promise<CriticVerdict>;

/** Reply shown when the critic abstains. */
export const ABSTAIN_MESSAGE =
  "I can't give a well-supported answer to that from the course materials. Try rephrasing, or ask about a specific lecture topic.";
