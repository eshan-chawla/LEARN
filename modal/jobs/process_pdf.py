from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any, Dict, List

from lib.chunking import extract_page_chunks
from lib.constants import (
    EMBEDDING_VECTOR_SIZE,
    SHARED_COLLECTION_NAME,
)
from lib.embeddings import encode_documents


def update_book_status(
    *,
    supabase_url: str,
    service_key: str,
    book_id: str,
    processing_status: str,
    error_message: str | None,
) -> None:
    import httpx

    response = httpx.patch(
        f"{supabase_url}/rest/v1/books",
        params={"id": f"eq.{book_id}"},
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json={
            "processing_status": processing_status,
            "error_message": error_message,
        },
        timeout=30.0,
    )
    response.raise_for_status()


def process_pdf_impl(
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
    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        Distance,
        FieldCondition,
        Filter,
        MatchValue,
        PointStruct,
        VectorParams,
    )

    supabase_url = os.environ["SUPABASE_URL"]
    supabase_service_key = os.environ["SUPABASE_SERVICE_KEY"]
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
        update_book_status(
            supabase_url=supabase_url,
            service_key=supabase_service_key,
            book_id=book_id,
            processing_status="processing",
            error_message=None,
        )

        s3.download_file(bucket_name, storage_path, str(temp_path))

        page_chunks = extract_page_chunks(temp_path)
        if not page_chunks:
            raise ValueError("No extractable text found in PDF")

        embeddings = encode_documents(
            [chunk["text"] for chunk in page_chunks],
            title=title,
        )
        points: List[PointStruct] = []

        for global_index, (chunk, embedding) in enumerate(zip(page_chunks, embeddings)):
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
                vectors_config=VectorParams(
                    size=EMBEDDING_VECTOR_SIZE,
                    distance=Distance.COSINE,
                ),
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

        update_book_status(
            supabase_url=supabase_url,
            service_key=supabase_service_key,
            book_id=book_id,
            processing_status="completed",
            error_message=None,
        )

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
        try:
            update_book_status(
                supabase_url=supabase_url,
                service_key=supabase_service_key,
                book_id=book_id,
                processing_status="failed",
                error_message=error_message,
            )
        except Exception:
            pass
        return {
            "success": False,
            "error": error_message,
            "book_id": book_id,
            "class_id": class_id,
        }
    finally:
        if temp_path.exists():
            temp_path.unlink()
