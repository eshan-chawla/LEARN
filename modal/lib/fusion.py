"""Reciprocal Rank Fusion (Cormack, Clarke & Buettcher, 2009).

    score(d) = sum over rankings r containing d of 1 / (k + rank_r(d)),  rank starting at 1

Qdrant computes the same thing server-side (FusionQuery(fusion=Fusion.RRF)). This pure
version is used in unit tests, in the Recall@5 analysis, and as a client-side fallback when
server-side fusion is unavailable.
"""

from __future__ import annotations

from typing import Dict, List, Sequence, Tuple

DEFAULT_RRF_K = 60


def rrf_fuse(rankings: Sequence[Sequence[str]], k: int = DEFAULT_RRF_K) -> List[Tuple[str, float]]:
    """Fuse ranked id lists into one list of (id, score), best first.

    - A duplicate id inside one ranking only counts at its best (first) position.
    - Ties are broken deterministically: better best-rank first, then first appearance
      (earlier ranking, then earlier position).
    """
    if k < 0:
        raise ValueError("k must be non-negative")

    scores: Dict[str, float] = {}
    best_rank: Dict[str, int] = {}
    first_seen: Dict[str, int] = {}
    order = 0

    for ranking in rankings:
        seen_here = set()
        for position, doc_id in enumerate(ranking, start=1):
            if doc_id in seen_here:
                continue
            seen_here.add(doc_id)

            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + position)
            best_rank[doc_id] = min(best_rank.get(doc_id, position), position)
            if doc_id not in first_seen:
                first_seen[doc_id] = order
                order += 1

    return sorted(scores.items(), key=lambda item: (-item[1], best_rank[item[0]], first_seen[item[0]]))
