import type { CitedExcerpt, ClaimCheck } from '@/lib/tutor/critic-types';

/**
 * Grounding & integrity Critic (J2).
 *
 * The LLM splits the tutor's answer into atomic claims, records which [n] excerpts each claim
 * cites, and judges support using ONLY those cited excerpts. Deterministic rules here then
 * override the model where the contract is mechanical:
 *   - a claim with no citation is unsupported;
 *   - a citation to an excerpt index that does not exist makes the claim unsupported (+ warning).
 * The LLM call is injected (`complete`) like the Diagnoser, so this stays provider-agnostic.
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
