"""BM25 sparse vectors for hybrid retrieval.

Uses fastembed's `Qdrant/bm25` model, which emits term-frequency weights per hashed token.
The collection's sparse vector is created with the `idf` modifier, so Qdrant applies IDF
at query time from the collection statistics; nothing here depends on corpus statistics.
That is why the migration can compute these vectors chunk by chunk without re-embedding.

The model is injectable (`model=`) so unit tests run without downloading anything.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Iterable, List, Protocol, Sequence

BM25_MODEL_NAME = "Qdrant/bm25"


class _SparseEmbedding(Protocol):
    indices: Any
    values: Any


class SparseModel(Protocol):
    def embed(self, documents: Iterable[str], batch_size: int = ...) -> Iterable[_SparseEmbedding]: ...

    def query_embed(self, query: str) -> Iterable[_SparseEmbedding]: ...


@lru_cache(maxsize=1)
def get_bm25_model() -> SparseModel:
    from fastembed import SparseTextEmbedding

    return SparseTextEmbedding(BM25_MODEL_NAME)


def to_sparse_vector(embedding: _SparseEmbedding):
    """Convert a fastembed SparseEmbedding (numpy arrays) into a Qdrant SparseVector."""
    from qdrant_client.models import SparseVector

    return SparseVector(
        indices=[int(index) for index in embedding.indices],
        values=[float(value) for value in embedding.values],
    )


def encode_sparse_documents(
    texts: Sequence[str],
    *,
    model: SparseModel | None = None,
    batch_size: int = 64,
) -> List[Any]:
    """One SparseVector per text, in order. Empty texts give an empty vector."""
    if not texts:
        return []

    bm25 = model or get_bm25_model()
    vectors = [to_sparse_vector(embedding) for embedding in bm25.embed(list(texts), batch_size=batch_size)]
    if len(vectors) != len(texts):
        raise ValueError("BM25 model returned an unexpected number of sparse vectors")
    return vectors


def encode_sparse_query(text: str, *, model: SparseModel | None = None):
    bm25 = model or get_bm25_model()
    [embedding] = list(bm25.query_embed(text))
    return to_sparse_vector(embedding)
