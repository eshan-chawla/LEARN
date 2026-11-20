# LEARN: Citation-First Adaptive Course Copilot

**Team members:** Eshan Chawla, Joao Lucas Veras  
**Selected track:** Option 2 — LLMs + AI Agent System (Evaluation-First)

## Abstract

LEARN is an AI-native learning-management system that turns instructor-approved course materials into a reliable, personalized learning assistant. Rather than providing a generic chatbot, LEARN uses hybrid retrieval, a learning-state memory, and a planner–executor–critic workflow to give citation-grounded explanations, Socratic hints, adaptive practice questions, and prerequisite-aware study guidance.

The system is designed to answer a central challenge in higher education: students need immediate help, but unrestricted LLMs can hallucinate, provide unsupported claims, or reveal solutions to graded work. LEARN addresses this by grounding responses in course materials, requiring visible citations, tracking student mastery over time, and enforcing assessment-integrity policies. We will evaluate the same course-specific benchmark across at least three LLMs, including an open-source model, measuring answer correctness, citation grounding, pedagogical quality, safety compliance, latency, and cost.

## Core Contribution: State-Conditioned Tutoring

LEARN keeps a **structured learner state** S_t for each student over a course prerequisite graph (`data/concept_graph/dl_course.json`, 31 concepts). Each concept carries:
- mastery p_c, updated with Bayesian Knowledge Tracing;
- status: unknown, learning, mastered or misconception;
- active misconceptions, with confidence and the turns that showed them;
- observation counts.

Each turn runs **diagnose → update S_t → policy → state-conditioned retrieval → generate → grounding critic**. The policy:
- probes the prerequisite with maximum expected information gain;
- localizes the root-cause gap instead of remediating everything;
- refutes active misconceptions with a discriminating probe;
- advances only within the zone of proximal development.

The whole loop is one headless function (`learn/lib/tutor/pipeline.ts`). The app route and the experiments call it with ablation flags:
- `rag`: none, dense or hybrid
- `critic`: on or off
- `memory`: none, raw, summary or structured

## Repository Layout

| Path | Purpose |
| --- | --- |
| [`learn/`](learn/) | Next.js 16 (App Router) web app: auth, classes, PDF/video upload, notes, Ask AI, **adaptive tutor + mastery map** (`/dashboard/class/<slug>/tutor`) |
| [`learn/lib/tutor/`](learn/lib/tutor/) | Learner-state engine (BKT, policy, diagnoser, conditioning), tutor pipeline, persistence |
| [`learn/eval/`](learn/eval/) | Experiment runners and metrics (single-turn ablation A0–A3; multi-turn memory comparison M0–M2) |
| [`data/`](data/) | Concept graph parts and benchmark ([dataset card](data/benchmark/README.md)) |
| [`results/`](results/) | Raw experiment outputs (JSONL), committed so every reported number is reproducible |
| [`paper/`](paper/) | IEEE-format LaTeX report (`tectonic main.tex`) |
| [`modal/`](modal/) | Modal serverless functions: PDF ingestion, Whisper video transcription, embedding, retrieval webhooks |
| [`qdrant/`](qdrant/) | Setup script for the shared `class_content_embeddings` vector collection |
| [`docs/WORKPLAN.md`](docs/WORKPLAN.md) | Ownership of remaining work per team member |

## Getting Started

**Deploying from scratch** (accounts, every API key and env file, step by step): see **[`DEPLOY.md`](DEPLOY.md)**.

Quick start once the backing services exist:

```bash
cd learn
npm ci
cp .env.local.example .env.local   # fill in credentials (see DEPLOY.md §2)
npm run dev                        # http://localhost:3000
npm test                           # unit tests, no keys needed
```

## Reproducing Results

```bash
cd learn
npm run graph:build                                    # data/concept_graph parts → dl_course.json
npm run eval:single -- --config A0                     # repeat for A1, A2, A3 → results/single_turn/
npx tsx --env-file=.env.local eval/run-trajectories.ts --memory structured   # M0–M2 (see docs/WORKPLAN.md, J3)
cd .. && python analysis/make_tables.py && python analysis/make_plots.py     # → paper/tables, paper/figures (J4)
cd paper && tectonic main.tex
```

## Tech Stack

- **Frontend**: Next.js 16.1.6 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth, row-level security)
- **Asset Storage**: AWS S3
- **Processing**: Modal serverless functions (PDF extraction, Whisper transcription)
- **Embeddings**: Gemini `gemini-embedding-001`
- **Vector Storage**: Qdrant
- **Chat Models**: Gemini 2.5 (Flash-Lite / Flash / Pro) and an open-weight GLM Flash model via an OpenAI-compatible API
