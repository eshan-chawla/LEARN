import type { BktParams, ConceptGraphSpec, ConceptSpec, MisconceptionSpec } from '@/lib/tutor/types';

export interface AncestorHit {
  conceptId: string;
  /** 1 = direct prerequisite, 2 = prerequisite of a prerequisite, ... */
  depth: number;
}

function assertProbability(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a probability in [0, 1], got ${value}`);
  }
}

function validateBkt(params: BktParams, label: string) {
  assertProbability(params.pInit, `${label}.pInit`);
  assertProbability(params.pTransit, `${label}.pTransit`);
  assertProbability(params.pSlip, `${label}.pSlip`);
  assertProbability(params.pGuess, `${label}.pGuess`);
  // With s + g >= 1 a correct answer is no more likely under mastery than without it,
  // so observations would carry no (or inverted) information.
  if (params.pSlip + params.pGuess >= 1) {
    throw new Error(`${label}: pSlip + pGuess must be < 1 for observations to be informative`);
  }
}

/**
 * Prerequisite DAG G = (C, E). An edge (u, v) means u is a prerequisite of v.
 * Construction validates ids, BKT parameters, and acyclicity.
 */
export class ConceptGraph {
  readonly course: string;
  private readonly concepts = new Map<string, ConceptSpec>();
  private readonly prerequisites = new Map<string, string[]>();
  private readonly dependents = new Map<string, string[]>();
  private readonly misconceptions = new Map<string, MisconceptionSpec & { conceptId: string }>();
  private readonly bkt = new Map<string, BktParams>();
  private readonly topoOrder: string[];

  constructor(spec: ConceptGraphSpec) {
    this.course = spec.course;
    validateBkt(spec.defaults.bkt, 'defaults.bkt');

    for (const concept of spec.concepts) {
      if (this.concepts.has(concept.id)) {
        throw new Error(`Duplicate concept id: ${concept.id}`);
      }
      this.concepts.set(concept.id, concept);
      this.prerequisites.set(concept.id, []);
      this.dependents.set(concept.id, []);

      const params = { ...spec.defaults.bkt, ...concept.bkt };
      validateBkt(params, `${concept.id}.bkt`);
      this.bkt.set(concept.id, params);

      for (const misconception of concept.misconceptions ?? []) {
        if (this.misconceptions.has(misconception.id)) {
          throw new Error(`Duplicate misconception id: ${misconception.id}`);
        }
        this.misconceptions.set(misconception.id, { ...misconception, conceptId: concept.id });
      }
    }

    for (const edge of spec.edges) {
      if (!this.concepts.has(edge.from) || !this.concepts.has(edge.to)) {
        throw new Error(`Edge references unknown concept: ${edge.from} -> ${edge.to}`);
      }
      if (edge.from === edge.to) {
        throw new Error(`Self-loop on concept: ${edge.from}`);
      }
      this.prerequisites.get(edge.to)!.push(edge.from);
      this.dependents.get(edge.from)!.push(edge.to);
    }

    this.topoOrder = this.computeTopologicalOrder();
  }

  /** Kahn's algorithm; throws if the graph has a cycle. Ties broken by spec order for determinism. */
  private computeTopologicalOrder(): string[] {
    const inDegree = new Map<string, number>();
    for (const id of this.concepts.keys()) {
      inDegree.set(id, this.prerequisites.get(id)!.length);
    }

    const order: string[] = [];
    const ready = [...this.concepts.keys()].filter((id) => inDegree.get(id) === 0);

    while (ready.length > 0) {
      const id = ready.shift()!;
      order.push(id);
      for (const dependent of this.dependents.get(id)!) {
        const remaining = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) ready.push(dependent);
      }
    }

    if (order.length !== this.concepts.size) {
      const cyclic = [...this.concepts.keys()].filter((id) => !order.includes(id));
      throw new Error(`Prerequisite graph has a cycle involving: ${cyclic.join(', ')}`);
    }

    return order;
  }

  get conceptIds(): string[] {
    return [...this.topoOrder];
  }

  has(conceptId: string): boolean {
    return this.concepts.has(conceptId);
  }

  getConcept(conceptId: string): ConceptSpec {
    const concept = this.concepts.get(conceptId);
    if (!concept) throw new Error(`Unknown concept: ${conceptId}`);
    return concept;
  }

  bktFor(conceptId: string): BktParams {
    const params = this.bkt.get(conceptId);
    if (!params) throw new Error(`Unknown concept: ${conceptId}`);
    return params;
  }

  prerequisitesOf(conceptId: string): string[] {
    return [...(this.prerequisites.get(conceptId) ?? [])];
  }

  dependentsOf(conceptId: string): string[] {
    return [...(this.dependents.get(conceptId) ?? [])];
  }

  getMisconception(misconceptionId: string) {
    return this.misconceptions.get(misconceptionId) ?? null;
  }

  misconceptionsOf(conceptId: string): MisconceptionSpec[] {
    return [...(this.getConcept(conceptId).misconceptions ?? [])];
  }

  /** Ancestors of `conceptId` up to `maxDepth`, each at its shortest depth (BFS). */
  ancestorsWithin(conceptId: string, maxDepth: number): AncestorHit[] {
    const seen = new Map<string, number>();
    let frontier = [conceptId];

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const prerequisite of this.prerequisites.get(id) ?? []) {
          if (!seen.has(prerequisite)) {
            seen.set(prerequisite, depth);
            next.push(prerequisite);
          }
        }
      }
      frontier = next;
    }

    return [...seen.entries()].map(([id, depth]) => ({ conceptId: id, depth }));
  }

  /** Position in topological order; lower = more foundational. */
  topoIndex(conceptId: string): number {
    return this.topoOrder.indexOf(conceptId);
  }
}
