#!/usr/bin/env python3
"""Copy a legacy dense-only collection into a hybrid (dense + BM25) collection.

    python qdrant/migrate_to_hybrid.py --src class_content_embeddings --dst class_content_embeddings_v2

Existing Gemini embeddings are copied as-is into the named `dense` vector (no re-embedding,
no API cost). A BM25 sparse vector is computed locally from `payload.text`. Point ids and
payloads are preserved, so anything that referenced a chunk id still resolves.
Re-running is safe: upserts overwrite by id.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Sequence

QDRANT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(QDRANT_DIR))
sys.path.insert(0, str(QDRANT_DIR.parent / "modal"))

from create_collection import (  # noqa: E402
    DEFAULT_DISTANCE,
    DEFAULT_VECTOR_SIZE,
    DENSE_VECTOR_NAME,
    ENV_FILE_PATH,
    SPARSE_VECTOR_NAME,
    indexes_for,
    load_env_file,
)


def extract_dense_vector(vector: Any) -> List[float]:
    """Source points may store an unnamed vector (legacy) or a named `dense` one."""
    if isinstance(vector, dict):
        if DENSE_VECTOR_NAME not in vector:
            raise ValueError(f"source point has named vectors {sorted(vector)} but no '{DENSE_VECTOR_NAME}'")
        vector = vector[DENSE_VECTOR_NAME]
    if not isinstance(vector, (list, tuple)) or not vector:
        raise ValueError("source point has no dense vector (scroll with with_vectors=True)")
    return [float(value) for value in vector]


def build_hybrid_points(records: Sequence[Any], sparse_vectors: Sequence[Any]) -> List[Any]:
    from qdrant_client.models import PointStruct

    if len(records) != len(sparse_vectors):
        raise ValueError("records and sparse vectors differ in length")

    return [
        PointStruct(
            id=record.id,
            vector={DENSE_VECTOR_NAME: extract_dense_vector(record.vector), SPARSE_VECTOR_NAME: sparse},
            payload=dict(record.payload or {}),
        )
        for record, sparse in zip(records, sparse_vectors)
    ]


def ensure_hybrid_collection(client: Any, name: str, *, vector_size: int) -> None:
    from qdrant_client.models import (
        Distance,
        Modifier,
        PayloadSchemaType,
        SparseVectorParams,
        VectorParams,
    )

    if not client.collection_exists(name):
        print(f"Creating hybrid collection: {name}")
        client.create_collection(
            collection_name=name,
            vectors_config={DENSE_VECTOR_NAME: VectorParams(size=vector_size, distance=Distance(DEFAULT_DISTANCE))},
            sparse_vectors_config={SPARSE_VECTOR_NAME: SparseVectorParams(modifier=Modifier.IDF)},
        )
    else:
        info = client.get_collection(name)
        if SPARSE_VECTOR_NAME not in (info.config.params.sparse_vectors or {}):
            raise RuntimeError(f"{name} exists but has no '{SPARSE_VECTOR_NAME}' sparse vector")
        print(f"Collection already exists: {name}")

    for index in indexes_for(hybrid=True):
        client.create_payload_index(
            collection_name=name,
            field_name=index.field_name,
            field_schema=PayloadSchemaType(index.field_schema),
        )


def migrate(client: Any, *, src: str, dst: str, batch_size: int, dry_run: bool) -> Dict[str, int]:
    from lib.sparse import encode_sparse_documents

    if src == dst:
        raise ValueError("--src and --dst must differ")
    if not client.collection_exists(src):
        raise RuntimeError(f"source collection not found: {src}")

    if not dry_run:
        ensure_hybrid_collection(client, dst, vector_size=DEFAULT_VECTOR_SIZE)

    copied = 0
    empty_text = 0
    offset = None
    while True:
        records, offset = client.scroll(
            collection_name=src,
            limit=batch_size,
            offset=offset,
            with_payload=True,
            with_vectors=True,
        )
        if not records:
            break

        texts = [str((record.payload or {}).get("text") or "") for record in records]
        empty_text += sum(1 for text in texts if not text.strip())
        points = build_hybrid_points(records, encode_sparse_documents(texts))

        if not dry_run:
            client.upsert(collection_name=dst, points=points, wait=True)
        copied += len(points)
        print(f"  {'checked' if dry_run else 'copied'} {copied} points")

        if offset is None:
            break

    return {"copied": copied, "empty_text": empty_text}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Copy a dense-only Qdrant collection into a hybrid one.")
    parser.add_argument("--src", default="class_content_embeddings")
    parser.add_argument("--dst", default="class_content_embeddings_v2")
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--dry-run", action="store_true", help="Scroll and encode, but write nothing.")
    parser.add_argument("--env-file", default=str(ENV_FILE_PATH))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env_file(Path(args.env_file))

    url = os.environ.get("QDRANT_URL")
    if not url:
        print("Missing QDRANT_URL. Set it in qdrant/.env.", file=sys.stderr)
        return 1

    from qdrant_client import QdrantClient

    client = QdrantClient(url=url, api_key=os.environ.get("QDRANT_API_KEY") or None, timeout=60)
    try:
        stats = migrate(client, src=args.src, dst=args.dst, batch_size=args.batch_size, dry_run=args.dry_run)
    except Exception as exc:
        print(f"Migration failed: {exc}", file=sys.stderr)
        return 1

    print(f"Done: {stats['copied']} points ({stats['empty_text']} with empty text) {args.src} -> {args.dst}")
    if not args.dry_run:
        print(f"Destination now holds {client.count(args.dst, exact=True).count} points")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
