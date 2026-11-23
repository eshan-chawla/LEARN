from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

import pytest

from lib.sparse import encode_sparse_documents, encode_sparse_query, to_sparse_vector


@dataclass
class FakeEmbedding:
    indices: List[int]
    values: List[float]


@dataclass
class FakeModel:
    """Stands in for fastembed: one index per distinct lowercase word."""

    calls: List[str] = field(default_factory=list)

    def _embed_one(self, text: str) -> FakeEmbedding:
        words = sorted(set(text.lower().split()))
        return FakeEmbedding([abs(hash(word)) % 10_000 for word in words], [1.5] * len(words))

    def embed(self, documents, batch_size=64):
        self.calls.append("embed")
        return [self._embed_one(document) for document in documents]

    def query_embed(self, query):
        self.calls.append("query_embed")
        yield self._embed_one(query)


def test_to_sparse_vector_converts_to_plain_python_numbers():
    import numpy as np

    vector = to_sparse_vector(FakeEmbedding(np.array([3, 7]), np.array([0.5, 1.25])))
    assert vector.indices == [3, 7]
    assert vector.values == [0.5, 1.25]
    assert all(type(index) is int for index in vector.indices)


def test_encode_documents_keeps_order_and_length():
    model = FakeModel()
    vectors = encode_sparse_documents(["chain rule", "softmax", ""], model=model)
    assert len(vectors) == 3
    assert len(vectors[0].indices) == 2
    assert vectors[2].indices == []


def test_encode_documents_empty_input_does_not_load_model():
    assert encode_sparse_documents([], model=None) == []


def test_query_uses_query_embedding_path():
    model = FakeModel()
    encode_sparse_query("chain rule", model=model)
    assert model.calls == ["query_embed"]


def test_length_mismatch_raises():
    class BrokenModel(FakeModel):
        def embed(self, documents, batch_size=64):
            return []

    with pytest.raises(ValueError):
        encode_sparse_documents(["a"], model=BrokenModel())
