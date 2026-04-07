from __future__ import annotations

import os
from typing import Any, Callable, Dict


def process_video_webhook_impl(
    data: Dict[str, Any],
    enqueue_process_video: Callable[[str, str, str, str, str, int | None], Any],
) -> Dict[str, Any]:
    webhook_secret = os.environ["MODAL_WEBHOOK_SECRET"]
    request_secret = str(data.get("webhook_secret", ""))

    if not request_secret or request_secret != webhook_secret:
        return {
            "success": False,
            "error": "Unauthorized webhook request",
        }

    required_fields = ["recording_id", "class_id", "title", "storage_path", "file_name"]
    missing_fields = [field for field in required_fields if not data.get(field)]
    if missing_fields:
        return {
            "success": False,
            "error": f"Missing required fields: {', '.join(missing_fields)}",
        }

    duration = data.get("duration")
    normalized_duration = int(duration) if isinstance(duration, (int, float)) else None

    enqueue_process_video(
        data["recording_id"],
        data["class_id"],
        data["title"],
        data["storage_path"],
        data["file_name"],
        normalized_duration,
    )

    return {
        "success": True,
        "message": "Video processing started",
        "recording_id": data["recording_id"],
    }
