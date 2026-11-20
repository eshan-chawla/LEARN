import { readFileSync } from 'node:fs';
import { ConceptGraph } from '@/lib/tutor/concept-graph';
import type { ConceptGraphSpec, ConceptSpec } from '@/lib/tutor/types';

/**
 * Concept-graph files on disk. The course graph is authored as parts with separate owners
 * (data/concept_graph/foundations.json and advanced.json) and merged into dl_course.json.
 * Node-only (fs): used by scripts and eval runners, never by app code, which reads the
 * active graph from Supabase.
 */
export interface ConceptGraphPart {
  concepts: ConceptSpec[];
  edges: Array<{ from: string; to: string }>;
}

export type ConceptGraphMeta = Pick<ConceptGraphSpec, 'version' | 'course' | 'defaults'>;

/** Concatenates parts and validates the result with ConceptGraph (cycles, unknown ids, BKT ranges). */
export function mergeGraphParts(parts: ConceptGraphPart[], meta: ConceptGraphMeta): ConceptGraphSpec {
  const owner = new Map<string, number>();
  parts.forEach((part, partIndex) => {
    for (const concept of part.concepts) {
      const previous = owner.get(concept.id);
      if (previous !== undefined) {
        throw new Error(`Concept ${concept.id} is defined in part ${previous} and part ${partIndex}`);
      }
      owner.set(concept.id, partIndex);
    }
  });

  const spec: ConceptGraphSpec = {
    ...meta,
    concepts: parts.flatMap((part) => part.concepts),
    edges: parts.flatMap((part) => part.edges),
  };
  new ConceptGraph(spec);
  return spec;
}

export function readGraphSpec(path: string): ConceptGraphSpec {
  return JSON.parse(readFileSync(path, 'utf8')) as ConceptGraphSpec;
}

export function loadConceptGraph(path: string): ConceptGraph {
  return new ConceptGraph(readGraphSpec(path));
}
