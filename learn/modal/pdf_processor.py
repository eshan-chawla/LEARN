"""
Modal function for PDF processing with LlamaParse and embeddings.
Deploy with: modal deploy pdf_processor.py
"""

import modal
import os
from typing import List, Dict

# Create Modal app
app = modal.App("pdf-processor")

# Define the image with dependencies
image = (
    modal.Image.debian_slim()
    .pip_install(
        "llama-parse==0.4.0",
        "sentence-transformers==2.7.0",
        "qdrant-client==1.7.0",
        "supabase==2.3.0",
        "requests"
    )
)

# Environment secrets (set in Modal dashboard)
@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("llama-cloud-api-key"),
        modal.Secret.from_name("supabase-credentials"),
        modal.Secret.from_name("qdrant-credentials")
    ],
    timeout=900,  # 15 minutes max
    memory=2048,  # 2GB RAM
)
def process_pdf(book_id: str, job_id: str, storage_path: str) -> Dict:
    """
    Process a PDF: extract text with LlamaParse, generate embeddings, store in Qdrant.

    Args:
        book_id: UUID of the book
        job_id: UUID of the processing job
        storage_path: Path to PDF in Supabase Storage (e.g., "user-id/file.pdf")

    Returns:
        Dict with success status and metadata
    """
    from llama_parse import LlamaParse
    from sentence_transformers import SentenceTransformer
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, VectorParams, PointStruct
    from supabase import create_client
    import uuid

    # Initialize clients
    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"]
    )

    qdrant = QdrantClient(
        url=os.environ["QDRANT_URL"],
        api_key=os.environ["QDRANT_API_KEY"]
    )

    try:
        # Update job status to processing
        supabase.table("pdf_processing_jobs").update({
            "status": "processing",
            "progress": 0,
            "started_at": "now()"
        }).eq("id", job_id).execute()

        # Step 1: Download PDF from Supabase Storage (10%)
        response = supabase.storage.from_("books").download(storage_path)
        pdf_bytes = response

        supabase.table("pdf_processing_jobs").update({
            "progress": 10
        }).eq("id", job_id).execute()

        # Step 2: Extract text with LlamaParse (30%)
        parser = LlamaParse(
            api_key=os.environ["LLAMA_CLOUD_API_KEY"],
            result_type="markdown",  # Get structured markdown
            verbose=True
        )

        # Save PDF temporarily
        temp_path = f"/tmp/{job_id}.pdf"
        with open(temp_path, "wb") as f:
            f.write(pdf_bytes)

        # Parse PDF
        documents = parser.load_data(temp_path)
        full_text = "\n\n".join([doc.text for doc in documents])

        supabase.table("pdf_processing_jobs").update({
            "progress": 30
        }).eq("id", job_id).execute()

        # Step 3: Split into chunks (40%)
        chunks = split_into_chunks(full_text, chunk_size=500, overlap=50)
        total_chunks = len(chunks)

        supabase.table("pdf_processing_jobs").update({
            "progress": 40,
            "total_chunks": total_chunks
        }).eq("id", job_id).execute()

        # Step 4: Generate embeddings (40-80%)
        model = SentenceTransformer('all-MiniLM-L6-v2')

        points = []
        for i, chunk in enumerate(chunks):
            embedding = model.encode(chunk, convert_to_numpy=True).tolist()

            points.append(PointStruct(
                id=str(uuid.uuid4()),
                vector=embedding,
                payload={
                    "text": chunk,
                    "book_id": book_id,
                    "chunk_index": i,
                    "total_chunks": total_chunks
                }
            ))

            # Update progress every 10 chunks
            if (i + 1) % 10 == 0 or i == total_chunks - 1:
                progress = 40 + int((i + 1) / total_chunks * 40)
                supabase.table("pdf_processing_jobs").update({
                    "progress": progress,
                    "chunks_processed": i + 1
                }).eq("id", job_id).execute()

        # Step 5: Store in Qdrant (80-95%)
        collection_name = "pdf_embeddings"

        # Create collection if doesn't exist
        try:
            qdrant.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(size=384, distance=Distance.COSINE)
            )
        except Exception:
            pass  # Collection exists

        # Batch upload (more efficient)
        qdrant.upsert(
            collection_name=collection_name,
            points=points
        )

        supabase.table("pdf_processing_jobs").update({
            "progress": 95
        }).eq("id", job_id).execute()

        # Step 6: Mark as completed (100%)
        supabase.table("pdf_processing_jobs").update({
            "status": "completed",
            "progress": 100,
            "completed_at": "now()"
        }).eq("id", job_id).execute()

        supabase.table("books").update({
            "processing_status": "completed"
        }).eq("id", book_id).execute()

        # Cleanup
        os.remove(temp_path)

        return {
            "success": True,
            "chunks_processed": total_chunks,
            "book_id": book_id
        }

    except Exception as e:
        # Mark as failed
        error_msg = str(e)
        supabase.table("pdf_processing_jobs").update({
            "status": "failed",
            "error_message": error_msg
        }).eq("id", job_id).execute()

        supabase.table("books").update({
            "processing_status": "failed"
        }).eq("id", book_id).execute()

        return {
            "success": False,
            "error": error_msg
        }


def split_into_chunks(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """Split text into overlapping chunks by words."""
    words = text.split()
    chunks = []

    i = 0
    while i < len(words):
        chunk_words = words[i:i + chunk_size]
        chunks.append(" ".join(chunk_words))

        if len(chunk_words) < chunk_size:
            break  # Last chunk

        i += chunk_size - overlap

    return chunks


# Expose as web endpoint
@app.function(image=image)
@modal.web_endpoint(method="POST")
def process_pdf_webhook(data: Dict):
    """
    Web endpoint that Next.js will call.
    Spawns the processing function asynchronously.
    """
    book_id = data["book_id"]
    job_id = data["job_id"]
    storage_path = data["storage_path"]

    # Spawn async processing
    process_pdf.spawn(book_id, job_id, storage_path)

    return {
        "success": True,
        "message": "Processing started",
        "job_id": job_id
    }
