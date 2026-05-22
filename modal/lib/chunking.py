from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Sequence

import io

def extract_page_chunks(
    pdf_path: Path,
    chunk_size: int = 500,
    overlap: int = 50,
    gemini_api_key: str | None = None,
) -> List[Dict[str, Any]]:
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    chunks: List[Dict[str, Any]] = []

    for page_index, page in enumerate(reader.pages):
        page_text = (page.extract_text() or "").strip()

        if not page_text and gemini_api_key:
            page_text = _ocr_page_with_gemini(pdf_path, page_index, gemini_api_key)

        if not page_text:
            continue

        for page_chunk_index, chunk_text in enumerate(
            split_into_chunks(page_text, chunk_size=chunk_size, overlap=overlap)
        ):
            chunks.append({
                "page_number": page_index + 1,
                "page_chunk_index": page_chunk_index,
                "text": chunk_text,
            })

    return chunks


def _ocr_page_with_gemini(pdf_path: Path, page_index: int, api_key: str) -> str:
    from pypdf import PdfReader, PdfWriter
    from google import genai
    from google.genai import types

    reader = PdfReader(str(pdf_path))
    writer = PdfWriter()
    writer.add_page(reader.pages[page_index])
    buf = io.BytesIO()
    writer.write(buf)
    buf.seek(0)

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=[
            types.Part.from_bytes(data=buf.read(), mime_type="application/pdf"),
            "Extract all text from this page exactly as it appears. Return only the text, no commentary.",
        ],
    )
    return (response.text or "").strip()

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


def chunk_transcript_segments(
    segments: Sequence[Dict[str, Any]],
    *,
    max_words: int = 220,
    overlap_segments: int = 1,
) -> List[Dict[str, Any]]:
    normalized_segments: List[Dict[str, Any]] = []

    for segment in segments:
        text = str(segment.get("text", "")).strip()
        if not text:
            continue

        normalized_segments.append(
            {
                "segment_index": int(segment.get("segment_index", len(normalized_segments))),
                "start_seconds": float(segment.get("start_seconds", 0.0)),
                "end_seconds": float(segment.get("end_seconds", 0.0)),
                "text": text,
                "word_count": len(text.split()),
            }
        )

    if not normalized_segments:
        return []

    chunks: List[Dict[str, Any]] = []
    current_segments: List[Dict[str, Any]] = []
    current_word_count = 0

    def emit_chunk(active_segments: Sequence[Dict[str, Any]]) -> None:
        if not active_segments:
            return

        chunks.append(
            {
                "segment_start_index": int(active_segments[0]["segment_index"]),
                "segment_end_index": int(active_segments[-1]["segment_index"]),
                "start_seconds": float(active_segments[0]["start_seconds"]),
                "end_seconds": float(active_segments[-1]["end_seconds"]),
                "text": " ".join(segment["text"] for segment in active_segments),
            }
        )

    for segment in normalized_segments:
        segment_word_count = int(segment["word_count"])

        if current_segments and current_word_count + segment_word_count > max_words:
            emit_chunk(current_segments)

            if overlap_segments > 0:
                current_segments = current_segments[-overlap_segments:]
                current_word_count = sum(int(active_segment["word_count"]) for active_segment in current_segments)
            else:
                current_segments = []
                current_word_count = 0

        current_segments.append(segment)
        current_word_count += segment_word_count

    emit_chunk(current_segments)

    return chunks
