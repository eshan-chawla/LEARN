# Trajectory personas (J3)

Each `<id>.json` file is one simulated student, used by `learn/eval/run-trajectories.ts` for the
M0 / M1 / M1b / M2 memory comparison. The TypeScript types are in `learn/eval/trajectory-types.ts`.
The validator in `learn/eval/personas.ts` runs on every file in `npm test`.

## Persona format

```json
{
  "id": "p01-chain-rule-gap",
  "author": "joao",
  "target_concept": "backprop",
  "hidden_state": {
    "known": ["mlp", "computational_graph", "..."],
    "gaps": ["chain_rule"],
    "misconceptions": ["backprop.M1"]
  },
  "turns": [
    { "kind": "opening", "script": "I don't get why we multiply all these gradients in backprop.",
      "gold": { "gap": "chain_rule", "active_misconceptions": ["backprop.M1"],
                "acceptable_actions": ["probe_prerequisite:chain_rule", "remediate_misconception:backprop.M1"],
                "do_not_remediate": ["mlp", "..."] } },
    { "kind": "respond", "gold": { "...": "..." } },
    { "kind": "distractor", "script": "Unrelated: when is the midterm?", "gold": { "acceptable_actions": ["answer"] } }
  ]
}
```

- **Turn kinds:**
  - `opening` and `distractor` turns always use their `script`.
  - A `respond` turn uses its `script` if it has one. Otherwise the simulated student generates it from the hidden state.
- **`acceptable_actions`:** `type:id` keys, e.g. `probe_prerequisite:chain_rule` or `remediate_misconception:backprop.M1`. A bare `type` such as `answer` accepts any id.
- **`do_not_remediate`:** if a turn leaves it out, the persona's `hidden_state.known` is used.

### Validation rules
- Ids: `p01-short-name`, and the file name must match the id.
- Every concept and misconception id must exist in `data/concept_graph/dl_course.json`.
- 8–12 turns, with the opening first and at least 2 distractors.
- At least one gap or misconception.
- **Every prerequisite of `target_concept` within 2 hops must be listed in `known` or `gaps`.** Otherwise the scripted student says "don't know" for it, and the tutor rightly goes looking for a gap you didn't intend.

## Smoke run (2 personas × 4 memory conditions)

This needs `GEMINI_API_KEY` in `learn/.env.local`. `--rag none` skips retrieval, so it needs neither
Modal nor `EVAL_CLASS_ID`. It checks the whole loop end to end (about 80 tutor turns, a few minutes
on Flash-Lite).

```bash
cd learn
npm run eval:traj -- --memory all --rag none --sim scripted --seed 1 --limit 2 --model gemini-2.5-flash-lite --run-id smoke-scripted-s1
```

Output:
- `results/trajectories/smoke-scripted-s1.jsonl`: one row per tutor turn.
- `results/trajectories/smoke-scripted-s1.summary.json`: per-condition metrics with 95% bootstrap CIs.

With retrieval, once `EVAL_CLASS_ID` and the hybrid webhook are set up:

```bash
npm run eval:traj -- --memory all --rag hybrid --sim scripted --seed 1 --limit 2 --run-id smoke-hybrid-s1
```

For the LLM-simulated student (temperature 0.7), run `--sim llm` with `--seed 1`, `2` and `3`.
