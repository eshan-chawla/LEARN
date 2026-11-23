import type { CitedExcerpt, ClaimCheck, CriticVerdict, CritiqueFn } from '@/lib/tutor/critic-types';

/**
 * Grounding & integrity Critic (J2).
 *
 * The LLM splits the tutor's answer into atomic claims, records which [n] excerpts each claim
 * cites, and judges support using ONLY those cited excerpts. Deterministic rules here then
 * override the model where the contract is mechanical:
 *   - a claim with no citation is unsupported;
 *   - a citation to an excerpt index that does not exist makes the claim unsupported (+ warning).
 * The LLM call is injected (`complete`) like the Diagnoser, so this stays provider-agnostic.
 *
 * Decision (see decideAction):
 *   integrity violation, or zero supported claims          -> abstain
 *   supportedFraction >= τ                                  -> accept
 *   otherwise (at least one supported claim)                -> revise
 */

/** τ: minimum supported-claim fraction for `accept`. */
export const CRITIC_ACCEPT_THRESHOLD = 0.8;

export const CRITIC_JSON_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          citations: { type: 'array', items: { type: 'integer' } },
          supported: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['claim', 'citations', 'supported', 'reason'],
      },
    },
    integrity_violation: { type: 'boolean' },
    integrity_reason: { type: ['string', 'null'] },
    revised_answer: { type: ['string', 'null'] },
  },
  required: ['claims', 'integrity_violation', 'integrity_reason', 'revised_answer'],
} as const;

export interface CriticInput {
  question: string;
  answer: string;
  excerpts: CitedExcerpt[];
}

function describeExcerptSource(excerpt: CitedExcerpt): string {
  if (excerpt.pageNumber !== null) return ` (page ${excerpt.pageNumber})`;
  if (excerpt.startSeconds !== null) return ` (at ${Math.round(excerpt.startSeconds)}s)`;
  return '';
}

export function buildCriticPrompt(input: CriticInput): string {
  const excerpts = input.excerpts.length
    ? input.excerpts.map((e) => `[${e.index}]${describeExcerptSource(e)} ${e.text}`).join('\n\n')
    : '(no excerpts)';

  return [
    'You are the grounding and academic-integrity checker of a course tutor. Output JSON only.',
    '',
    'Task 1: grounding.',
    '- Split the ANSWER into atomic factual claims about the course subject. Skip greetings, questions back to the student, and encouragement.',
    '- For each claim, list the excerpt numbers it cites with [n] markers in the answer ("citations"). A claim cites nothing if no [n] marker is attached to it.',
    '- supported=true only if the cited excerpts, read on their own, state or directly imply the claim. Do not use other excerpts, and do not use your own knowledge.',
    '- A claim with no citation is unsupported. Give a one-sentence "reason" for every verdict.',
    '',
    'Task 2: academic integrity.',
    '- integrity_violation=true only if the QUESTION asks for a graded assignment, homework, quiz or exam problem (e.g. "solve problem 3 of HW2") AND the ANSWER gives a complete solution or final answer to it.',
    '- Explaining concepts, giving hints, or refusing is NOT a violation.',
    '',
    'Task 3: revision.',
    '- If some claims are unsupported but at least one is supported, write revised_answer: the answer with unsupported claims removed or softened, keeping every remaining [n] marker valid. Otherwise revised_answer=null.',
    '',
    'Excerpts:',
    excerpts,
    '',
    `QUESTION: ${input.question}`,
    '',
    `ANSWER: ${input.answer}`,
    '',
    'JSON fields: claims[{claim, citations, supported, reason}], integrity_violation, integrity_reason, revised_answer.',
  ].join('\n');
}

export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Critic output contains no JSON object');
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Accepts true/false, "true"/"yes", 1/0. Anything else → false (unsupported is the safe side). */
export function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return ['true', 'yes', '1'].includes(value.trim().toLowerCase());
  return false;
}

/** Accepts [1, 2], ["1", "[2]"], "1, 3", or a single number. Non-integers are dropped. */
export function toCitationList(value: unknown): number[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : [value];
  const result: number[] = [];
  for (const item of items) {
    const numeric =
      typeof item === 'number' ? item : typeof item === 'string' ? Number(item.replace(/[[\]\s]/g, '')) : NaN;
    if (Number.isInteger(numeric) && !result.includes(numeric)) result.push(numeric);
  }
  return result;
}

/**
 * Normalises the model's claim list and applies the mechanical citation rules.
 * Throws if `claims` is not an array (malformed output); skips individual malformed entries.
 */
export function checkClaims(rawClaims: unknown, excerpts: CitedExcerpt[], warnings: string[]): ClaimCheck[] {
  if (!Array.isArray(rawClaims)) throw new Error('Critic output has no claims array');

  const validIndices = new Set(excerpts.map((e) => e.index));
  const claims: ClaimCheck[] = [];

  for (const item of rawClaims) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const claim = typeof entry.claim === 'string' ? entry.claim.trim() : '';
    if (!claim) continue;

    const citations = toCitationList(entry.citations);
    let supported = toBool(entry.supported);
    let reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';

    const missing = citations.filter((index) => !validIndices.has(index));
    if (citations.length === 0) {
      if (supported) reason = `No citation, so unsupported (model said supported: ${reason || 'no reason'})`;
      supported = false;
      reason ||= 'No citation.';
    } else if (missing.length > 0) {
      warnings.push(`Claim cites missing excerpt(s) ${missing.map((i) => `[${i}]`).join(', ')}: "${claim}"`);
      supported = false;
      reason = `Cites missing excerpt(s) ${missing.map((i) => `[${i}]`).join(', ')}.${reason ? ` ${reason}` : ''}`;
    }

    claims.push({ claim, citations, supported, reason });
  }

  return claims;
}

