# LEARN — Remaining Work Plan and Ownership

Each item has a single owner who writes the code, tests, and commits under their own GitHub account. The final report includes a contributions statement that matches this file.

**Detailed handoff for Joao:** `handoff.md`, shared separately. Contracts that both people depend on live in code and change only through a PR that both review:
- `learn/lib/tutor/critic-types.ts`: the Critic interface
- `learn/lib/retrieval/types.ts`: `RetrievalSearchRequest.mode` and `RetrievalHit.conceptIds`
- `learn/lib/tutor/pipeline.ts`: `runTutorTurn`

Final submission is due **Dec 15**. The presentation is **Dec 1/3**.

## Ownership summary

| Area | Eshan | Joao |
|---|---|---|
| Learner-state engine (`learn/lib/tutor/` core) | ✅ done | — |
| Model providers (Gemini, GLM, JSON mode) | ✅ done | — |
| **Hybrid retrieval** (BM25 + dense, RRF) + concept tagging (Python/Modal/Qdrant) | reviews | **owns (J1)** |
| **Grounding & integrity Critic** (`learn/lib/tutor/critic.ts`) | reviews | **owns (J2)** |
| Tutor pipeline with ablation/memory flags (`pipeline.ts`) | **owns (E1)** | reviews |
| `/api/tutor` route + learner-state persistence | **owns (E2)** | — |
| Mastery-map UI + tutor panel | **owns (E3)** | — |
| Single-turn eval runner (A0–A3) | **owns (E4)** | reviews |
| **Trajectory simulator + multi-turn runner + metrics** (M0–M2) | reviews | **owns (J3)** |
| Analysis plots/tables (Python → vector PDF) | — | **owns (J4)** |
| Concept graph (`data/concept_graph/{advanced,foundations}.json` → `npm run graph:build` → `dl_course.json`) | `advanced.json` (backprop → transformers) | `foundations.json` (math, optimization, MLP) |
| Single-turn benchmark items | lectures in the first half | lectures in the second half |
| Trajectory personas | review | author |
| Paper | Intro, Method, Conclusion | Related Work, Experiments, Failure Analysis |
| Slides / video | system and demo slides; records the demo | results slides; edits the video |

## Git workflow (both)

1. Start from `main` after `feature/learner-state-engine` is merged.
2. Create one branch per item: `feat/hybrid-retrieval`, `feat/critic`, `feat/trajectory-eval`, and so on.
3. Make small, meaningful commits. Run `cd learn && npm test && npx tsc --noEmit && npx eslint lib app eval` before every push.
4. Open a PR and have the other person review it. Each person merges their own PRs.
5. Check `git config user.name` / `user.email` so commits are attributed to your GitHub account.

---

## Joao's items

### J1 — Hybrid retrieval + concept tagging (Python; start here, no dependencies)

**Files:** `qdrant/create_collection.py`, `modal/lib/embeddings.py`, `modal/jobs/process_pdf.py`, `modal/jobs/process_video.py`, `modal/jobs/search_content.py`, new `modal/jobs/tag_concepts.py`, `modal/requirements.txt`, `modal/app.py`

- Add a **sparse BM25 vector** to the collection next to the existing 768-d dense vector, using named vectors `dense` and `bm25`. The `fastembed` `Qdrant/bm25` model is the suggested way to build the sparse vectors. Note that this needs a new collection or a re-index; write a re-index script.
- `search_content_impl(..., mode='dense'|'hybrid')`:
  - `dense` must reproduce today's results exactly (this is the A1 baseline).
  - `hybrid` uses the Qdrant Query API `prefetch` on both vectors with **RRF** fusion.
  - Keep `mode` default `dense` so the app doesn't break.
- **Concept tagging:** `tag_concepts.py` assigns each chunk `concept_ids: string[]` from `data/concept_graph/dl_course.json`, using keyword match first and an LLM fallback for ambiguous chunks. Store the tags in the payload, add a keyword payload index, and return `conceptIds` in each hit.
- **Done when:**
  - A small `pytest` checks the RRF fusion and tagging logic.
  - Recall@5 for dense vs. hybrid is reported on about 10 gold questions.

**Interface Eshan's pipeline will call:** the retrieval webhook accepts `"mode": "dense" | "hybrid"`, and every hit includes `"conceptIds": [...]`. The TypeScript side is already in place (`learn/lib/retrieval/types.ts`, `learn/lib/retrieval/modal-client.ts`, owned by Eshan), so J1 is Python-only.

