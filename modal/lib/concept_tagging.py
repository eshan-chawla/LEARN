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
