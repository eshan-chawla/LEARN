# Modal PDF Processing - Deployment Guide

This guide covers deploying the PDF processing function to Modal for serverless execution.

## Prerequisites

- Python 3.11 or higher
- Modal account (sign up at https://modal.com)
- Supabase project with Storage enabled
- Qdrant instance (cloud or local)
- LlamaCloud API key

## 1. Install Modal

```bash
pip install modal
```

## 2. Authenticate with Modal

```bash
modal token new
```

This will open a browser window to authenticate your Modal account.

## 3. Set Up API Keys

### 3.1 Get LlamaCloud API Key

1. Sign up at https://cloud.llamaindex.ai
2. Navigate to API Keys section
3. Create a new API key
4. Save the key securely

### 3.2 Set Up Qdrant

**Option A: Qdrant Cloud (Recommended)**
1. Sign up at https://cloud.qdrant.io
2. Create a new cluster
3. Get your cluster URL and API key from the dashboard

**Option B: Self-hosted Qdrant**
```bash
docker run -p 6333:6333 qdrant/qdrant
```
For self-hosted, URL will be `http://localhost:6333` and no API key is needed.

### 3.3 Get Supabase Credentials

From your Supabase project dashboard:
1. Go to Project Settings > API
2. Copy the URL (SUPABASE_URL)
3. Copy the `service_role` key (SUPABASE_SERVICE_KEY) - NOT the anon key

## 4. Create Modal Secrets

Modal uses secrets to securely pass environment variables to your functions.

### Create LlamaCloud secret

```bash
modal secret create llama-cloud-api-key \
  LLAMA_CLOUD_API_KEY=your-llama-cloud-api-key
```

### Create Supabase secret

```bash
modal secret create supabase-credentials \
  SUPABASE_URL=https://your-project.supabase.co \
  SUPABASE_SERVICE_KEY=your-service-role-key
```

### Create Qdrant secret

```bash
modal secret create qdrant-credentials \
  QDRANT_URL=https://your-cluster.qdrant.io \
  QDRANT_API_KEY=your-qdrant-api-key
```

For self-hosted Qdrant without API key:
```bash
modal secret create qdrant-credentials \
  QDRANT_URL=http://localhost:6333 \
  QDRANT_API_KEY=""
```

## 5. Deploy to Modal

From the project root directory:

```bash
modal deploy modal/pdf_processor.py
```

This will:
- Build the container image with all dependencies
- Deploy the function to Modal's infrastructure
- Generate a webhook URL for the endpoint

## 6. Configure Next.js

After deployment, Modal will output a webhook URL like:
```
https://your-username--pdf-processor-process-pdf-webhook.modal.run
```

Add this to your `.env.local`:

```bash
MODAL_WEBHOOK_URL=https://your-username--pdf-processor-process-pdf-webhook.modal.run
```

## 7. Verify Deployment

Check your Modal dashboard at https://modal.com/apps to see:
- Deployed function status
- Recent invocations
- Logs and metrics

## Testing the Complete Flow

### 1. Upload a PDF

```bash
# Test upload via your Next.js app
# or use the Supabase Storage UI
```

### 2. Trigger Processing

The Next.js API route at `/api/process-pdf` will automatically call your Modal webhook when a PDF is uploaded.

### 3. Monitor Progress

Check the `pdf_processing_jobs` table in Supabase to see:
- `status`: pending → processing → completed/failed
- `progress`: 0 → 10 → 30 → 40 → 80 → 95 → 100
- `chunks_processed`: Current chunk count
- `total_chunks`: Total chunks to process

### 4. Query Embeddings

Once completed, embeddings are stored in Qdrant under the `pdf_embeddings` collection with:
- `book_id`: Links to your books table
- `text`: The actual text chunk
- `chunk_index`: Position in the document
- `vector`: 384-dimensional embedding

## Troubleshooting

### Cold Start Times

First invocation may take 30-60 seconds to:
- Pull the container image
- Download ML models (sentence-transformers)
- Initialize clients

Subsequent calls are much faster (2-3 seconds).

### Memory Issues

If processing large PDFs fails with OOM errors, increase memory in `pdf_processor.py`:

```python
@app.function(
    memory=4096,  # Increase from 2048 to 4096 MB
    ...
)
```

### Timeout Issues

For very large PDFs, increase timeout:

```python
@app.function(
    timeout=1800,  # Increase from 900 to 1800 seconds (30 min)
    ...
)
```

### Debugging

View real-time logs in Modal dashboard or via CLI:

```bash
modal app logs pdf-processor
```

## Cost Optimization

Modal charges for:
- CPU/GPU time during execution
- Memory usage
- Storage for container images

Tips to reduce costs:
1. Use smaller embedding models if accuracy allows
2. Adjust chunk size to reduce total chunks
3. Enable keep-warm for production (reduces cold starts)
4. Use spot instances for non-critical processing

## Production Considerations

### 1. Enable Keep-Warm

For production, add keep-warm to reduce cold starts:

```python
@app.function(
    image=image,
    keep_warm=1,  # Keep 1 instance warm
    ...
)
```

### 2. Add Retry Logic

Modal automatically retries failed functions, but you can customize:

```python
@app.function(
    retries=3,  # Retry up to 3 times on failure
    ...
)
```

### 3. Monitor Performance

Use Modal's built-in metrics:
- Execution time per function
- Success/failure rates
- Memory usage patterns
- Cold start frequency

### 4. Rate Limiting

LlamaCloud has rate limits. For high-volume processing:
1. Implement queuing in your Next.js app
2. Add exponential backoff in Modal function
3. Consider LlamaCloud enterprise plan

## Updating the Function

To deploy changes:

```bash
modal deploy modal/pdf_processor.py
```

Modal will:
- Build a new image with changes
- Deploy with zero downtime
- Keep the same webhook URL

## Rollback

If a deployment has issues, rollback via Modal dashboard:
1. Go to your app's version history
2. Select a previous version
3. Click "Deploy"

## Additional Resources

- Modal docs: https://modal.com/docs
- LlamaParse docs: https://docs.llamaindex.ai/en/stable/llama_cloud/llama_parse/
- Qdrant docs: https://qdrant.tech/documentation/
- Sentence Transformers: https://www.sbert.net/
