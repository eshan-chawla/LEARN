# LEARN: Citation-First Adaptive Course Copilot

**Team members:** Eshan Chawla, Joao Lucas Veras  
**Selected track:** Option 2 — LLMs + AI Agent System (Evaluation-First)

## Abstract

LEARN is an AI-native learning-management system that turns instructor-approved course materials into a reliable, personalized learning assistant. Rather than providing a generic chatbot, LEARN uses hybrid retrieval, a learning-state memory, and a planner–executor–critic workflow to give citation-grounded explanations, Socratic hints, adaptive practice questions, and prerequisite-aware study guidance.

The system is designed to answer a central challenge in higher education: students need immediate help, but unrestricted LLMs can hallucinate, provide unsupported claims, or reveal solutions to graded work. LEARN addresses this by grounding responses in course materials, requiring visible citations, tracking student mastery over time, and enforcing assessment-integrity policies. We will evaluate the same course-specific benchmark across at least three LLMs, including an open-source model, measuring answer correctness, citation grounding, pedagogical quality, safety compliance, latency, and cost.

## Repository Layout

| Path | Purpose |
| --- | --- |
| [`learn/`](learn/) | Next.js 16 (App Router) web app — auth, classes, PDF/video upload, notes, Ask AI panels, retrieval API routes |
| [`modal/`](modal/) | Modal serverless functions — PDF ingestion, Whisper video transcription, embedding, retrieval webhooks |
| [`qdrant/`](qdrant/) | Standalone setup script for the shared `class_content_embeddings` vector collection |

## Getting Started

Set the project up in this order. Each step links to the full guide for that component.

1. **Vector store** — create the shared Qdrant collection: [`qdrant/README.md`](qdrant/README.md)
2. **Database** — create the Supabase project and run the SQL scripts in order: [`learn/supabase/README.md`](learn/supabase/README.md)
3. **Processing backend** — deploy the Modal app and create its secrets: [`modal/DEPLOYMENT.md`](modal/DEPLOYMENT.md)
4. **Web app** — install dependencies, fill in `.env.local`, and run the dev server: [`learn/README.md`](learn/README.md)

Quick start for the web app once the backing services exist:

```bash
cd learn
npm install
cp .env.local.example .env.local   # then fill in credentials
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The full environment-variable list, architecture walkthrough (PDF processing flow, retrieval flow, video processing flow), build/lint commands, and deployment notes are documented in [`learn/README.md`](learn/README.md).

## Tech Stack

- **Frontend**: Next.js 16.1.6 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth, row-level security)
- **Asset Storage**: AWS S3
- **Processing**: Modal serverless functions (PDF extraction, Whisper transcription)
- **Embeddings**: Gemini `gemini-embedding-001`
- **Vector Storage**: Qdrant
- **Chat Models**: Gemini and Llama via AWS Bedrock (multi-model evaluation)

## Development Notes

To resume the Codex session associated with this project:

```bash
codex resume 019cd8b8-1d45-71e3-874b-c5122235b0dc
```