### J2 — Grounding & integrity Critic (TypeScript; can start in parallel)

**File:** `learn/lib/tutor/critic.ts`, with tests in `learn/lib/tutor/__tests__/critic.test.ts`. Import the types from `learn/lib/tutor/critic-types.ts` (already committed). `CriticVerdict` also has `warnings: string[]`. Export `makeCritic(complete): CritiqueFn` for the pipeline.

```ts
export interface CitedExcerpt {
  index: number;            // matches the [n] marker in the answer
  text: string;
  sourceId: string;
  pageNumber: number | null;
  startSeconds: number | null;
}

export interface ClaimCheck {
  claim: string;
  citations: number[];
  supported: boolean;
  reason: string;
}

export interface CriticVerdict {
  claims: ClaimCheck[];
  supportedFraction: number;          // faithfulness metric for the paper
  integrityViolation: boolean;        // e.g. solving a graded assignment verbatim
  action: 'accept' | 'revise' | 'abstain';
  revisedAnswer: string | null;       // set when action === 'revise'
}

export async function critiqueAnswer(
  input: { question: string; answer: string; excerpts: CitedExcerpt[] },
  complete: (prompt: string) => Promise<string>   // inject callAskAiModel(..., { json: true })
): Promise<CriticVerdict>;
```

- Split the answer into claims. Check each claim only against the excerpts it cites, so an uncited claim counts as unsupported.
- Then decide: **accept** if supportedFraction ≥ τ, **revise** by dropping or rewriting unsupported claims, or **abstain** if nothing is supported.
- Follow the pattern in `lib/tutor/diagnoser.ts`: an injected `complete`, tolerant JSON parsing, and fail-closed behavior.
- **Done when:** unit tests pass with a mocked `complete`, covering all three actions, malformed JSON, and citations to excerpts that don't exist.

### J3 — Trajectory simulator, multi-turn runner, metrics (TypeScript)

**Files:** `learn/eval/simulated-student.ts`, `learn/eval/run-trajectories.ts`, `learn/eval/trajectory-metrics.ts`, `learn/eval/stats.ts`, `data/benchmark/trajectories/*.json`. Eval code lives under `learn/` so the `@/` imports and vitest work. Run with `npx tsx --env-file=.env.local eval/<script>.ts`.

- **Persona format:** known concepts, prerequisite gaps, persistent misconceptions, and a script of opening questions and distractor turns. Each turn carries **gold labels**: the true gap, the active misconceptions, the acceptable next actions, and the do-not-remediate concepts.
- **Simulator:** an LLM role-plays the persona and must answer consistently with the hidden state. A deterministic scripted mode is also needed for reproducibility.
- **Runner:** drives `runTutorTurn` from E1 under memory conditions M0, M1, M1b and M2 and writes `results/trajectories/<run-id>.jsonl`.
- **Metrics:**
  - gap-identification P/R/F1 and turns-to-detection
  - misconception detection and persistence
  - **unnecessary-remediation rate**
  - next-action accuracy
  - Brier score and AUC of `p_c` against hidden mastery
  - bootstrap 95% CIs
- **Done when:** unit tests for the metrics on hand-made logs pass, and a 2-persona smoke run completes. You can start the metrics and simulator before E1 lands by using the policy functions in `lib/tutor/policy.ts` directly.

### J4 — Analysis (Python)

- `analysis/make_tables.py` and `analysis/make_plots.py` read `results/**/*.jsonl` and write LaTeX tables and **vector PDF** figures to `paper/figures/`. Use matplotlib with `savefig(..., format='pdf')`.

---

## Eshan's items

- **E1 `learn/lib/tutor/pipeline.ts`.** `runTutorTurn(input, config)` runs diagnose → state update → policy → conditioned retrieval → generate → Critic.
  - Config flags: `rag: 'none'|'dense'|'hybrid'`, `critic: boolean`, `memory: 'none'|'raw'|'summary'|'structured'`.
  - It must run headless (no HTTP or auth) so the eval runners can call it.
- **E2 `learn/app/api/tutor/[classId]/route.ts`.** Load and save `learner_states`, append `learner_events`, and return the decision rationale as UI steps.
- **E3 Mastery map.** A concept-DAG view colored by status, plus a tutor panel. These are used for the demo video.
- **E4 `learn/eval/run-single-turn.ts`.** Runs A0–A3 on `data/benchmark/single_turn.jsonl`, measuring correctness (judge), citation precision, faithfulness, abstention, and latency.
