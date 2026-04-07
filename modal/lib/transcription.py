from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Tuple


@lru_cache(maxsize=1)
def get_transcription_model():
    from faster_whisper import WhisperModel

    return WhisperModel(
        os.environ.get("WHISPER_MODEL_SIZE", "small"),
        device=os.environ.get("WHISPER_DEVICE", "cpu"),
        compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"),
        cpu_threads=int(os.environ.get("WHISPER_CPU_THREADS", "4")),
    )


def transcribe_media(media_path: Path) -> Tuple[List[Dict[str, Any]], str | None]:
    model = get_transcription_model()
    configured_language = os.environ.get("WHISPER_LANGUAGE") or None

    segments, info = model.transcribe(
        str(media_path),
        language=configured_language,
        beam_size=int(os.environ.get("WHISPER_BEAM_SIZE", "5")),
        vad_filter=True,
    )

    transcript_segments: List[Dict[str, Any]] = []

    for segment_index, segment in enumerate(segments):
        text = segment.text.strip()
        if not text:
            continue

        transcript_segments.append(
            {
                "segment_index": segment_index,
                "start_seconds": float(segment.start),
                "end_seconds": float(segment.end),
                "text": text,
            }
        )

    language = configured_language or getattr(info, "language", None)
    return transcript_segments, language
