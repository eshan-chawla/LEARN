from __future__ import annotations

import os
from typing import Any, Dict, List, Sequence

from lib.constants import SHARED_COLLECTION_NAME
from lib.embeddings import encode_query


def _build_optional_match_filter(key: str, values: Sequence[str]):
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    if not values:
        return None

    conditions = [FieldCondition(key=key, match=MatchValue(value=value)) for value in values]
    if len(conditions) == 1:
        return conditions[0]

    return Filter(should=conditions)


def search_content_impl(
    *,
    query: str,
    class_id: str,
    content_types: List[str] | None = None,
    source_ids: List[str] | None = None,
    limit: int = 8,
) -> Dict[str, Any]:
    from qdrant_client import QdrantClient
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    qdrant = QdrantClient(
        url=os.environ["QDRANT_URL"],
        api_key=os.environ.get("QDRANT_API_KEY") or None,
    )

    must_conditions: List[Any] = [
        FieldCondition(key="class_id", match=MatchValue(value=class_id)),
    ]

    content_type_filter = _build_optional_match_filter("content_type", content_types or [])
    if content_type_filter is not None:
        must_conditions.append(content_type_filter)

    source_id_filter = _build_optional_match_filter("source_id", source_ids or [])
    if source_id_filter is not None:
        must_conditions.append(source_id_filter)

    hits = qdrant.search(
        collection_name=SHARED_COLLECTION_NAME,
        query_vector=encode_query(query),
        query_filter=Filter(must=must_conditions),
        limit=limit,
        with_payload=True,
        with_vectors=False,
    )

    results: List[Dict[str, Any]] = []
    for hit in hits:
        payload = dict(hit.payload or {})
        results.append(
            {
                "score": float(hit.score),
                "text": payload.get("text", ""),
                "classId": payload.get("class_id"),
                "contentType": payload.get("content_type"),
                "sourceId": payload.get("source_id"),
                "title": payload.get("title"),
                "fileName": payload.get("file_name"),
                "storagePath": payload.get("storage_path"),
                "pageNumber": payload.get("page_number"),
                "pageChunkIndex": payload.get("page_chunk_index"),
                "chunkIndex": payload.get("chunk_index"),
                "startSeconds": payload.get("start_seconds"),
                "endSeconds": payload.get("end_seconds"),
                "transcriptChunkIndex": payload.get("transcript_chunk_index"),
                "transcriptLanguage": payload.get("transcript_language"),
            }
        )

    return {
        "success": True,
        "query": query,
        "class_id": class_id,
        "hits": results,
        "total": len(results),
    }
