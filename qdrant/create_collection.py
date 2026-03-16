#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error, parse, request


DEFAULT_COLLECTION_NAME = "class_content_embeddings"
DEFAULT_VECTOR_SIZE = 1024
DEFAULT_DISTANCE = "Cosine"
ENV_FILE_PATH = Path(__file__).with_name(".env")


@dataclass(frozen=True)
class PayloadIndex:
    field_name: str
    field_schema: str


DEFAULT_INDEXES = [
    PayloadIndex(field_name="class_id", field_schema="uuid"),
    PayloadIndex(field_name="content_type", field_schema="keyword"),
    PayloadIndex(field_name="source_id", field_schema="uuid"),
    PayloadIndex(field_name="page_number", field_schema="integer"),
]


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


def build_headers(api_key: str | None) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["api-key"] = api_key
    return headers


def qdrant_request(
    *,
    method: str,
    base_url: str,
    path: str,
    api_key: str | None,
    payload: dict[str, Any] | None = None,
    ssl_context: ssl.SSLContext | None = None,
) -> tuple[int, dict[str, Any] | None]:
    url = parse.urljoin(f"{base_url.rstrip('/')}/", path.lstrip("/"))
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = request.Request(
        url=url,
        method=method,
        data=data,
        headers=build_headers(api_key),
    )

    try:
        with request.urlopen(req, context=ssl_context) as response:
            raw_body = response.read().decode("utf-8").strip()
            return response.status, json.loads(raw_body) if raw_body else None
    except error.HTTPError as exc:
        raw_body = exc.read().decode("utf-8").strip()
        body = json.loads(raw_body) if raw_body else None
        return exc.code, body


def collection_exists(
    *,
    base_url: str,
    collection: str,
    api_key: str | None,
    ssl_context: ssl.SSLContext | None,
) -> bool:
    status, _ = qdrant_request(
        method="GET",
        base_url=base_url,
        path=f"/collections/{collection}",
        api_key=api_key,
        ssl_context=ssl_context,
    )
    if status == 200:
        return True
    if status == 404:
        return False
    raise RuntimeError(f"Failed to check collection existence: HTTP {status}")


def create_collection(
    *,
    base_url: str,
    collection: str,
    api_key: str | None,
    vector_size: int,
    distance: str,
    ssl_context: ssl.SSLContext | None,
) -> None:
    status, body = qdrant_request(
        method="PUT",
        base_url=base_url,
        path=f"/collections/{collection}",
        api_key=api_key,
        payload={
            "vectors": {
                "size": vector_size,
                "distance": distance,
            }
        },
        ssl_context=ssl_context,
    )
    if status not in {200}:
        raise RuntimeError(f"Failed to create collection: HTTP {status} {body}")


def delete_collection(
    *,
    base_url: str,
    collection: str,
    api_key: str | None,
    ssl_context: ssl.SSLContext | None,
) -> None:
    status, body = qdrant_request(
        method="DELETE",
        base_url=base_url,
        path=f"/collections/{collection}",
        api_key=api_key,
        ssl_context=ssl_context,
    )
    if status not in {200}:
        raise RuntimeError(f"Failed to delete collection: HTTP {status} {body}")


def create_payload_index(
    *,
    base_url: str,
    collection: str,
    api_key: str | None,
    index: PayloadIndex,
    ssl_context: ssl.SSLContext | None,
) -> None:
    status, body = qdrant_request(
        method="PUT",
        base_url=base_url,
        path=f"/collections/{collection}/index",
        api_key=api_key,
        payload={
            "field_name": index.field_name,
            "field_schema": index.field_schema,
        },
        ssl_context=ssl_context,
    )
    if status not in {200}:
        raise RuntimeError(
            f"Failed to create payload index for {index.field_name}: HTTP {status} {body}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create the shared Qdrant collection and payload indexes for Smart Learn."
    )
    parser.add_argument(
        "--env-file",
        default=str(ENV_FILE_PATH),
        help="Env file to load before reading CLI args or process env.",
    )
    parser.add_argument(
        "--url",
        default=None,
        help="Qdrant base URL. Defaults to QDRANT_URL after env-file load.",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="Qdrant API key. Defaults to QDRANT_API_KEY after env-file load.",
    )
    parser.add_argument(
        "--collection",
        default=DEFAULT_COLLECTION_NAME,
        help=f"Collection name. Defaults to {DEFAULT_COLLECTION_NAME}.",
    )
    parser.add_argument(
        "--vector-size",
        type=int,
        default=DEFAULT_VECTOR_SIZE,
        help=f"Embedding vector size. Defaults to {DEFAULT_VECTOR_SIZE}.",
    )
    parser.add_argument(
        "--distance",
        default=DEFAULT_DISTANCE,
        help=f"Vector distance metric. Defaults to {DEFAULT_DISTANCE}.",
    )
    parser.add_argument(
        "--recreate",
        action="store_true",
        help="Delete and recreate the collection before creating indexes.",
    )
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="Disable TLS certificate verification. Use only if your local Python trust store is broken.",
    )
    return parser.parse_args()


def build_ssl_context(*, insecure: bool) -> ssl.SSLContext:
    if insecure:
        return ssl._create_unverified_context()

    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def main() -> int:
    args = parse_args()

    load_env_file(Path(args.env_file))
    ssl_context = build_ssl_context(insecure=args.insecure)

    qdrant_url = args.url or os.environ.get("QDRANT_URL")
    qdrant_api_key = args.api_key or os.environ.get("QDRANT_API_KEY")

    if not qdrant_url:
        print("Missing QDRANT_URL. Set it in qdrant/.env or pass --url.", file=sys.stderr)
        return 1

    try:
        exists = collection_exists(
            base_url=qdrant_url,
            collection=args.collection,
            api_key=qdrant_api_key,
            ssl_context=ssl_context,
        )

        if exists and args.recreate:
            print(f"Deleting collection: {args.collection}")
            delete_collection(
                base_url=qdrant_url,
                collection=args.collection,
                api_key=qdrant_api_key,
                ssl_context=ssl_context,
            )
            exists = False

        if not exists:
            print(f"Creating collection: {args.collection}")
            create_collection(
                base_url=qdrant_url,
                collection=args.collection,
                api_key=qdrant_api_key,
                vector_size=args.vector_size,
                distance=args.distance,
                ssl_context=ssl_context,
            )
        else:
            print(f"Collection already exists: {args.collection}")

        for index in DEFAULT_INDEXES:
            print(f"Creating payload index: {index.field_name} ({index.field_schema})")
            create_payload_index(
                base_url=qdrant_url,
                collection=args.collection,
                api_key=qdrant_api_key,
                index=index,
                ssl_context=ssl_context,
            )
    except Exception as exc:
        print(f"Qdrant setup failed: {exc}", file=sys.stderr)
        return 1

    print("Qdrant collection and indexes are ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
