import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConceptGraph } from '@/lib/tutor/concept-graph';
import { loadConceptGraph, mergeGraphParts } from '@/lib/tutor/graph-io';

const META = { version: 1, course: 'test', defaults: { bkt: { pInit: 0.3, pTransit: 0.1, pSlip: 0.1, pGuess: 0.2 } } };
const COURSE_GRAPH = fileURLToPath(new URL('../../../../data/concept_graph/dl_course.json', import.meta.url));

const FROZEN_FOUNDATION_IDS = [
  'matrix_multiplication', 'dot_product', 'derivatives', 'partial_derivatives', 'chain_rule',
  'probability_basics', 'loss_functions', 'softmax_cross_entropy', 'gradient_descent', 'sgd_minibatch',
  'momentum_adam', 'perceptron', 'activation_functions', 'mlp', 'overfitting_regularization',
];
const ADVANCED_IDS = [
  'computational_graph', 'backprop', 'vanishing_gradients', 'weight_initialization', 'relu', 'batch_norm',
  'dropout', 'residual_connections', 'convolution', 'pooling_cnn', 'rnn', 'lstm', 'attention',
  'self_attention', 'positional_encoding', 'transformer',
];

describe('mergeGraphParts', () => {
  it('merges two parts into a valid graph', () => {
    const spec = mergeGraphParts(
      [
        { concepts: [{ id: 'a', name: 'A' }], edges: [] },
        { concepts: [{ id: 'b', name: 'B' }], edges: [{ from: 'a', to: 'b' }] },
      ],
      META
    );
    const graph = new ConceptGraph(spec);
    expect(graph.prerequisitesOf('b')).toEqual(['a']);
    expect(spec.course).toBe('test');
  });

  it('rejects a concept defined in both parts', () => {
    expect(() =>
      mergeGraphParts(
        [
          { concepts: [{ id: 'a', name: 'A' }], edges: [] },
          { concepts: [{ id: 'a', name: 'A again' }], edges: [] },
        ],
        META
      )
    ).toThrow(/a/);
  });

  it('rejects a cross-part edge to an unknown id', () => {
    expect(() =>
      mergeGraphParts(
        [
          { concepts: [{ id: 'a', name: 'A' }], edges: [] },
          { concepts: [{ id: 'b', name: 'B' }], edges: [{ from: 'missing', to: 'b' }] },
        ],
        META
      )
    ).toThrow(/missing/);
  });
});

describe('committed course graph', () => {
  it('the committed dl_course.json loads and contains every frozen id', () => {
    const graph = loadConceptGraph(COURSE_GRAPH);
    for (const id of [...FROZEN_FOUNDATION_IDS, ...ADVANCED_IDS]) {
      expect(graph.has(id), id).toBe(true);
    }
    expect(graph.prerequisitesOf('backprop')).toEqual(
      expect.arrayContaining(['computational_graph', 'gradient_descent', 'matrix_multiplication'])
    );
    expect(graph.getMisconception('backprop.M1')).toBeTruthy();
  });
});
