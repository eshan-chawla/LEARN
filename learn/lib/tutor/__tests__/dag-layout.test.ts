import { describe, expect, it } from 'vitest';
import { layoutDag } from '@/lib/tutor/dag-layout';
import { ConceptGraph } from '@/lib/tutor/concept-graph';
import { MINI_SPEC } from '@/lib/tutor/__tests__/fixtures';

describe('layoutDag', () => {
  const nodes = layoutDag(MINI_SPEC);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  it('places every concept exactly once', () => {
    expect(nodes.map((n) => n.id).sort()).toEqual(MINI_SPEC.concepts.map((c) => c.id).sort());
  });

  it('every edge goes to a higher layer', () => {
    for (const edge of MINI_SPEC.edges) expect(byId[edge.to].layer).toBeGreaterThan(byId[edge.from].layer);
  });

  it('roots are layer 0 and layer = longest path from a root', () => {
    expect(byId.derivatives.layer).toBe(0);
    expect(byId.matrix_multiplication.layer).toBe(0);
    expect(byId.backprop.layer).toBe(2); // derivatives → chain_rule → backprop, not matrix_multiplication → backprop
    expect(byId.vanishing_gradients.layer).toBe(3);
  });

  it('orders within a layer by topological index', () => {
    const graph = new ConceptGraph(MINI_SPEC);
    for (const layer of new Set(nodes.map((n) => n.layer))) {
      const row = nodes.filter((n) => n.layer === layer).sort((a, b) => a.order - b.order);
      expect(row.map((n) => n.order)).toEqual(row.map((_, i) => i));
      const topo = row.map((n) => graph.topoIndex(n.id));
      expect(topo).toEqual([...topo].sort((a, b) => a - b));
    }
  });
});
