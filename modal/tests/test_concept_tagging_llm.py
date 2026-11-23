from __future__ import annotations

from jobs.tag_concepts import tag_texts
from lib.concept_tagging import build_llm_prompt, choose_concepts_with_llm, parse_llm_concepts

CONCEPTS = [
    {"id": "rnn", "name": "Recurrent neural network", "keywords": ["rnn"], "description": "Sequence model."},
    {"id": "lstm", "name": "LSTM", "keywords": ["lstm", "gate"]},
    {"id": "attention", "name": "Attention", "keywords": ["attention"]},
    {"id": "dropout", "name": "Dropout", "keywords": ["dropout"]},
    {"id": "relu", "name": "ReLU", "keywords": ["relu"]},
    {"id": "batch_norm", "name": "Batch normalization", "keywords": ["batchnorm"]},
]
VALID = [c["id"] for c in CONCEPTS]


class FakeComplete:
    def __init__(self, reply="", raises=False):
        self.reply = reply
        self.raises = raises
        self.prompts = []

    def __call__(self, prompt):
        self.prompts.append(prompt)
        if self.raises:
            raise RuntimeError("quota")
        return self.reply


def test_parse_plain_and_fenced_json():
    assert parse_llm_concepts('{"concept_ids": ["rnn", "lstm"]}', VALID) == ["rnn", "lstm"]
    assert parse_llm_concepts('```json\n{"concept_ids": ["lstm"]}\n```', VALID) == ["lstm"]
    assert parse_llm_concepts('["attention"]', VALID) == ["attention"]


def test_parse_drops_unknown_dedupes_and_caps_at_three():
    raw = '{"concept_ids": ["rnn", "made_up", "rnn", "lstm", "attention", "dropout"]}'
    assert parse_llm_concepts(raw, VALID) == ["rnn", "lstm", "attention"]


def test_parse_empty_list_is_a_valid_answer():
    assert parse_llm_concepts('{"concept_ids": []}', VALID) == []


def test_parse_malformed_returns_none():
    assert parse_llm_concepts("not json", VALID) is None
    assert parse_llm_concepts('{"ids": ["rnn"]}', VALID) is None
    assert parse_llm_concepts("", VALID) is None
    assert parse_llm_concepts(None, VALID) is None


def test_prompt_lists_catalog_and_keyword_hint():
    prompt = build_llm_prompt("text about gates", CONCEPTS, ["lstm"])
    assert "- rnn: Recurrent neural network. Sequence model." in prompt
    assert "candidates" in prompt and "lstm" in prompt
    assert "candidates" not in build_llm_prompt("text", CONCEPTS, [])


def test_model_error_returns_none():
    assert choose_concepts_with_llm("x", [], CONCEPTS, FakeComplete(raises=True)) is None


def test_llm_only_called_for_zero_or_too_many_matches():
    complete = FakeComplete('{"concept_ids": ["rnn"]}')

    def refine(text, keyword_ids):
        return choose_concepts_with_llm(text, keyword_ids, CONCEPTS, complete)

    texts = [
        "an rnn",  # 1 match: keyword result kept, no call
        "sequence modelling in general",  # 0 matches: LLM decides
        "rnn lstm attention dropout relu",  # 5 matches: LLM narrows
    ]
    tags, stats = tag_texts(texts, CONCEPTS, refine)

    assert len(complete.prompts) == 2
    assert tags == [["rnn"], ["rnn"], ["rnn"]]
    assert stats["keyword"] == 1 and stats["llm"] == 2


def test_failed_llm_keeps_keyword_result():
    def refine(text, keyword_ids):
        return choose_concepts_with_llm(text, keyword_ids, CONCEPTS, FakeComplete("garbage"))

    tags, stats = tag_texts(["rnn lstm attention dropout relu"], CONCEPTS, refine)
    assert tags == [["rnn", "lstm", "attention", "dropout", "relu"]]
    assert stats["llm_failed"] == 1
