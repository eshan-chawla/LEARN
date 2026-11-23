"""Runs the migration against qdrant-client's in-memory mode: no network, no API key."""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "modal"))

import migrate_to_hybrid as mig  # noqa: E402


@dataclass
class FakeEmbedding:
    indices: list
    values: list


class FakeBM25:
    def embed(self, documents, batch_size=64):
        return [
            FakeEmbedding([len(document) % 97], [1.0]) if document else FakeEmbedding([], [])
            for document in documents
        ]


@pytest.fixture(autouse=True)
def fake_bm25(monkeypatch):
    import lib.sparse

    monkeypatch.setattr(lib.sparse, "get_bm25_model", lambda: FakeBM25())


def test_extract_dense_vector_accepts_unnamed_and_named():
    assert mig.extract_dense_vector([1, 2]) == [1.0, 2.0]
    assert mig.extract_dense_vector({"dense": [0.5]}) == [0.5]
    with pytest.raises(ValueError):
        mig.extract_dense_vector({"other": [0.5]})
    with pytest.raises(ValueError):
        mig.extract_dense_vector(None)


def test_build_points_preserves_id_payload_and_dense_vector():
    from qdrant_client.models import SparseVector

    sparse = SparseVector(indices=[1], values=[1.0])
    record = SimpleNamespace(id="11111111-1111-1111-1111-111111111111", vector=[0.1, 0.2], payload={"text": "hi"})
    [point] = mig.build_hybrid_points([record], [sparse])
    assert point.id == record.id
    assert point.payload == {"text": "hi"}
    assert point.vector == {"dense": [0.1, 0.2], "bm25": sparse}


def _legacy_collection(n: int):
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, PointStruct, VectorParams

    client = QdrantClient(":memory:")
    client.create_collection("legacy", vectors_config=VectorParams(size=768, distance=Distance.COSINE))
    client.upsert(
        "legacy",
        points=[
            PointStruct(id=i, vector=[float(i + 1)] + [0.0] * 767, payload={"text": f"chunk {i}", "class_id": "c"})
            for i in range(n)
        ],
    )
    return client


def test_migrate_copies_every_point_with_both_vectors():
    client = _legacy_collection(5)
    stats = mig.migrate(client, src="legacy", dst="hybrid", batch_size=2, dry_run=False)

    assert stats == {"copied": 5, "empty_text": 0}
    assert client.count("hybrid", exact=True).count == 5
    [point] = client.retrieve("hybrid", ids=[3], with_vectors=True, with_payload=True)
    assert point.payload["text"] == "chunk 3"
    assert set(point.vector) == {"dense", "bm25"}


def test_dry_run_writes_nothing():
    client = _legacy_collection(3)
    stats = mig.migrate(client, src="legacy", dst="hybrid", batch_size=10, dry_run=True)
    assert stats["copied"] == 3
    assert not client.collection_exists("hybrid")


def test_same_src_and_dst_rejected():
    with pytest.raises(ValueError):
        mig.migrate(_legacy_collection(1), src="legacy", dst="legacy", batch_size=10, dry_run=False)
