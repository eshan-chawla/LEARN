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
