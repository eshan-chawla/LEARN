# Qdrant Setup

This directory contains a standalone setup script for the shared Smart Learn Qdrant collection.

## What it creates

- collection: `class_content_embeddings`
- vector size: `768`
- distance: `Cosine`
- payload indexes:
  - `class_id` as `uuid`
  - `content_type` as `keyword`
  - `source_id` as `uuid`
  - `page_number` as `integer`

## Env file

Create `qdrant/.env` from `qdrant/.env.example` and fill in your Qdrant credentials.

## Usage

```bash
python3 qdrant/create_collection.py
```

The script loads `qdrant/.env` automatically.

If you want to delete and recreate the collection:

```bash
python3 qdrant/create_collection.py --recreate
```

You can also override values directly:

```bash
python3 qdrant/create_collection.py \
  --url "https://your-cluster.qdrant.io" \
  --api-key "your-qdrant-api-key"
```

## Hybrid retrieval (dense + BM25)

Hybrid collections store a named `dense` vector (Gemini, 768-d, Cosine) and a named sparse
`bm25` vector with the `idf` modifier, plus a `concept_ids` keyword index. Search with
`"mode": "hybrid"` fuses both with Reciprocal Rank Fusion. `"mode": "dense"` (the default) is
unchanged.

Always develop against a separate collection, never the production one.

```bash
# 1. Copy an existing collection into a hybrid one (keeps ids, payloads and Gemini vectors)
python3 qdrant/migrate_to_hybrid.py --src class_content_embeddings --dst class_content_embeddings_hybrid_dev --dry-run
python3 qdrant/migrate_to_hybrid.py --src class_content_embeddings --dst class_content_embeddings_hybrid_dev

# Or create an empty hybrid collection
python3 qdrant/create_collection.py --hybrid --collection class_content_embeddings_hybrid_dev

# 2. Tag chunks with concept ids (keyword pass; add --llm for the Gemini fallback)
python3 modal/jobs/tag_concepts.py --collection class_content_embeddings_hybrid_dev --dry-run
python3 modal/jobs/tag_concepts.py --collection class_content_embeddings_hybrid_dev --llm

# 3. Compare dense vs. hybrid on benchmark items with gold_sources
python3 qdrant/eval_recall.py --class-id "$EVAL_CLASS_ID" \
  --collection class_content_embeddings_hybrid_dev --out results/retrieval/recall_pilot.md
```

Modal reads the active collection from the `QDRANT_COLLECTION` secret (default
`class_content_embeddings`), so switching to the hybrid collection needs no code change.
Deploy a dev copy of the app with its own webhook URLs:

```bash
MODAL_APP_NAME=learn-dev modal deploy modal/app.py
```

## Tests

```bash
pip install -r modal/requirements.txt pytest
pytest modal qdrant
```

No network is used: Qdrant runs in memory and the BM25 and Gemini models are faked.