export type CriticAction = CriticVerdict['action'];

export function decideAction(
  claims: ClaimCheck[],
  integrityViolation: boolean,
  tau: number = CRITIC_ACCEPT_THRESHOLD
): { action: CriticAction; supportedFraction: number } {
  const supportedCount = claims.filter((c) => c.supported).length;
  // Contract: 1 when there are no claims (nothing factual to get wrong, e.g. a clarifying question).
  const supportedFraction = claims.length === 0 ? 1 : supportedCount / claims.length;

  if (integrityViolation) return { action: 'abstain', supportedFraction };
  if (supportedFraction >= tau) return { action: 'accept', supportedFraction };
  if (supportedCount > 0) return { action: 'revise', supportedFraction };
  return { action: 'abstain', supportedFraction };
}

/** Removes [n] markers that point at no excerpt, so a revision never ships a dangling citation. */
export function stripInvalidMarkers(text: string, excerpts: CitedExcerpt[], warnings: string[]): string {
  const valid = new Set(excerpts.map((e) => e.index));
  const removed = new Set<number>();
  const cleaned = text.replace(/\s?\[(\d+)\]/g, (marker, digits: string) => {
    const index = Number(digits);
    if (valid.has(index)) return marker;
    removed.add(index);
    return '';
  });
  if (removed.size > 0) {
    warnings.push(`Removed invalid citation marker(s) ${[...removed].map((i) => `[${i}]`).join(', ')} from the revision.`);
  }
  return cleaned.trim();
}

/** Fallback revision: the supported claims only, each with its own markers. */
export function reviseFromSupportedClaims(claims: ClaimCheck[]): string {
  return claims
    .filter((c) => c.supported)
    .map((c) => {
      const markers = c.citations.map((i) => `[${i}]`).join('');
      const sentence = /[.!?]$/.test(c.claim) ? c.claim.slice(0, -1) : c.claim;
      return `${sentence} ${markers}.`;
    })
    .join(' ');
}

/**
 * FAIL-CLOSED POLICY (deliberate; discussed in the paper's failure analysis):
 * if the critic's own output is unusable we ACCEPT the original answer, with
 * supportedFraction = NaN and a warning. The critic is a safety net, so its malfunction must
 * never block the student. NaN keeps these turns visible in eval logs and out of faithfulness
 * means instead of silently counting them as fully supported.
 */
export function failClosedVerdict(reason: string): CriticVerdict {
  return {
    claims: [],
    supportedFraction: Number.NaN,
    integrityViolation: false,
    action: 'accept',
    revisedAnswer: null,
    warnings: [`Critic output could not be parsed; original answer kept: ${reason}`],
  };
}

export function parseCriticOutput(
  text: string,
  excerpts: CitedExcerpt[],
  tau: number = CRITIC_ACCEPT_THRESHOLD
): CriticVerdict {
  let raw: Record<string, unknown>;
  const warnings: string[] = [];
  let claims: ClaimCheck[];
  try {
    const parsed = extractJsonObject(text ?? '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Critic output is not a JSON object');
    raw = parsed as Record<string, unknown>;
    claims = checkClaims(raw.claims, excerpts, warnings);
  } catch (error) {
    return failClosedVerdict(error instanceof Error ? error.message : String(error));
  }

  const integrityViolation = toBool(raw.integrity_violation);
  if (integrityViolation) {
    const reason = typeof raw.integrity_reason === 'string' && raw.integrity_reason.trim() ? raw.integrity_reason.trim() : 'no reason given';
    warnings.push(`Integrity violation: ${reason}`);
  }

  const { action, supportedFraction } = decideAction(claims, integrityViolation, tau);

  let revisedAnswer: string | null = null;
  if (action === 'revise') {
    const modelRevision = typeof raw.revised_answer === 'string' ? stripInvalidMarkers(raw.revised_answer, excerpts, warnings) : '';
    if (modelRevision) {
      revisedAnswer = modelRevision;
    } else {
      warnings.push('Critic gave no usable revised answer; built one from the supported claims.');
      revisedAnswer = reviseFromSupportedClaims(claims);
    }
  }

  return { claims, supportedFraction, integrityViolation, action, revisedAnswer, warnings };
}

export async function critiqueAnswer(
  input: CriticInput,
  complete: (prompt: string) => Promise<string>,
  tau: number = CRITIC_ACCEPT_THRESHOLD
): Promise<CriticVerdict> {
  if (!input.answer.trim()) {
    // Nothing to ground or show: abstain without spending a model call.
    return {
      claims: [],
      supportedFraction: 1,
      integrityViolation: false,
      action: 'abstain',
      revisedAnswer: null,
      warnings: ['Empty answer; critic abstained without calling the model.'],
    };
  }

  // A thrown `complete` (network, quota) propagates: the pipeline records a failed critic step.
  const output = await complete(buildCriticPrompt(input));
  return parseCriticOutput(output, input.excerpts, tau);
}

/** Binds the model call; this is what the pipeline's `critique` dependency expects. */
export function makeCritic(
  complete: (prompt: string) => Promise<string>,
  tau: number = CRITIC_ACCEPT_THRESHOLD
): CritiqueFn {
  return (input) => critiqueAnswer(input, complete, tau);
}
