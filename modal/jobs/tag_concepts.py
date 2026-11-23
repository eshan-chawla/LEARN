#!/usr/bin/env python3
"""Write payload.concept_ids on every chunk of a Qdrant collection.

    python modal/jobs/tag_concepts.py --collection class_content_embeddings_hybrid_dev \\
        --graph data/concept_graph/dl_course.json [--class-id <uuid>] [--dry-run]

Runs locally (not on Modal) with QDRANT_URL / QDRANT_API_KEY from the environment or
qdrant/.env. Chunks with the same concept set are written in one set_payload call.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable, Dict, List, Sequence, Tuple

MODAL_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = MODAL_DIR.parent
if str(MODAL_DIR) not in sys.path:
    sys.path.insert(0, str(MODAL_DIR))

from lib.concept_tagging import build_matchers, keyword_tag, needs_llm_pass  # noqa: E402

# (chunk text, keyword matches) -> concept ids. Returning None keeps the keyword result.
Refiner = Callable[[str, List[str]], List[str] | None]


def load_concepts(graph_path: Path) -> List[Dict[str, Any]]:
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    concepts = graph.get("concepts") if isinstance(graph, dict) else None
    if not isinstance(concepts, list) or not concepts:
        raise ValueError(f"{graph_path} has no concepts list")
    return concepts


def tag_texts(
    texts: Sequence[str],
    concepts: Sequence[Dict[str, Any]],
    refine: Refiner | None = None,
) -> Tuple[List[List[str]], Counter]:
    """Concept ids per text plus counters of which pass decided each chunk."""
    matchers = build_matchers(concepts)
    stats: Counter = Counter()
    tags: List[List[str]] = []

    for text in texts:
        keyword_ids = keyword_tag(text, matchers)
        chosen = keyword_ids
        if refine is not None and needs_llm_pass(keyword_ids):
            refined = refine(text, keyword_ids)
            if refined is not None:
                chosen = refined
                stats["llm"] += 1
            else:
                stats["llm_failed"] += 1
        else:
            stats["keyword"] += 1
        stats["untagged" if not chosen else "tagged"] += 1
        tags.append(chosen)

    return tags, stats


def tag_collection(
    client: Any,
    *,
    collection: str,
    concepts: Sequence[Dict[str, Any]],
    class_id: str | None = None,
    refine: Refiner | None = None,
    batch_size: int = 256,
    dry_run: bool = False,
) -> Counter:
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    scroll_filter = (
        Filter(must=[FieldCondition(key="class_id", match=MatchValue(value=class_id))]) if class_id else None
    )
    totals: Counter = Counter()
    offset = None

    while True:
        records, offset = client.scroll(
            collection_name=collection,
            scroll_filter=scroll_filter,
            limit=batch_size,
            offset=offset,
            with_payload=["text"],
            with_vectors=False,
        )
        if not records:
            break

        texts = [str((record.payload or {}).get("text") or "") for record in records]
        tags, stats = tag_texts(texts, concepts, refine)
        totals.update(stats)

        groups: Dict[Tuple[str, ...], List[Any]] = defaultdict(list)
        for record, concept_ids in zip(records, tags):
            groups[tuple(concept_ids)].append(record.id)

        if not dry_run:
            for concept_ids, point_ids in groups.items():
                client.set_payload(
                    collection_name=collection,
                    payload={"concept_ids": list(concept_ids)},
                    points=point_ids,
                    wait=True,
                )
        totals["chunks"] += len(records)
        print(f"  {'checked' if dry_run else 'tagged'} {totals['chunks']} chunks")

        if offset is None:
            break

    return totals


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Tag Qdrant chunks with concept-graph ids.")
    parser.add_argument("--collection", required=True)
    parser.add_argument("--graph", default=str(REPO_DIR / "data" / "concept_graph" / "dl_course.json"))
    parser.add_argument("--class-id", default=None, help="Only tag chunks of this class.")
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--dry-run", action="store_true", help="Tag and report, but write nothing.")
    parser.add_argument("--env-file", default=str(REPO_DIR / "qdrant" / ".env"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    _load_env_file(Path(args.env_file))

    url = os.environ.get("QDRANT_URL")
    if not url:
        print("Missing QDRANT_URL.", file=sys.stderr)
        return 1

    from qdrant_client import QdrantClient

    client = QdrantClient(url=url, api_key=os.environ.get("QDRANT_API_KEY") or None, timeout=60)
    concepts = load_concepts(Path(args.graph))
    totals = tag_collection(
        client,
        collection=args.collection,
        concepts=concepts,
        class_id=args.class_id,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
    )
    print(json.dumps(dict(totals), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
