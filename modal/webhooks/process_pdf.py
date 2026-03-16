from __future__ import annotations

import os
from typing import Any, Callable, Dict


def process_pdf_webhook_impl(
    data: Dict[str, Any],
    enqueue_process_pdf: Callable[[str, str, str, str, str], Any],
) -> Dict[str, Any]:
    webhook_secret = os.environ["MODAL_WEBHOOK_SECRET"]
    request_secret = str(data.get("webhook_secret", ""))

    if not request_secret or request_secret != webhook_secret:
        return {
            "success": False,
            "error": "Unauthorized webhook request",
        }

    required_fields = ["book_id", "class_id", "title", "storage_path", "file_name"]
    missing_fields = [field for field in required_fields if not data.get(field)]
    if missing_fields:
        return {
            "success": False,
            "error": f"Missing required fields: {', '.join(missing_fields)}",
        }

    enqueue_process_pdf(
        data["book_id"],
        data["class_id"],
        data["title"],
        data["storage_path"],
        data["file_name"],
    )

    return {
        "success": True,
        "message": "Processing started",
        "book_id": data["book_id"],
    }
