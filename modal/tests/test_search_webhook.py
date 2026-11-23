from __future__ import annotations

import pytest

from jobs.search_content import format_hit
from webhooks.search_content import search_content_webhook_impl

SECRET = "test-secret"


@pytest.fixture(autouse=True)
def webhook_secret(monkeypatch):
    monkeypatch.setenv("MODAL_WEBHOOK_SECRET", SECRET)


class RecordingSearch:
    def __init__(self):
        self.calls = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return {"success": True, "mode": kwargs["mode"], "hits": [], "total": 0}


def body(**overrides):
    data = {"webhook_secret": SECRET, "query": "what is backprop", "class_id": "c1"}
    data.update(overrides)
    return data


def test_mode_defaults_to_dense_when_omitted():
    search = RecordingSearch()
    result = search_content_webhook_impl(body(), perform_search=search)
    assert result["success"] is True
    assert search.calls[0]["mode"] == "dense"


def test_dense_request_kwargs_are_the_old_ones_plus_mode():
    search = RecordingSearch()
    search_content_webhook_impl(body(limit=3, content_types=["pdf"]), perform_search=search)
    assert search.calls == [
        {
            "query": "what is backprop",
            "class_id": "c1",
            "content_types": ["pdf"],
            "source_ids": None,
            "limit": 3,
            "mode": "dense",
        }
    ]


@pytest.mark.parametrize("mode", ["dense", "hybrid", "HYBRID", " hybrid "])
def test_valid_modes_pass_through_normalized(mode):
    search = RecordingSearch()
    result = search_content_webhook_impl(body(mode=mode), perform_search=search)
    assert result["success"] is True
    assert search.calls[0]["mode"] == mode.strip().lower()


@pytest.mark.parametrize("mode", ["sparse", "", "bm25", 1, ["hybrid"], {"mode": "hybrid"}])
def test_invalid_mode_rejected_without_searching(mode):
    search = RecordingSearch()
    result = search_content_webhook_impl(body(mode=mode), perform_search=search)
    assert result == {"success": False, "error": "mode must be one of: dense, hybrid"}
    assert search.calls == []


def test_auth_is_checked_before_mode():
    search = RecordingSearch()
    result = search_content_webhook_impl(body(webhook_secret="wrong", mode="bogus"), perform_search=search)
    assert result["error"] == "Unauthorized webhook request"


def test_hybrid_response_echoes_mode():
    result = search_content_webhook_impl(body(mode="hybrid"), perform_search=RecordingSearch())
    assert result["mode"] == "hybrid"


def test_every_hit_has_concept_ids():
    assert format_hit(0.5, {"text": "t"})["conceptIds"] == []
    assert format_hit(0.5, {"text": "t", "concept_ids": None})["conceptIds"] == []
    assert format_hit(0.5, {"text": "t", "concept_ids": ["chain_rule", "backprop"]})["conceptIds"] == [
        "chain_rule",
        "backprop",
    ]
