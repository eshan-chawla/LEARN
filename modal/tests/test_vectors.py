from __future__ import annotations

import pytest
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    Modifier,
    PointStruct,
    SparseVector,
    SparseVectorParams,
    VectorParams,
)

from lib.vectors import build_point_vectors, collection_is_hybrid


def _fake_sparse(texts):
    return [SparseVector(indices=[len(text)], values=[1.0]) for text in texts]


@pytest.fixture
def client():
    qdrant = QdrantClient(":memory:")
    qdrant.create_collection("legacy", vectors_config=VectorParams(size=4, distance=Distance.COSINE))
    qdrant.create_collection(
        "hybrid",
        vectors_config={"dense": VectorParams(size=4, distance=Distance.COSINE)},
        sparse_vectors_config={"bm25": SparseVectorParams(modifier=Modifier.IDF)},
    )
    qdrant.create_collection("named_dense_only", vectors_config={"dense": VectorParams(size=4, distance=Distance.COSINE)})
    return qdrant


def test_detects_layouts(client):
    assert collection_is_hybrid(client, "hybrid") is True
    assert collection_is_hybrid(client, "legacy") is False
    assert collection_is_hybrid(client, "named_dense_only") is False
    assert collection_is_hybrid(client, "missing") is False


def test_legacy_vectors_are_the_dense_embeddings_unchanged():
    dense = [[1.0, 0, 0, 0], [0, 1.0, 0, 0]]
    assert build_point_vectors(dense, ["a", "b"], hybrid=False, encode_sparse=_fake_sparse) == dense


def test_hybrid_vectors_upsert_into_hybrid_collection(client):
    dense = [[1.0, 0, 0, 0], [0, 1.0, 0, 0]]
    vectors = build_point_vectors(dense, ["chain rule", "softmax"], hybrid=True, encode_sparse=_fake_sparse)
    assert set(vectors[0]) == {"dense", "bm25"}

    client.upsert("hybrid", points=[PointStruct(id=i, vector=v, payload={}) for i, v in enumerate(vectors)])
    assert client.count("hybrid", exact=True).count == 2


def test_length_mismatch_raises():
    with pytest.raises(ValueError):
        build_point_vectors([[1.0]], [], hybrid=False)
