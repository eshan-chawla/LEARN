from __future__ import annotations

from pathlib import Path

import pytest
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from jobs.tag_concepts import load_concepts, tag_collection, tag_texts
from lib.concept_tagging import build_matchers, keyword_tag, needs_llm_pass

CONCEPTS = [
    {"id": "rnn", "name": "Recurrent neural network", "keywords": ["rnn", "hidden state", "recurrence"]},
    {"id": "self_attention", "name": "Self-attention", "keywords": ["query", "key", "value"]},
    {"id": "loss_functions", "name": "Loss functions", "keywords": ["loss", "objective"]},
    {"id": "gradient_descent", "name": "Gradient descent", "keywords": ["learning rate", "gradient step"]},
    {"id": "relu", "name": "ReLU", "keywords": ["relu", "rectified linear unit"]},
]


@pytest.fixture(scope="module")
def matchers():
    return build_matchers(CONCEPTS)


def test_case_insensitive(matchers):
    assert keyword_tag("An RNN unrolls over time", matchers) == ["rnn"]
    assert keyword_tag("We apply relu then ReLU again", matchers) == ["relu"]


def test_plurals_match(matchers):
    assert keyword_tag("Both RNNs share weights", matchers) == ["rnn"]
    assert keyword_tag("Cross-entropy and MSE are common losses", matchers) == ["loss_functions"]
    assert "rnn" in keyword_tag("the hidden states are updated", matchers)


def test_no_match_inside_other_words(matchers):
    assert keyword_tag("Students learn by learning", matchers) == []
    assert keyword_tag("glossary and lossless compression", matchers) == []
    assert keyword_tag("keyboard monkeys", matchers) == []


def test_hyphen_and_space_are_interchangeable(matchers):
    assert keyword_tag("self attention layers", matchers) == ["self_attention"]
    assert keyword_tag("Self-Attention layers", matchers) == ["self_attention"]


def test_multi_word_keyword_needs_all_words_adjacent(matchers):
    assert keyword_tag("pick a learning rate", matchers) == ["gradient_descent"]
    assert keyword_tag("rate of learning", matchers) == []


def test_ordered_by_mentions_then_graph_order(matchers):
    text = "The loss goes down. The loss is the objective. An RNN is used."
    assert keyword_tag(text, matchers) == ["loss_functions", "rnn"]
    assert keyword_tag("rnn loss", matchers) == ["rnn", "loss_functions"]


def test_concepts_without_terms_are_skipped():
    assert build_matchers([{"id": "empty", "name": "", "keywords": []}]) == []


def test_needs_llm_pass_for_zero_or_too_many():
    assert needs_llm_pass([]) is True
    assert needs_llm_pass(["a"]) is False
    assert needs_llm_pass(["a", "b", "c", "d"]) is False
    assert needs_llm_pass(["a", "b", "c", "d", "e"]) is True


def test_tag_texts_without_refiner_keeps_keyword_result():
    tags, stats = tag_texts(["an rnn", "nothing here"], CONCEPTS)
    assert tags == [["rnn"], []]
    assert stats["tagged"] == 1 and stats["untagged"] == 1


def test_real_graph_loads_and_builds_matchers():
    graph = Path(__file__).resolve().parents[2] / "data" / "concept_graph" / "dl_course.json"
    concepts = load_concepts(graph)
    matchers = build_matchers(concepts)
    assert len(matchers) == len(concepts)  # every concept has at least its name
    assert "backprop" in keyword_tag("Backpropagation uses the chain rule on the computational graph", matchers)


def test_tag_collection_writes_concept_ids_in_memory():
    client = QdrantClient(":memory:")
    client.create_collection("c", vectors_config=VectorParams(size=2, distance=Distance.COSINE))
    client.upsert(
        "c",
        points=[
            PointStruct(id=1, vector=[1, 0], payload={"text": "RNNs keep a hidden state", "class_id": "x"}),
            PointStruct(id=2, vector=[1, 0], payload={"text": "a ReLU unit", "class_id": "x"}),
            PointStruct(id=3, vector=[1, 0], payload={"text": "unrelated", "class_id": "x"}),
            PointStruct(id=4, vector=[1, 0], payload={"text": "an RNN", "class_id": "other"}),
        ],
    )

    totals = tag_collection(client, collection="c", concepts=CONCEPTS, class_id="x", batch_size=2)
    assert totals["chunks"] == 3

    by_id = {p.id: p.payload for p in client.retrieve("c", ids=[1, 2, 3, 4], with_payload=True)}
    assert by_id[1]["concept_ids"] == ["rnn"]
    assert by_id[2]["concept_ids"] == ["relu"]
    assert by_id[3]["concept_ids"] == []
    assert "concept_ids" not in by_id[4]  # other class untouched
    assert by_id[1]["text"] == "RNNs keep a hidden state"  # set_payload merges, never replaces


def test_dry_run_writes_nothing():
    client = QdrantClient(":memory:")
    client.create_collection("c", vectors_config=VectorParams(size=2, distance=Distance.COSINE))
    client.upsert("c", points=[PointStruct(id=1, vector=[1, 0], payload={"text": "an rnn"})])
    tag_collection(client, collection="c", concepts=CONCEPTS, dry_run=True)
    [point] = client.retrieve("c", ids=[1], with_payload=True)
    assert "concept_ids" not in point.payload
