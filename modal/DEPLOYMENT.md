# Modal PDF Processing - Deployment Guide

This service processes PDFs from S3, chunks them page-by-page, embeds them, and stores them in a shared Qdrant collection.

Embedding model:
- `gemini-embedding-001`
- `768`-dimensional vectors
- task types:
  - `RETRIEVAL_DOCUMENT` for indexed chunks
  - `RETRIEVAL_QUERY` for search queries
- runtime target: CPU-only Modal containers

## Architecture

```text
Browser -> Vercel upload route -> S3
Vercel -> books row in Supabase
Vercel /api/process-pdf -> Modal webhook
Modal -> S3 download -> chunk/embed -> Qdrant
Modal -> books.processing_status update in Supabase
Vercel /api/retrieval/* -> Modal retrieval webhook -> Qdrant search
```

Qdrant collection:
- `class_content_embeddings`

Important payload filters:
- `class_id`
- `content_type`

Current content type:
- `pdf`

## Prerequisites

- Python 3.11+
- Modal account
- AWS S3 bucket already used by the app
- Supabase project
- Qdrant instance

## 1. Install and authenticate Modal

```bash
pip install modal
modal token new
```

## 2. Create Modal secrets

### AWS secret

```bash
modal secret create aws-s3-credentials \
  AWS_ACCESS_KEY_ID=your-aws-access-key-id \
  AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key \
  AWS_REGION=us-east-1 \
  AWS_S3_RECORDINGS_BUCKET=your-bucket-name
```

### Supabase secret

```bash
modal secret create supabase-credentials \
  SUPABASE_URL=https://your-project.supabase.co \
  SUPABASE_SERVICE_KEY=your-service-role-key
```

### Qdrant secret

```bash
modal secret create qdrant-credentials \
  QDRANT_URL=https://your-cluster.qdrant.io \
  QDRANT_API_KEY=your-qdrant-api-key
```

For self-hosted Qdrant:

```bash
modal secret create qdrant-credentials \
  QDRANT_URL=http://localhost:6333 \
  QDRANT_API_KEY=""
```

### Gemini secret

```bash
modal secret create gemini-api-key \
  GEMINI_API_KEY=your-gemini-api-key
```

### Webhook secret

Use one random shared secret between Vercel and Modal.

```bash
modal secret create modal-webhook-secret \
  MODAL_WEBHOOK_SECRET=your-random-shared-secret
```

## 3. Deploy

```bash
modal deploy modal/app.py
```

Legacy compatibility entrypoint still exists:

```bash
modal deploy modal/pdf_processor.py
```

Copy the generated webhook URL.
You will have one URL for PDF processing and one URL for retrieval search.

## 4. Configure Vercel / Next.js

Set these env vars in Vercel and `.env.local`:

```bash
MODAL_WEBHOOK_URL=https://your-username--pdf-processor-process-pdf-webhook.modal.run
MODAL_WEBHOOK_SECRET=your-random-shared-secret
MODAL_RETRIEVAL_WEBHOOK_URL=https://your-username--pdf-processor-search-content-webhook.modal.run
```

## 5. Request contract

Vercel sends this payload to Modal:

```json
{
  "webhook_secret": "shared-secret",
  "book_id": "uuid",
  "class_id": "uuid",
  "title": "Linear Algebra Notes",
  "storage_path": "books/class-id/123_file.pdf",
  "file_name": "Linear Algebra Notes.pdf"
}
```

Retrieval requests send this payload:

```json
{
  "webhook_secret": "shared-secret",
  "query": "spectral theorem",
  "class_id": "uuid",
  "content_types": ["pdf"],
  "source_ids": ["uuid"],
  "limit": 8
}
```

## 6. Qdrant payload schema

Each point currently stores:

- `class_id`
- `content_type` = `pdf`
- `source_id` = book id
- `title`
- `file_name`
- `storage_path`
- `page_number`
- `page_chunk_index`
- `chunk_index`
- `text`

This schema is designed so video transcript ingestion can later reuse the same collection with `content_type = video`.

Collection vector config:
- size: `768`
- distance: `Cosine`

## 7. Current status tracking

The worker updates `books.processing_status`:

- `pending`
- `processing`
- `completed`
- `failed`

If processing fails, `books.error_message` is populated.

There is no `pdf_processing_jobs` table in the current Stage 1 setup.

## 8. Verification

1. Upload a PDF in the app
2. Confirm the book row is created with `processing_status = pending`
3. Confirm `/api/process-pdf` returns success
4. Check Modal logs:

```bash
modal app logs pdf-processor
```

5. Confirm the book row becomes `completed`
6. Confirm Qdrant has points in `class_content_embeddings`
7. Inspect payload metadata for `class_id`, `content_type`, `file_name`, and `page_number`

## 9. Reset for Gemini migration

If you are switching from an older embedding model, recreate the collection before reprocessing PDFs:

```bash
python3 qdrant/create_collection.py --env-file .env.local --recreate
```

This keeps the collection name the same but resets it to the new vector size.
## 10. Notes

- The service is now structured for multiple jobs:
  - `modal/app.py` for the Modal app and shared image
  - `modal/jobs/` for background workers
  - `modal/webhooks/` for webhook entrypoints
  - `modal/lib/` for shared helpers
- The service currently chunks per page to preserve page metadata.
- The embedding worker uses Gemini's hosted embeddings through the `google-genai` SDK.
- For non-`3072` Gemini dimensions, embeddings are normalized before they are stored or queried.
- The collection is shared across classes; retrieval must always filter by `class_id`.
- Later video transcript ingestion should use the same collection and set `content_type = video`.
