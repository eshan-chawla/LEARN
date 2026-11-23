"""Search modes against qdrant-client's in-memory mode (no network, no Gemini)."""
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

import jobs.search_content as search_module
from jobs.search_content import build_search_filter, run_search

CLASS_A = "aaaaaaaa-0000-0000-0000-000000000000"
CLASS_B = "bbbbbbbb-0000-0000-0000-000000000000"
VOCAB = ["chain", "rule", "softmax", "attention", "gradient", "dropout"]

DOCS = [
    # id, class, dense vector (4-d), text
    (1, CLASS_A, [1.0, 0.0, 0.0, 0.0], "chain rule for gradient"),
    (2, CLASS_A, [0.9, 0.1, 0.0, 0.0], "gradient descent steps"),
    (3, CLASS_A, [0.0, 1.0, 0.0, 0.0], "softmax attention weights"),
    (4, CLASS_A, [0.0, 0.0, 1.0, 0.0], "dropout regularization chain"),
    (5, CLASS_B, [1.0, 0.0, 0.0, 0.0], "chain rule other class"),
]


def fake_sparse(text: str) -> SparseVector:
    words = text.lower().split()
    indices = sorted({VOCAB.index(word) for word in words if word in VOCAB})
    return SparseVector(indices=indices, values=[1.0] * len(indices))


def payload(doc_id, class_id, text):
    return {"class_id": class_id, "content_type": "pdf", "source_id": f"src-{doc_id}", "text": text, "page_number": doc_id}


@pytest.fixture(autouse=True)
def clear_layout_cache():
    search_module._HYBRID_LAYOUT_CACHE.clear()


@pytest.fixture
def client():
    qdrant = QdrantClient(":memory:")
    qdrant.create_collection("legacy", vectors_config=VectorParams(size=4, distance=Distance.COSINE))
    qdrant.upsert("legacy", points=[PointStruct(id=i, vector=v, payload=payload(i, c, t)) for i, c, v, t in DOCS])

    qdrant.create_collection(
        "hybrid",
        vectors_config={"dense": VectorParams(size=4, distance=Distance.COSINE)},
        sparse_vectors_config={"bm25": SparseVectorParams(modifier=Modifier.IDF)},
    )
    qdrant.upsert(
        "hybrid",
        points=[
            PointStruct(id=i, vector={"dense": v, "bm25": fake_sparse(t)}, payload=payload(i, c, t))
            for i, c, v, t in DOCS
        ],
    )
    return qdrant


def search(client, collection, mode, query="chain rule", query_vector=(1.0, 0.0, 0.0, 0.0), **kwargs):
    return run_search(
        client,
        query=query,
        class_id=kwargs.pop("class_id", CLASS_A),
        mode=mode,
        collection_name=collection,
        embed_query=lambda _q: list(query_vector),
        embed_sparse_query=fake_sparse,
        **kwargs,
    )


# --- dense mode is the A1 baseline and must not change -------------------------------


def test_dense_mode_matches_pre_hybrid_search_exactly(client):
    """Pins A1: same call the old code made (unnamed vector, same filter, same kwargs)."""
    query_filter = build_search_filter(class_id=CLASS_A, content_types=None, source_ids=None)
    expected = client.search(
        collection_name="legacy",
        query_vector=[1.0, 0.0, 0.0, 0.0],
        query_filter=query_filter,
        limit=3,
        with_payload=True,
        with_vectors=False,
    )
    result = search(client, "legacy", "dense", limit=3)

    assert [hit["sourceId"] for hit in result["hits"]] == [hit.payload["source_id"] for hit in expected]
    assert [hit["score"] for hit in result["hits"]] == [float(hit.score) for hit in expected]


def test_dense_request_shape_is_unchanged_on_legacy_collection():
    class RecordingClient:
        def __init__(self):
            self.calls = []

        def collection_exists(self, name):
            return True

        def get_collection(self, name):
            from types import SimpleNamespace

            return SimpleNamespace(config=SimpleNamespace(params=SimpleNamespace(vectors=object(), sparse_vectors=None)))

        def search(self, **kwargs):
            self.calls.append(kwargs)
            return []

    recorder = RecordingClient()
    search(recorder, "legacy", "dense", limit=5)
    [call] = recorder.calls
    assert set(call) == {"collection_name", "query_vector", "query_filter", "limit", "with_payload", "with_vectors"}
    assert call["query_vector"] == [1.0, 0.0, 0.0, 0.0]  # unnamed, as before
    assert call["limit"] == 5 and call["with_payload"] is True and call["with_vectors"] is False


def test_dense_mode_works_on_hybrid_collection_with_same_ranking(client):
    legacy = search(client, "legacy", "dense", limit=4)
    hybrid_layout = search(client, "hybrid", "dense", limit=4)
    assert [h["sourceId"] for h in hybrid_layout["hits"]] == [h["sourceId"] for h in legacy["hits"]]


def test_default_mode_is_dense_and_is_echoed(client):
    result = run_search(
        client, query="q", class_id=CLASS_A, collection_name="legacy", embed_query=lambda _q: [1.0, 0, 0, 0]
    )
    assert result["mode"] == "dense"
    assert result["success"] is True


# --- hybrid mode -------------------------------------------------------------------------


def test_hybrid_mode_echoes_mode_and_respects_class_filter(client):
    result = search(client, "hybrid", "hybrid", limit=10)
    assert result["mode"] == "hybrid"
    assert result["hits"], "expected fused hits"
    assert {hit["classId"] for hit in result["hits"]} == {CLASS_A}


def test_hybrid_lifts_keyword_match_that_dense_ranks_low(client):
    # Dense query points at "softmax" (doc 3) but the words say "dropout chain" (doc 4).
    dense = search(client, "hybrid", "dense", query="dropout chain", query_vector=(0.0, 1.0, 0.0, 0.0), limit=4)
    hybrid = search(client, "hybrid", "hybrid", query="dropout chain", query_vector=(0.0, 1.0, 0.0, 0.0), limit=4)

    dense_rank = [h["sourceId"] for h in dense["hits"]].index("src-4")
    hybrid_rank = [h["sourceId"] for h in hybrid["hits"]].index("src-4")
    assert hybrid_rank < dense_rank


def test_hybrid_on_legacy_collection_fails_loudly(client):
    with pytest.raises(ValueError, match="hybrid"):
        search(client, "legacy", "hybrid")


def test_unknown_mode_rejected(client):
    with pytest.raises(ValueError, match="mode"):
        search(client, "legacy", "sparse")
