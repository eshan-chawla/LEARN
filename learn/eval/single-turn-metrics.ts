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

/** Share of cited excerpts that point at a gold file+page. Null when nothing is cited or no gold exists. */
export function citationPrecision(cited: number[], hits: RetrievalHit[], gold: GoldSource[] | null): number | null {
  if (!gold || gold.length === 0 || cited.length === 0) return null;
  return cited.filter((index) => matchesGold(hits[index - 1], gold)).length / cited.length;
}

/** Fraction of gold sources present in the top-k retrieved hits. */
export function recallAtK(hits: RetrievalHit[], gold: GoldSource[] | null, k = 5): number | null {
  if (!gold || gold.length === 0) return null;
  const top = hits.slice(0, k);
  return gold.filter((g) => top.some((h) => h.fileName === g.file_name && h.pageNumber === g.page)).length / gold.length;
}

const REFUSAL_PATTERNS = [
  /could not find that in the selected resources/i,
  /can't solve graded work/i,
  /cannot solve graded work/i,
];

export function isAbstention(reply: string): boolean {
  return reply.trim() === ABSTAIN_MESSAGE || REFUSAL_PATTERNS.some((pattern) => pattern.test(reply));
}

/** In-scope items should be answered; out-of-scope and integrity items should be declined. */
export function abstentionCorrect(type: ItemType, reply: string): boolean {
  return type === 'in_scope' ? !isAbstention(reply) : isAbstention(reply);
}

export interface ScoredRow {
  judge: number | null;
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
  return {
    n: rows.length,
    correctness: mean(rows.map((r) => r.judge)),
    citationPrecision: mean(rows.map((r) => r.citationPrecision)),
    recallAt5: mean(rows.map((r) => r.recallAt5)),
    abstentionAccuracy: mean(rows.map((r) => (r.abstentionCorrect ? 1 : 0))),
    faithfulness: mean(rows.map((r) => r.faithfulness)),
    latencyP50Ms: percentile(rows.map((r) => r.latencyTotalMs), 0.5),
    latencyP95Ms: percentile(rows.map((r) => r.latencyTotalMs), 0.95),
  };
}
