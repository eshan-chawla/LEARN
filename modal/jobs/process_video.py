from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any, Dict, List

from lib.chunking import chunk_transcript_segments
from lib.constants import EMBEDDING_VECTOR_SIZE, SHARED_COLLECTION_NAME
from lib.embeddings import encode_documents
from lib.transcription import transcribe_media


def update_recording_status(
    *,
    supabase_url: str,
    service_key: str,
    recording_id: str,
    processing_status: str,
) -> None:
    import httpx

    response = httpx.patch(
        f"{supabase_url}/rest/v1/recordings",
        params={"id": f"eq.{recording_id}"},
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json={
            "processing_status": processing_status,
        },
        timeout=30.0,
    )
    response.raise_for_status()


def process_video_impl(
    recording_id: str,
    class_id: str,
    title: str,
    storage_path: str,
    file_name: str,
    duration: int | None = None,
) -> Dict[str, Any]:
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

    suffix = Path(storage_path).suffix or ".mp4"
    temp_path = Path(f"/tmp/{recording_id}{suffix}")

    try:
        update_recording_status(
            supabase_url=supabase_url,
            service_key=supabase_service_key,
            recording_id=recording_id,
            processing_status="processing",
        )

        s3.download_file(bucket_name, storage_path, str(temp_path))

        transcript_segments, transcript_language = transcribe_media(temp_path)
        if not transcript_segments:
            raise ValueError("No transcript could be extracted from this video")

        transcript_chunks = chunk_transcript_segments(transcript_segments)
        if not transcript_chunks:
            raise ValueError("No transcript chunks were produced from the recording")

        embeddings = encode_documents(
            [chunk["text"] for chunk in transcript_chunks],
            title=title,
        )
        points: List[PointStruct] = []

        for chunk_index, (chunk, embedding) in enumerate(zip(transcript_chunks, embeddings)):
            payload: Dict[str, Any] = {
                "class_id": class_id,
                "content_type": "video",
                "source_id": recording_id,
                "title": title,
                "file_name": file_name,
                "storage_path": storage_path,
                "start_seconds": chunk["start_seconds"],
                "end_seconds": chunk["end_seconds"],
                "transcript_chunk_index": chunk_index,
                "segment_start_index": chunk["segment_start_index"],
                "segment_end_index": chunk["segment_end_index"],
                "text": chunk["text"],
            }

            if transcript_language:
                payload["transcript_language"] = transcript_language

            if duration is not None:
                payload["duration_seconds"] = duration

            points.append(
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector=embedding,
                    payload=payload,
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
                    FieldCondition(key="content_type", match=MatchValue(value="video")),
                    FieldCondition(key="source_id", match=MatchValue(value=recording_id)),
                ]
            ),
            wait=True,
        )

        qdrant.upsert(
            collection_name=SHARED_COLLECTION_NAME,
            points=points,
            wait=True,
        )

        update_recording_status(
            supabase_url=supabase_url,
            service_key=supabase_service_key,
            recording_id=recording_id,
            processing_status="completed",
        )

        return {
            "success": True,
            "collection_name": SHARED_COLLECTION_NAME,
            "content_type": "video",
            "recording_id": recording_id,
            "class_id": class_id,
            "chunks_processed": len(points),
            "transcript_language": transcript_language,
        }
    except Exception as exc:
        try:
            update_recording_status(
                supabase_url=supabase_url,
                service_key=supabase_service_key,
                recording_id=recording_id,
                processing_status="failed",
            )
        except Exception:
            pass

        return {
            "success": False,
            "error": str(exc),
            "recording_id": recording_id,
            "class_id": class_id,
        }
    finally:
        if temp_path.exists():
            temp_path.unlink()
