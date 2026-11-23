from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from eval_recall import evaluate, hit_matches, load_gold_items, render_markdown, score_item  # noqa: E402


def hit(file_name, page):
    return {"fileName": file_name, "pageNumber": page}


def test_hit_matches_file_and_page():
    gold = {"file_name": "lec09_attention.pdf", "page": 14}
    assert hit_matches(hit("lec09_attention.pdf", 14), gold)
    assert hit_matches(hit("LEC09_Attention.pdf", 14), gold)
    assert not hit_matches(hit("lec09_attention.pdf", 15), gold)
    assert not hit_matches(hit("lec10.pdf", 14), gold)
    assert not hit_matches({"fileName": None, "pageNumber": 14}, gold)


def test_gold_without_page_matches_any_page():
    assert hit_matches(hit("lec09.pdf", 3), {"file_name": "lec09.pdf"})


def test_score_item_recall_hit_and_rr():
    gold = [{"file_name": "a.pdf", "page": 1}, {"file_name": "b.pdf", "page": 2}]
    hits = [hit("x.pdf", 1), hit("b.pdf", 2), hit("y.pdf", 1)]
    assert score_item(hits, gold, k=5) == {"recall": 0.5, "hit": 1.0, "rr": 0.5}


def test_score_item_respects_k():
    gold = [{"file_name": "a.pdf", "page": 1}]
    hits = [hit("x.pdf", 1)] * 5 + [hit("a.pdf", 1)]
    assert score_item(hits, gold, k=5) == {"recall": 0.0, "hit": 0.0, "rr": 0.0}
    assert score_item(hits, gold, k=6)["rr"] == pytest.approx(1 / 6)


def test_evaluate_averages_per_mode():
    items = [
        {"id": "q1", "question": "q1", "gold_sources": [{"file_name": "a.pdf", "page": 1}]},
        {"id": "q2", "question": "q2", "gold_sources": [{"file_name": "b.pdf", "page": 2}]},
    ]

    def search(query, mode):
        if mode == "hybrid":
            return [hit("a.pdf", 1), hit("b.pdf", 2)]
        return [hit("a.pdf", 1)]

    per_item, summary = evaluate(items, search, k=5)
    assert summary["dense"]["recall"] == 0.5
    assert summary["hybrid"]["recall"] == 1.0
    assert summary["hybrid"]["rr"] == pytest.approx((1 + 0.5) / 2)

    markdown = render_markdown(per_item, summary, k=5, collection="c")
    assert "| dense | 0.500 | 0.500 | 0.500 |" in markdown
    assert "| q2 | 0.00 | 1.00 |" in markdown


def test_load_gold_items_skips_items_without_sources(tmp_path):
    path = tmp_path / "b.jsonl"
    path.write_text(
        "\n".join(
            json.dumps(item)
            for item in [
                {"id": "a", "question": "?", "gold_sources": [{"file_name": "x.pdf", "page": 1}]},
                {"id": "b", "question": "?", "gold_sources": []},
                {"id": "c", "question": "?"},
            ]
        )
        + "\n\n"
    )
    assert [item["id"] for item in load_gold_items(path)] == ["a"]
