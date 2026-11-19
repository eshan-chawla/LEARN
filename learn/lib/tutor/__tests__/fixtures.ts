import { ConceptGraph } from '@/lib/tutor/concept-graph';
import type { ConceptGraphSpec } from '@/lib/tutor/types';

/**
 * Small deep-learning prerequisite graph used only by unit tests:
 *
 *   derivatives ─┬─> chain_rule ───────┐
 *                └─> gradient_descent ─┼─> backprop ─> vanishing_gradients
 *   matrix_multiplication ─────────────┘
 */
export const MINI_SPEC: ConceptGraphSpec = {
  version: 1,
  course: 'test-dl',
  defaults: { bkt: { pInit: 0.3, pTransit: 0.1, pSlip: 0.1, pGuess: 0.2 } },
  concepts: [
    { id: 'derivatives', name: 'Derivatives', keywords: ['slope', 'rate of change'] },
    { id: 'chain_rule', name: 'Chain rule', keywords: ['composite function', 'dy/dx'] },
    { id: 'gradient_descent', name: 'Gradient descent', keywords: ['learning rate'] },
    { id: 'matrix_multiplication', name: 'Matrix multiplication', keywords: ['matmul'] },
    {
      id: 'backprop',
      name: 'Backpropagation',
      keywords: ['backward pass', 'computational graph'],
      misconceptions: [
        {
          id: 'backprop.M1',
          description: 'gradients flow forward from the input to the loss',
          probe: 'In which direction are gradients propagated during training, and why?',
        },
      ],
    },
    { id: 'vanishing_gradients', name: 'Vanishing gradients', keywords: ['sigmoid saturation'] },
  ],
  edges: [
    { from: 'derivatives', to: 'chain_rule' },
    { from: 'derivatives', to: 'gradient_descent' },
    { from: 'chain_rule', to: 'backprop' },
    { from: 'gradient_descent', to: 'backprop' },
    { from: 'matrix_multiplication', to: 'backprop' },
    { from: 'backprop', to: 'vanishing_gradients' },
  ],
};

export function miniGraph() {
  return new ConceptGraph(MINI_SPEC);
}
