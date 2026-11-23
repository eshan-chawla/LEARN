"""Tag lecture chunks with concept-graph ids.

Pass 1 (this module, pure): case-insensitive whole-word match of each concept's `name` and
`keywords` against the chunk text. Plurals ("gradients", "losses") match; matches inside other
words do not ("rnn" never matches "learn"/"learning"); hyphens and spaces are interchangeable
("self-attention" == "self attention").

Pass 2 (LLM fallback, see choose_concepts_with_llm) only runs for chunks where pass 1 found
0 concepts (nothing to go on) or more than MAX_KEYWORD_MATCHES (too generic to trust).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Pattern, Sequence

MAX_KEYWORD_MATCHES = 4
MAX_LLM_CONCEPTS = 3


@dataclass(frozen=True)
class ConceptMatcher:
    concept_id: str
    patterns: tuple[Pattern[str], ...]

    def count(self, text: str) -> int:
        return sum(len(pattern.findall(text)) for pattern in self.patterns)


def normalize_text(text: str) -> str:
    return re.sub(r"[\s\-_]+", " ", text.lower()).strip()


def term_pattern(term: str) -> Pattern[str] | None:
    words = normalize_text(term).split(" ")
    words = [word for word in words if word]
    if not words:
        return None

    body = r"[\s\-_]+".join(re.escape(word) for word in words)
    # Optional plural on the last word; word boundaries that treat digits as word chars.
    return re.compile(rf"(?<![a-z0-9]){body}(?:s|es)?(?![a-z0-9])")


def concept_terms(concept: Dict[str, Any]) -> List[str]:
    terms = [concept.get("name") or "", *(concept.get("keywords") or [])]
    seen: Dict[str, None] = {}
    for term in terms:
        normalized = normalize_text(str(term))
        if normalized:
            seen.setdefault(normalized, None)
    return list(seen)


def build_matchers(concepts: Iterable[Dict[str, Any]]) -> List[ConceptMatcher]:
    matchers: List[ConceptMatcher] = []
    for concept in concepts:
        patterns = tuple(p for p in (term_pattern(term) for term in concept_terms(concept)) if p is not None)
        if patterns:
            matchers.append(ConceptMatcher(concept_id=str(concept["id"]), patterns=patterns))
    return matchers


def keyword_tag(text: str, matchers: Sequence[ConceptMatcher]) -> List[str]:
    """Concept ids mentioned in `text`, most mentions first (ties keep graph order)."""
    normalized = normalize_text(text)
    counts = [(matcher.concept_id, matcher.count(normalized)) for matcher in matchers]
    hits = [(concept_id, count, order) for order, (concept_id, count) in enumerate(counts) if count > 0]
    return [concept_id for concept_id, _, _ in sorted(hits, key=lambda item: (-item[1], item[2]))]


def needs_llm_pass(keyword_ids: Sequence[str]) -> bool:
    return len(keyword_ids) == 0 or len(keyword_ids) > MAX_KEYWORD_MATCHES


# --- Pass 2: LLM fallback ---------------------------------------------------------------

LLM_TAGGING_MODEL = "gemini-2.5-flash-lite"
MAX_PROMPT_CHUNK_CHARS = 3000


def build_llm_prompt(text: str, concepts: Sequence[Dict[str, Any]], keyword_ids: Sequence[str]) -> str:
    catalog = "\n".join(
        f"- {concept['id']}: {concept.get('name', '')}. {concept.get('description') or ''}".rstrip()
        for concept in concepts
    )
    hint = (
        f"A keyword pass matched these candidates (may be too many or noisy): {', '.join(keyword_ids)}\n"
        if keyword_ids
        else ""
    )
    return (
        "You tag excerpts from deep-learning lecture material with the concepts they actually teach.\n"
        f"Pick at most {MAX_LLM_CONCEPTS} concept ids from the catalog, most central first. "
        "Only pick a concept the excerpt explains or uses substantively, not one it merely mentions. "
        "Return an empty list if none fit.\n\n"
        f"Catalog:\n{catalog}\n\n"
        f"{hint}"
        f"Excerpt:\n\"\"\"\n{text[:MAX_PROMPT_CHUNK_CHARS]}\n\"\"\"\n\n"
        'Answer with JSON only: {"concept_ids": ["<id>", ...]}'
    )


def _strip_json_fences(raw: str) -> str:
    stripped = raw.strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", stripped, flags=re.DOTALL | re.IGNORECASE)
    return fenced.group(1) if fenced else stripped


def parse_llm_concepts(raw: str, valid_ids: Iterable[str]) -> List[str] | None:
    """Tolerant parse. Unknown ids are dropped, duplicates removed, capped at
    MAX_LLM_CONCEPTS. Returns None when the output is unusable, so the caller keeps the
    keyword result instead of erasing tags because of one bad completion."""
    import json

    try:
        data = json.loads(_strip_json_fences(raw or ""))
    except (TypeError, ValueError):
        return None

    if isinstance(data, dict):
        data = data.get("concept_ids")
    if not isinstance(data, list):
        return None

    valid = set(valid_ids)
    chosen: List[str] = []
    for item in data:
        concept_id = str(item).strip()
        if concept_id in valid and concept_id not in chosen:
            chosen.append(concept_id)
    return chosen[:MAX_LLM_CONCEPTS]


def choose_concepts_with_llm(
    text: str,
    keyword_ids: Sequence[str],
    concepts: Sequence[Dict[str, Any]],
    complete,
) -> List[str] | None:
    """`complete(prompt) -> str` is injected so tests never call a model."""
    try:
        raw = complete(build_llm_prompt(text, concepts, keyword_ids))
    except Exception:
        return None
    return parse_llm_concepts(raw, (str(concept["id"]) for concept in concepts))


def make_gemini_complete(model: str = LLM_TAGGING_MODEL):
    """JSON-mode, temperature-0 Gemini completion (needs GEMINI_API_KEY)."""
    from google.genai import types

    from lib.embeddings import get_gemini_client

    client = get_gemini_client()
    config = types.GenerateContentConfig(temperature=0, response_mime_type="application/json")

    def complete(prompt: str) -> str:
        return client.models.generate_content(model=model, contents=prompt, config=config).text or ""

    return complete
