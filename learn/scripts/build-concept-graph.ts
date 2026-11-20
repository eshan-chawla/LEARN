/**
 * Merges the concept-graph parts into data/concept_graph/dl_course.json and validates it.
 * Usage (from learn/): npm run graph:build
 * The version is bumped only when concepts or edges change, so rebuilding is idempotent.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeGraphParts, type ConceptGraphPart } from '@/lib/tutor/graph-io';
import type { ConceptGraphSpec } from '@/lib/tutor/types';

const GRAPH_DIR = resolve(process.cwd(), '..', 'data', 'concept_graph');
const PARTS = ['foundations.json', 'advanced.json'];
const OUTPUT = resolve(GRAPH_DIR, 'dl_course.json');
const DEFAULT_BKT = { pInit: 0.3, pTransit: 0.1, pSlip: 0.1, pGuess: 0.2 };

function readPart(file: string): ConceptGraphPart {
  const raw = JSON.parse(readFileSync(resolve(GRAPH_DIR, file), 'utf8'));
  return { concepts: raw.concepts ?? [], edges: raw.edges ?? [] };
}

function main() {
  const parts = PARTS.map(readPart);
  const previous: ConceptGraphSpec | null = existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT, 'utf8')) : null;

  const draft = mergeGraphParts(parts, { version: 1, course: 'sjsu-deep-learning', defaults: { bkt: DEFAULT_BKT } });
  const changed =
    !previous ||
    JSON.stringify({ c: previous.concepts, e: previous.edges, d: previous.defaults }) !==
      JSON.stringify({ c: draft.concepts, e: draft.edges, d: draft.defaults });
  const version = previous ? previous.version + (changed ? 1 : 0) : 1;

  writeFileSync(OUTPUT, `${JSON.stringify({ ...draft, version }, null, 2)}\n`);
  console.log(
    `${changed ? 'Wrote' : 'Unchanged'} ${OUTPUT}: v${version}, ${draft.concepts.length} concepts, ${draft.edges.length} edges`
  );
}

try {
  main();
} catch (error) {
  console.error(`Invalid concept graph: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
