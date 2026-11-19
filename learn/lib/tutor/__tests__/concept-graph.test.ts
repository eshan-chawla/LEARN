import { describe, expect, it } from 'vitest';
import { ConceptGraph } from '@/lib/tutor/concept-graph';
import { MINI_SPEC, miniGraph } from '@/lib/tutor/__tests__/fixtures';

describe('ConceptGraph', () => {
  it('orders concepts topologically', () => {
    const graph = miniGraph();
    const order = graph.conceptIds;
    for (const { from, to } of MINI_SPEC.edges) {
      expect(order.indexOf(from)).toBeLessThan(order.indexOf(to));
    }
  });

  it('finds ancestors at their shortest depth within a bound', () => {
    const graph = miniGraph();
    const depth1 = graph.ancestorsWithin('backprop', 1).map((a) => a.conceptId).sort();
    expect(depth1).toEqual(['chain_rule', 'gradient_descent', 'matrix_multiplication']);

    const depth2 = graph.ancestorsWithin('backprop', 2);
    expect(depth2.find((a) => a.conceptId === 'derivatives')?.depth).toBe(2);
    expect(graph.ancestorsWithin('vanishing_gradients', 1)).toEqual([{ conceptId: 'backprop', depth: 1 }]);
  });

  it('merges concept BKT overrides with defaults', () => {
    const graph = new ConceptGraph({
      ...MINI_SPEC,
      concepts: MINI_SPEC.concepts.map((c) => (c.id === 'chain_rule' ? { ...c, bkt: { pInit: 0.5 } } : c)),
    });
    expect(graph.bktFor('chain_rule')).toEqual({ pInit: 0.5, pTransit: 0.1, pSlip: 0.1, pGuess: 0.2 });
  });

  it('rejects cycles', () => {
    expect(
      () => new ConceptGraph({ ...MINI_SPEC, edges: [...MINI_SPEC.edges, { from: 'backprop', to: 'derivatives' }] })
    ).toThrow(/cycle/);
  });

  it('rejects unknown concepts, duplicates, and uninformative BKT parameters', () => {
    expect(() => new ConceptGraph({ ...MINI_SPEC, edges: [{ from: 'nope', to: 'backprop' }] })).toThrow(/unknown/);
    expect(
      () => new ConceptGraph({ ...MINI_SPEC, concepts: [...MINI_SPEC.concepts, MINI_SPEC.concepts[0]] })
    ).toThrow(/Duplicate/);
    expect(
      () =>
        new ConceptGraph({
          ...MINI_SPEC,
          defaults: { bkt: { pInit: 0.3, pTransit: 0.1, pSlip: 0.5, pGuess: 0.5 } },
        })
    ).toThrow(/informative/);
  });

  it('indexes misconceptions with their owning concept', () => {
    expect(miniGraph().getMisconception('backprop.M1')?.conceptId).toBe('backprop');
    expect(miniGraph().getMisconception('missing')).toBeNull();
  });
});
