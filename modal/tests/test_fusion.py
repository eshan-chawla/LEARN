from __future__ import annotations

import pytest

from lib.fusion import rrf_fuse


def ids(fused):
    return [doc_id for doc_id, _ in fused]


def test_single_ranking_preserves_order_and_scores():
    fused = rrf_fuse([["a", "b", "c"]], k=60)
    assert ids(fused) == ["a", "b", "c"]
    assert fused[0][1] == pytest.approx(1 / 61)
    assert fused[2][1] == pytest.approx(1 / 63)


def test_document_in_both_lists_beats_document_in_one():
    # "b" is 2nd in both lists; "a" and "x" are 1st in only one list each.
    fused = rrf_fuse([["a", "b"], ["x", "b"]], k=60)
    assert ids(fused)[0] == "b"
    assert fused[0][1] == pytest.approx(2 / 62)


def test_ties_break_by_first_appearance():
    # "a" and "x" both score 1/61; "a" appears first.
    assert ids(rrf_fuse([["a"], ["x"]])) == ["a", "x"]
    assert ids(rrf_fuse([["x"], ["a"]])) == ["x", "a"]


def test_ties_break_by_best_rank_before_appearance():
    # k=0: "x" = 1/1, "b" = 1/1, "a" = 1/2 + 1/2. All score exactly 1.0.
    # "a" is seen before "b", but "b" has the better best rank (1 vs 2).
    fused = rrf_fuse([["x", "a"], ["b", "a"]], k=0)
    assert [score for _, score in fused] == [1.0, 1.0, 1.0]
    assert ids(fused) == ["x", "b", "a"]


def test_duplicates_within_one_ranking_count_once():
    assert rrf_fuse([["a", "a", "b"]])[0][1] == pytest.approx(1 / 61)


def test_empty_inputs():
    assert rrf_fuse([]) == []
    assert rrf_fuse([[], []]) == []


def test_k_changes_weighting_of_top_ranks():
    # With small k, a single top-1 can beat two mid ranks; with large k it cannot.
    rankings = [["solo", "m1", "m2", "both"], ["x", "y", "z", "both"]]
    assert ids(rrf_fuse(rankings, k=0))[0] == "solo"
    assert ids(rrf_fuse(rankings, k=1000))[0] == "both"


def test_negative_k_rejected():
    with pytest.raises(ValueError):
        rrf_fuse([["a"]], k=-1)
