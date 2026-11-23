/**
 * Reproducible bootstrap statistics for the evaluation tables (J3/J4).
 * A seeded PRNG makes every interval in the paper regenerate bit-for-bit from committed results.
 */

export type StatFn = (values: number[]) => number;

export interface ConfidenceInterval {
  estimate: number;
  lower: number;
  upper: number;
  n: number;
}

export interface PairedDifference extends ConfidenceInterval {
  /** Two-sided bootstrap p-value for H0: no difference (min 1/iters, max 1). */
  pValue: number;
}

export interface BootstrapOptions {
  statFn?: StatFn;
  iters?: number;
  alpha?: number;
  seed?: number;
}

export const DEFAULT_BOOTSTRAP_ITERS = 2000;
export const DEFAULT_ALPHA = 0.05;
export const DEFAULT_SEED = 1;

/** mulberry32: small, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Linear-interpolated quantile (type 7, as numpy's default). `sorted` must be ascending. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Drops null / undefined / NaN / ±Infinity (metrics return null when undefined). */
export function finiteValues(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

function resampleIndices(n: number, random: () => number): number[] {
  const indices = new Array<number>(n);
  for (let i = 0; i < n; i += 1) indices[i] = Math.floor(random() * n);
  return indices;
}

/** Percentile bootstrap CI of statFn(values). Null for an empty sample. */
export function bootstrapCI(
  values: number[],
  statFn: StatFn = mean,
  iters: number = DEFAULT_BOOTSTRAP_ITERS,
  alpha: number = DEFAULT_ALPHA,
  seed: number = DEFAULT_SEED
): ConfidenceInterval | null {
  if (values.length === 0) return null;
  const random = mulberry32(seed);
  const stats: number[] = [];
  for (let i = 0; i < iters; i += 1) {
    stats.push(statFn(resampleIndices(values.length, random).map((index) => values[index])));
  }
  stats.sort((a, b) => a - b);
  return {
    estimate: statFn(values),
    lower: quantile(stats, alpha / 2),
    upper: quantile(stats, 1 - alpha / 2),
    n: values.length,
  };
}

/**
 * Paired bootstrap of statFn(b) - statFn(a), resampling the same units (e.g. persona × seed)
 * for both conditions. Use b = M2 and a = M1 / M1b so a positive estimate means M2 is higher.
 */
export function pairedBootstrapDiff(a: number[], b: number[], options: BootstrapOptions = {}): PairedDifference | null {
  if (a.length !== b.length) throw new Error(`Paired samples differ in length: ${a.length} vs ${b.length}`);
  if (a.length === 0) return null;

  const { statFn = mean, iters = DEFAULT_BOOTSTRAP_ITERS, alpha = DEFAULT_ALPHA, seed = DEFAULT_SEED } = options;
  const random = mulberry32(seed);
  const diffs: number[] = [];
  for (let i = 0; i < iters; i += 1) {
    const indices = resampleIndices(a.length, random);
    diffs.push(statFn(indices.map((index) => b[index])) - statFn(indices.map((index) => a[index])));
  }
  diffs.sort((x, y) => x - y);

  const estimate = statFn(b) - statFn(a);
  const belowOrAtZero = diffs.filter((d) => d <= 0).length;
  const atOrAboveZero = diffs.filter((d) => d >= 0).length;
  const pValue = Math.min(1, Math.max(1 / iters, (2 * Math.min(belowOrAtZero, atOrAboveZero)) / iters));

  return {
    estimate,
    lower: quantile(diffs, alpha / 2),
    upper: quantile(diffs, 1 - alpha / 2),
    n: a.length,
    pValue,
  };
}
