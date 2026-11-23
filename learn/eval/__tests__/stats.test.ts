import { describe, expect, it } from 'vitest';
import { bootstrapCI, finiteValues, mean, mulberry32, pairedBootstrapDiff, quantile } from '@/eval/stats';

describe('mulberry32', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = Array.from({ length: 1000 }, a);
    expect(seqA.slice(0, 5)).toEqual(Array.from({ length: 5 }, b));
    expect(seqA[0]).not.toBe(c());
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mean(seqA)).toBeGreaterThan(0.45);
    expect(mean(seqA)).toBeLessThan(0.55);
  });
});

describe('helpers', () => {
  it('quantile interpolates like numpy', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([10], 0.3)).toBe(10);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });

  it('finiteValues drops null, NaN and infinities', () => {
    expect(finiteValues([1, null, Number.NaN, undefined, 2, Number.POSITIVE_INFINITY])).toEqual([1, 2]);
  });
});

describe('bootstrapCI', () => {
  it('is reproducible for a fixed seed and changes with the seed', () => {
    const values = [0.2, 0.4, 0.5, 0.9, 1, 0.3, 0.7];
    expect(bootstrapCI(values, mean, 500, 0.05, 7)).toEqual(bootstrapCI(values, mean, 500, 0.05, 7));
    expect(bootstrapCI(values, mean, 500, 0.05, 7)).not.toEqual(bootstrapCI(values, mean, 500, 0.05, 8));
  });

  it('brackets the sample mean and has the right estimate and n', () => {
    const values = Array.from({ length: 40 }, (_, i) => (i % 4) / 3);
    const ci = bootstrapCI(values)!;
    expect(ci.estimate).toBeCloseTo(mean(values), 12);
    expect(ci.n).toBe(40);
    expect(ci.lower).toBeLessThan(ci.estimate);
    expect(ci.upper).toBeGreaterThan(ci.estimate);
  });

  it('collapses to a point for a constant sample and is null for an empty one', () => {
    expect(bootstrapCI([0.5, 0.5, 0.5])).toEqual({ estimate: 0.5, lower: 0.5, upper: 0.5, n: 3 });
    expect(bootstrapCI([])).toBeNull();
  });

  it('narrows as the sample grows', () => {
    const small = bootstrapCI([0, 1, 0, 1, 1, 0])!;
    const large = bootstrapCI(Array.from({ length: 600 }, (_, i) => i % 2))!;
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });

  it('accepts a custom statistic', () => {
    const median = (xs: number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);
    expect(bootstrapCI([1, 2, 3, 100], median)!.estimate).toBe(2.5);
  });
});

describe('pairedBootstrapDiff', () => {
  it('detects a consistent improvement with a small p-value', () => {
    const m1 = Array.from({ length: 30 }, (_, i) => 0.4 + (i % 5) * 0.02);
    const m2 = m1.map((v) => v + 0.15);
    const diff = pairedBootstrapDiff(m1, m2)!;
    expect(diff.estimate).toBeCloseTo(0.15, 12);
    expect(diff.lower).toBeCloseTo(0.15, 12);
    expect(diff.upper).toBeCloseTo(0.15, 12);
    expect(diff.pValue).toBe(1 / 2000);
  });

  it('finds no difference for identical conditions', () => {
    const values = [0.1, 0.5, 0.9, 0.3];
    const diff = pairedBootstrapDiff(values, values)!;
    expect(diff).toMatchObject({ estimate: 0, lower: 0, upper: 0, pValue: 1 });
  });

  it('a noisy, mixed-sign difference has a CI covering 0', () => {
    const a = [0.2, 0.8, 0.5, 0.4, 0.6, 0.3, 0.7, 0.5];
    const b = [0.3, 0.7, 0.6, 0.3, 0.6, 0.4, 0.6, 0.5];
    const diff = pairedBootstrapDiff(a, b, { seed: 3 })!;
    expect(diff.lower).toBeLessThanOrEqual(0);
    expect(diff.upper).toBeGreaterThanOrEqual(0);
    expect(diff.pValue).toBeGreaterThan(0.05);
  });

  it('is reproducible and validates input', () => {
    const a = [0.1, 0.2, 0.9];
    const b = [0.4, 0.1, 0.8];
    expect(pairedBootstrapDiff(a, b, { seed: 5 })).toEqual(pairedBootstrapDiff(a, b, { seed: 5 }));
    expect(() => pairedBootstrapDiff([1], [1, 2])).toThrow(/differ in length/);
    expect(pairedBootstrapDiff([], [])).toBeNull();
  });
});
