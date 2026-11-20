import { ConceptGraph } from '@/lib/tutor/concept-graph';
import type { ConceptGraphSpec } from '@/lib/tutor/types';

export interface LayoutNode {
  id: string;
  /** Longest path from any root, so every edge points to a strictly higher layer. */
  layer: number;
  /** Position within the layer, by topological index. */
  order: number;
}

/** Layered (Sugiyama-style, without crossing minimization) layout of the prerequisite DAG. */
export function layoutDag(spec: ConceptGraphSpec): LayoutNode[] {
  const graph = new ConceptGraph(spec);
  const ordered = [...graph.conceptIds].sort((a, b) => graph.topoIndex(a) - graph.topoIndex(b));
  const layer = new Map<string, number>();
  for (const id of ordered) {
    const parents = graph.prerequisitesOf(id);
    layer.set(id, parents.length === 0 ? 0 : Math.max(...parents.map((p) => layer.get(p)!)) + 1);
  }

  const nextOrder = new Map<number, number>();
  return ordered.map((id) => {
    const l = layer.get(id)!;
    const order = nextOrder.get(l) ?? 0;
    nextOrder.set(l, order + 1);
    return { id, layer: l, order };
  });
}
