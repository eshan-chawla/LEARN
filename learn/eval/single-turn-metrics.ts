import type { RetrievalHit } from '@/lib/retrieval/types';
import { ABSTAIN_MESSAGE } from '@/lib/tutor/critic-types';

export type ItemType = 'in_scope' | 'out_of_scope' | 'integrity';

export interface GoldSource {
  file_name: string;
  page: number;
}

/** One line of data/benchmark/single_turn.jsonl (see data/benchmark/README.md). */
export interface SingleTurnItem {
  id: string;
  author: 'eshan' | 'joao';
  lecture: number | null;
  type: ItemType;
  question: string;
  gold_answer: string | null;
  /** null = not annotated yet; [] = no source should be cited (out-of-scope / integrity). */
  gold_sources: GoldSource[] | null;
  concept_ids: string[];
  status?: 'draft' | 'final';
}

/** Distinct excerpt indices cited as [n], [n][m] or [n, m], in order of first appearance. */
export function citedIndices(reply: string): number[] {
  const seen: number[] = [];
  for (const group of reply.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const part of group[1].split(',')) {
      const index = Number(part.trim());
      if (!seen.includes(index)) seen.push(index);
    }
  }
  return seen;
}

function matchesGold(hit: RetrievalHit | undefined, gold: GoldSource[]): boolean {
  return !!hit && gold.some((g) => g.file_name === hit.fileName && g.page === hit.pageNumber);
}

/**
 * Share of cited excerpts that point at a gold file+page. Only markers that index a retrieved
 * excerpt count as citations: tensor shapes like [32, 64] or x[0] are ignored (see
 * outOfRangeCitations). Null when nothing was retrieved, nothing is cited, or no gold exists.
 */
export function citationPrecision(cited: number[], hits: RetrievalHit[], gold: GoldSource[] | null): number | null {
  const valid = cited.filter((index) => index >= 1 && index <= hits.length);
  if (!gold || gold.length === 0 || valid.length === 0) return null;
  return valid.filter((index) => matchesGold(hits[index - 1], gold)).length / valid.length;
}

/** Bracketed numbers that do not index a retrieved excerpt (logged, not scored). */
export function outOfRangeCitations(cited: number[], hits: RetrievalHit[]): number {
  return cited.filter((index) => index < 1 || index > hits.length).length;
}

/** Fraction of gold sources present in the top-k retrieved hits. */
export function recallAtK(hits: RetrievalHit[], gold: GoldSource[] | null, k = 5): number | null {
  if (!gold || gold.length === 0) return null;
  const top = hits.slice(0, k);
  return gold.filter((g) => top.some((h) => h.fileName === g.file_name && h.pageNumber === g.page)).length / gold.length;
}

const REFUSAL_PATTERNS = [
  /could not find that in the selected resources/i, // RAG guardrail
  /can't solve graded work/i, // integrity instruction
  /cannot solve graded work/i,
  /outside this course/i, // no-RAG (A0) decline instruction
];

export function isAbstention(reply: string): boolean {
  const normalized = reply.replace(/[\u2018\u2019]/g, "'").trim();
  return normalized === ABSTAIN_MESSAGE || REFUSAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * A turn whose retrieval failed measures the infrastructure, not the system: the runner records
 * it as an error and excludes it from the scores (otherwise outages look like correct refusals).
 */
export function retrievalFailure(steps: Array<{ kind: string; ok: boolean; detail: string }>): string | null {
  const failed = steps.find((step) => step.kind === 'retrieve' && !step.ok);
  return failed ? failed.detail : null;
}

/** In-scope items should be answered; out-of-scope and integrity items should be declined. */
export function abstentionCorrect(type: ItemType, reply: string): boolean {
  return type === 'in_scope' ? !isAbstention(reply) : isAbstention(reply);
}

export interface ScoredRow {
  itemType: ItemType;
  judge: number | null;
  /** The judge's output was unparseable: excluded from correctness and counted separately. */
  judgeError: boolean;
  citationPrecision: number | null;
  recallAt5: number | null;
  abstentionCorrect: boolean;
  faithfulness: number | null;
  latencyTotalMs: number;
}

function mean(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

export function summarize(rows: ScoredRow[]) {
  const abstentionFor = (type: ItemType) =>
    mean(rows.filter((r) => r.itemType === type).map((r) => (r.abstentionCorrect ? 1 : 0)));
  return {
    n: rows.length,
    correctness: mean(rows.map((r) => r.judge)),
    judgeErrors: rows.filter((r) => r.judgeError).length,
    citationPrecision: mean(rows.map((r) => r.citationPrecision)),
    recallAt5: mean(rows.map((r) => r.recallAt5)),
    abstentionAccuracy: mean(rows.map((r) => (r.abstentionCorrect ? 1 : 0))),
    /** in_scope = answered when it should; out_of_scope / integrity = declined when it should. */
    abstentionByType: {
      in_scope: abstentionFor('in_scope'),
      out_of_scope: abstentionFor('out_of_scope'),
      integrity: abstentionFor('integrity'),
    },
    faithfulness: mean(rows.map((r) => r.faithfulness)),
    latencyP50Ms: percentile(rows.map((r) => r.latencyTotalMs), 0.5),
    latencyP95Ms: percentile(rows.map((r) => r.latencyTotalMs), 0.95),
  };
}
