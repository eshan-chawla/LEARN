"""Point-vector layout shared by ingestion jobs.

A legacy collection stores one unnamed dense vector per point. A hybrid collection
(qdrant/create_collection.py --hybrid, or qdrant/migrate_to_hybrid.py) stores a named
`dense` vector plus a named `bm25` sparse vector. Ingestion inspects the target collection
and writes whichever layout it has, so the same code serves both during the migration.
"""

from __future__ import annotations

from typing import Any, Callable, List, Sequence

from lib.constants import DENSE_VECTOR_NAME, SPARSE_VECTOR_NAME


def collection_is_hybrid(client: Any, collection_name: str) -> bool:
    """True when the collection exists and has named dense + sparse BM25 vectors."""
    if not client.collection_exists(collection_name):
        return False

    params = client.get_collection(collection_name).config.params
    vectors = params.vectors
    sparse_vectors = params.sparse_vectors or {}
    return isinstance(vectors, dict) and DENSE_VECTOR_NAME in vectors and SPARSE_VECTOR_NAME in sparse_vectors


def build_point_vectors(
    dense_embeddings: Sequence[List[float]],
    texts: Sequence[str],
    *,
    hybrid: bool,
    encode_sparse: Callable[[Sequence[str]], List[Any]] | None = None,
) -> List[Any]:
    """The `vector=` argument for each PointStruct, in order."""
    if len(dense_embeddings) != len(texts):
        raise ValueError("dense embeddings and texts differ in length")

    if not hybrid:
        return list(dense_embeddings)

    if encode_sparse is None:
        from lib.sparse import encode_sparse_documents

        encode_sparse = encode_sparse_documents

    sparse_vectors = encode_sparse(texts)
    return [
        {DENSE_VECTOR_NAME: dense, SPARSE_VECTOR_NAME: sparse}
        for dense, sparse in zip(dense_embeddings, sparse_vectors)
    ]
