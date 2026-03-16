from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List


def extract_page_chunks(pdf_path: Path, chunk_size: int = 500, overlap: int = 50) -> List[Dict[str, Any]]:
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    chunks: List[Dict[str, Any]] = []

    for page_index, page in enumerate(reader.pages):
        page_text = (page.extract_text() or "").strip()
        if not page_text:
            continue

        for page_chunk_index, chunk_text in enumerate(
            split_into_chunks(page_text, chunk_size=chunk_size, overlap=overlap)
        ):
            chunks.append(
                {
                    "page_number": page_index + 1,
                    "page_chunk_index": page_chunk_index,
                    "text": chunk_text,
                }
            )

    return chunks


def split_into_chunks(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    words = text.split()
    chunks: List[str] = []
    index = 0

    while index < len(words):
        chunk_words = words[index : index + chunk_size]
        if not chunk_words:
            break

        chunks.append(" ".join(chunk_words))

        if len(chunk_words) < chunk_size:
            break

        index += chunk_size - overlap

    return chunks
