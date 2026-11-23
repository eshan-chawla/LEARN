from lib.constants import SHARED_COLLECTION_NAME, get_collection_name


def test_collection_defaults_to_shared_name(monkeypatch):
    monkeypatch.delenv("QDRANT_COLLECTION", raising=False)
    assert get_collection_name() == SHARED_COLLECTION_NAME


def test_collection_reads_env(monkeypatch):
    monkeypatch.setenv("QDRANT_COLLECTION", "class_content_embeddings_hybrid_dev")
    assert get_collection_name() == "class_content_embeddings_hybrid_dev"


def test_blank_env_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("QDRANT_COLLECTION", "  ")
    assert get_collection_name() == SHARED_COLLECTION_NAME
