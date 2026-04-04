from __future__ import annotations

import math
import os
from functools import lru_cache
from typing import List, Sequence

from lib.constants import (
    EMBEDDING_DOCUMENT_TASK_TYPE,
    EMBEDDING_MODEL_NAME,
    EMBEDDING_QUERY_TASK_TYPE,
    EMBEDDING_VECTOR_SIZE,
)


@lru_cache(maxsize=1)
def get_gemini_client():
    from google import genai

    return genai.Client(api_key=os.environ["GEMINI_API_KEY"])


def _normalize_embedding(values: Sequence[float]) -> List[float]:
    norm = math.sqrt(sum(float(value) * float(value) for value in values))
    if norm == 0:
        return [float(value) for value in values]

    return [float(value) / norm for value in values]


def _embed_contents(
    *,
    texts: Sequence[str],
    task_type: str,
    title: str | None = None,
) -> List[List[float]]:
    if not texts:
        return []

    from google.genai import types

    client = get_gemini_client()
    config_kwargs = {
        "task_type": task_type,
        "output_dimensionality": EMBEDDING_VECTOR_SIZE,
    }
    if title:
        config_kwargs["title"] = title

    result = client.models.embed_content(
        model=EMBEDDING_MODEL_NAME,
        contents=list(texts),
        config=types.EmbedContentConfig(**config_kwargs),
    )

    if len(result.embeddings) != len(texts):
        raise ValueError("Gemini returned an unexpected number of embeddings")

    return [_normalize_embedding(embedding.values) for embedding in result.embeddings]


def encode_query(text: str) -> List[float]:
    [embedding] = _embed_contents(
        texts=[text],
        task_type=EMBEDDING_QUERY_TASK_TYPE,
    )
    return embedding


def encode_documents(
    texts: Sequence[str],
    *,
    title: str | None = None,
    batch_size: int = 32,
) -> List[List[float]]:
    if not texts:
        return []

    embeddings: List[List[float]] = []
    for start_index in range(0, len(texts), batch_size):
        batch = texts[start_index : start_index + batch_size]
        embeddings.extend(
            _embed_contents(
                texts=batch,
                task_type=EMBEDDING_DOCUMENT_TASK_TYPE,
                title=title,
            )
        )

    return embeddings
