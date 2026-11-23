import os

SHARED_COLLECTION_NAME = "class_content_embeddings"
EMBEDDING_MODEL_NAME = "gemini-embedding-001"
EMBEDDING_VECTOR_SIZE = 768
EMBEDDING_DOCUMENT_TASK_TYPE = "RETRIEVAL_DOCUMENT"
EMBEDDING_QUERY_TASK_TYPE = "RETRIEVAL_QUERY"
VIDEO_TRANSCRIPTS_PREFIX = "transcripts/videos"

# Named vectors in a hybrid collection (see qdrant/create_collection.py --hybrid).
DENSE_VECTOR_NAME = "dense"
SPARSE_VECTOR_NAME = "bm25"


def get_collection_name() -> str:
    """Active Qdrant collection. Switch collections (e.g. to the hybrid one) by changing
    the QDRANT_COLLECTION secret instead of redeploying code."""
    return os.environ.get("QDRANT_COLLECTION", "").strip() or SHARED_COLLECTION_NAME
