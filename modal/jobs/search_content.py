from __future__ import annotations

import os
from typing import Any, Callable, Dict, List, Literal, Sequence

from lib.constants import DENSE_VECTOR_NAME, SPARSE_VECTOR_NAME, get_collection_name
from lib.embeddings import encode_query

SearchMode = Literal["dense", "hybrid"]
SEARCH_MODES = ("dense", "hybrid")
# Each hybrid prefetch over-fetches so RRF has enough candidates from both retrievers.
HYBRID_PREFETCH_MULTIPLIER = 4

# Collection layout does not change while a container is alive; avoid one extra
# get_collection round-trip per search.
_HYBRID_LAYOUT_CACHE: Dict[str, bool] = {}


def _build_optional_match_filter(key: str, values: Sequence[str]):
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    if not values:
        return None

    conditions = [FieldCondition(key=key, match=MatchValue(value=value)) for value in values]
    if len(conditions) == 1:
        return conditions[0]

    return Filter(should=conditions)


def build_search_filter(
    *,
    class_id: str,
    content_types: List[str] | None,
    source_ids: List[str] | None,
):
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    must_conditions: List[Any] = [
        FieldCondition(key="class_id", match=MatchValue(value=class_id)),
    ]

    content_type_filter = _build_optional_match_filter("content_type", content_types or [])
    if content_type_filter is not None:
        must_conditions.append(content_type_filter)

    source_id_filter = _build_optional_match_filter("source_id", source_ids or [])
    if source_id_filter is not None:
        must_conditions.append(source_id_filter)

    return Filter(must=must_conditions)


def _is_hybrid_collection(client: Any, collection_name: str) -> bool:
    if collection_name not in _HYBRID_LAYOUT_CACHE:
        from lib.vectors import collection_is_hybrid

        _HYBRID_LAYOUT_CACHE[collection_name] = collection_is_hybrid(client, collection_name)
    return _HYBRID_LAYOUT_CACHE[collection_name]


def format_hit(score: float, payload: Dict[str, Any] | None) -> Dict[str, Any]:
    payload = dict(payload or {})
    return {
        "score": float(score),
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
        # Set by modal/jobs/tag_concepts.py; [] for chunks that were never tagged.
        "conceptIds": [str(concept_id) for concept_id in payload.get("concept_ids") or []],
    }


def _dense_search(client: Any, *, collection_name: str, query_vector: List[float], query_filter: Any, limit: int):
    """A1 baseline. On a legacy collection this is byte-for-byte the pre-hybrid call."""
    from qdrant_client.models import NamedVector

    vector: Any = query_vector
    if _is_hybrid_collection(client, collection_name):
        vector = NamedVector(name=DENSE_VECTOR_NAME, vector=query_vector)

    return client.search(
        collection_name=collection_name,
        query_vector=vector,
        query_filter=query_filter,
        limit=limit,
        with_payload=True,
        with_vectors=False,
    )


def _hybrid_search(
    client: Any,
    *,
    collection_name: str,
    query_vector: List[float],
    sparse_vector: Any,
    query_filter: Any,
    limit: int,
):
    """A2+: dense and BM25 candidates, fused server-side with Reciprocal Rank Fusion."""
    from qdrant_client.models import Fusion, FusionQuery, Prefetch

    if not _is_hybrid_collection(client, collection_name):
        raise ValueError(
            f"Collection {collection_name} has no '{SPARSE_VECTOR_NAME}' sparse vector; "
            "hybrid mode needs a hybrid collection (see qdrant/migrate_to_hybrid.py)"
        )

    prefetch_limit = HYBRID_PREFETCH_MULTIPLIER * limit
    response = client.query_points(
        collection_name=collection_name,
        prefetch=[
            Prefetch(query=query_vector, using=DENSE_VECTOR_NAME, filter=query_filter, limit=prefetch_limit),
            Prefetch(query=sparse_vector, using=SPARSE_VECTOR_NAME, filter=query_filter, limit=prefetch_limit),
        ],
        query=FusionQuery(fusion=Fusion.RRF),
        query_filter=query_filter,
        limit=limit,
        with_payload=True,
        with_vectors=False,
    )
    return response.points


def run_search(
    client: Any,
    *,
    query: str,
    class_id: str,
    content_types: List[str] | None = None,
    source_ids: List[str] | None = None,
    limit: int = 8,
    mode: SearchMode = "dense",
    collection_name: str | None = None,
    embed_query: Callable[[str], List[float]] = encode_query,
    embed_sparse_query: Callable[[str], Any] | None = None,
) -> Dict[str, Any]:
    """Search with an explicit client. `search_content_impl` is the Modal entry point."""
    if mode not in SEARCH_MODES:
        raise ValueError(f"Unsupported search mode: {mode}")

    collection_name = collection_name or get_collection_name()
    query_filter = build_search_filter(class_id=class_id, content_types=content_types, source_ids=source_ids)
    query_vector = embed_query(query)

    if mode == "dense":
        hits = _dense_search(
            client,
            collection_name=collection_name,
            query_vector=query_vector,
            query_filter=query_filter,
            limit=limit,
        )
    else:
        if embed_sparse_query is None:
            from lib.sparse import encode_sparse_query

            embed_sparse_query = encode_sparse_query
        hits = _hybrid_search(
            client,
            collection_name=collection_name,
            query_vector=query_vector,
            sparse_vector=embed_sparse_query(query),
            query_filter=query_filter,
            limit=limit,
        )

    results = [format_hit(hit.score, hit.payload) for hit in hits]
    return {
        "success": True,
        # Echo the served mode: the TS client rejects a hybrid request whose response
        # doesn't say "hybrid", so an old webhook can't silently serve dense as A2.
        "mode": mode,
        "query": query,
        "class_id": class_id,
        "hits": results,
        "total": len(results),
    }


def search_content_impl(
    *,
    query: str,
    class_id: str,
    content_types: List[str] | None = None,
    source_ids: List[str] | None = None,
    limit: int = 8,
    mode: SearchMode = "dense",
) -> Dict[str, Any]:
    from qdrant_client import QdrantClient

    qdrant = QdrantClient(
        url=os.environ["QDRANT_URL"],
        api_key=os.environ.get("QDRANT_API_KEY") or None,
    )
    return run_search(
        qdrant,
        query=query,
        class_id=class_id,
        content_types=content_types,
        source_ids=source_ids,
        limit=limit,
        mode=mode,
    )
