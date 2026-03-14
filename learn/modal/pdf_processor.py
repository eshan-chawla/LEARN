"""
Modal function for PDF processing into a shared Qdrant collection.
Deploy with: modal deploy pdf_processor.py
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any, Dict, List

import modal


app = modal.App("pdf-processor")

image = (
    modal.Image.debian_slim()
    .pip_install(
        "boto3==1.34.131",
        "pypdf==4.2.0",
        "qdrant-client==1.7.0",
        "sentence-transformers==2.7.0",
        "supabase==2.3.0",
    )
)

SHARED_COLLECTION_NAME = "class_content_embeddings"


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("aws-s3-credentials"),
        modal.Secret.from_name("supabase-credentials"),
        modal.Secret.from_name("qdrant-credentials"),
        modal.Secret.from_name("modal-webhook-secret"),
    ],
    timeout=900,
    memory=2048,
)
def process_pdf(
    book_id: str,
    class_id: str,
    title: str,
    storage_path: str,
    file_name: str,
) -> Dict[str, Any]:
    """
    Process a PDF from S3, chunk per page, embed, and store in Qdrant.
    """
    import boto3
    from pypdf import PdfReader
    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        Distance,
        FieldCondition,
        Filter,
        MatchValue,
        PointStruct,
        VectorParams,
    )
    from sentence_transformers import SentenceTransformer
    from supabase import create_client

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )
    qdrant = QdrantClient(
        url=os.environ["QDRANT_URL"],
        api_key=os.environ.get("QDRANT_API_KEY") or None,
    )
    s3 = boto3.client(
        "s3",
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    )
    bucket_name = os.environ["AWS_S3_RECORDINGS_BUCKET"]

    temp_path = Path(f"/tmp/{book_id}.pdf")

    try:
        supabase.table("books").update(
            {
                "processing_status": "processing",
                "error_message": None,
            }
        ).eq("id", book_id).execute()

        s3.download_file(bucket_name, storage_path, str(temp_path))

        page_chunks = extract_page_chunks(temp_path)
        if not page_chunks:
            raise ValueError("No extractable text found in PDF")

        model = SentenceTransformer("all-MiniLM-L6-v2")
        points: List[PointStruct] = []

        for global_index, chunk in enumerate(page_chunks):
            embedding = model.encode(chunk["text"], convert_to_numpy=True).tolist()
            points.append(
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector=embedding,
                    payload={
                        "class_id": class_id,
                        "content_type": "pdf",
                        "source_id": book_id,
                        "title": title,
                        "file_name": file_name,
                        "storage_path": storage_path,
                        "page_number": chunk["page_number"],
                        "page_chunk_index": chunk["page_chunk_index"],
                        "chunk_index": global_index,
                        "text": chunk["text"],
                    },
                )
            )

        try:
            qdrant.create_collection(
                collection_name=SHARED_COLLECTION_NAME,
                vectors_config=VectorParams(size=384, distance=Distance.COSINE),
            )
        except Exception:
            pass

        qdrant.delete(
            collection_name=SHARED_COLLECTION_NAME,
            points_selector=Filter(
                must=[
                    FieldCondition(key="class_id", match=MatchValue(value=class_id)),
                    FieldCondition(key="content_type", match=MatchValue(value="pdf")),
                    FieldCondition(key="source_id", match=MatchValue(value=book_id)),
                ]
            ),
            wait=True,
        )

        qdrant.upsert(
            collection_name=SHARED_COLLECTION_NAME,
            points=points,
            wait=True,
        )

        supabase.table("books").update(
            {
                "processing_status": "completed",
                "error_message": None,
            }
        ).eq("id", book_id).execute()

        return {
            "success": True,
            "collection_name": SHARED_COLLECTION_NAME,
            "content_type": "pdf",
            "book_id": book_id,
            "class_id": class_id,
            "chunks_processed": len(points),
        }
    except Exception as exc:
        error_message = str(exc)
        supabase.table("books").update(
            {
                "processing_status": "failed",
                "error_message": error_message,
            }
        ).eq("id", book_id).execute()
        return {
            "success": False,
            "error": error_message,
            "book_id": book_id,
            "class_id": class_id,
        }
    finally:
        if temp_path.exists():
            temp_path.unlink()


def extract_page_chunks(pdf_path: Path, chunk_size: int = 500, overlap: int = 50) -> List[Dict[str, Any]]:
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    chunks: List[Dict[str, Any]] = []

    for page_index, page in enumerate(reader.pages):
        page_text = (page.extract_text() or "").strip()
        if not page_text:
            continue

        for page_chunk_index, chunk_text in enumerate(split_into_chunks(page_text, chunk_size=chunk_size, overlap=overlap)):
            chunks.append(
                {
                    "page_number": page_index + 1,
                    "page_chunk_index": page_chunk_index,
                    "text": chunk_text,
                }
            )

    return chunks


def split_into_chunks(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    words = text.split()
    chunks: List[str] = []
    index = 0

    while index < len(words):
        chunk_words = words[index : index + chunk_size]
        if not chunk_words:
            break

        chunks.append(" ".join(chunk_words))

        if len(chunk_words) < chunk_size:
            break

        index += chunk_size - overlap

    return chunks


@app.function(image=image, secrets=[modal.Secret.from_name("modal-webhook-secret")])
@modal.web_endpoint(method="POST")
def process_pdf_webhook(data: Dict[str, Any]) -> Dict[str, Any]:
    webhook_secret = os.environ["MODAL_WEBHOOK_SECRET"]
    request_secret = str(data.get("webhook_secret", ""))

    if not request_secret or request_secret != webhook_secret:
        return {
            "success": False,
            "error": "Unauthorized webhook request",
        }

    required_fields = ["book_id", "class_id", "title", "storage_path", "file_name"]
    missing_fields = [field for field in required_fields if not data.get(field)]
    if missing_fields:
        return {
            "success": False,
            "error": f"Missing required fields: {', '.join(missing_fields)}",
        }

    process_pdf.spawn(
        data["book_id"],
        data["class_id"],
        data["title"],
        data["storage_path"],
        data["file_name"],
    )

    return {
        "success": True,
        "message": "Processing started",
        "book_id": data["book_id"],
    }
