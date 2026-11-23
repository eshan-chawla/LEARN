from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from create_collection import build_collection_config, indexes_for  # noqa: E402


def test_default_layout_is_unchanged_single_dense_vector():
    assert build_collection_config(vector_size=768, distance="Cosine", hybrid=False) == {
        "vectors": {"size": 768, "distance": "Cosine"}
    }


def test_hybrid_layout_has_named_dense_and_idf_sparse_vectors():
    config = build_collection_config(vector_size=768, distance="Cosine", hybrid=True)
    assert config["vectors"] == {"dense": {"size": 768, "distance": "Cosine"}}
    assert config["sparse_vectors"] == {"bm25": {"modifier": "idf"}}


def test_concept_ids_index_only_added_for_hybrid():
    legacy = {index.field_name for index in indexes_for(hybrid=False)}
    hybrid = {index.field_name: index.field_schema for index in indexes_for(hybrid=True)}
    assert "concept_ids" not in legacy
    assert hybrid["concept_ids"] == "keyword"
    assert legacy <= set(hybrid)
