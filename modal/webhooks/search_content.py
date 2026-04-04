from __future__ import annotations

import os
from typing import Any, Callable, Dict, List

ALLOWED_CONTENT_TYPES = {"pdf", "video"}
DEFAULT_LIMIT = 8
MAX_LIMIT = 20


def _normalize_string_list(value: Any, field_name: str) -> List[str] | None:
    if value is None:
        return None

    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be an array of strings")

    normalized_values = [str(item).strip() for item in value if str(item).strip()]
    return normalized_values or None


def _normalize_content_types(value: Any) -> List[str] | None:
    normalized_values = _normalize_string_list(value, "content_types")
    if not normalized_values:
        return None

    invalid_value = next(
        (item for item in normalized_values if item not in ALLOWED_CONTENT_TYPES),
        None,
    )
    if invalid_value:
        raise ValueError(f"Unsupported content type: {invalid_value}")

    return normalized_values


def _normalize_limit(value: Any) -> int:
    if value is None:
        return DEFAULT_LIMIT

    try:
        parsed_limit = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("limit must be a positive integer") from exc

    if parsed_limit < 1:
        raise ValueError("limit must be a positive integer")

    return min(parsed_limit, MAX_LIMIT)


def search_content_webhook_impl(
    data: Dict[str, Any],
    perform_search: Callable[..., Dict[str, Any]],
) -> Dict[str, Any]:
    webhook_secret = os.environ["MODAL_WEBHOOK_SECRET"]
    request_secret = str(data.get("webhook_secret", ""))

    if not request_secret or request_secret != webhook_secret:
        return {
            "success": False,
            "error": "Unauthorized webhook request",
        }

    query = str(data.get("query", "")).strip()
    class_id = str(data.get("class_id", "")).strip()

    if not query:
        return {
            "success": False,
            "error": "Missing required field: query",
        }

    if not class_id:
        return {
            "success": False,
            "error": "Missing required field: class_id",
        }

    try:
        return perform_search(
            query=query,
            class_id=class_id,
            content_types=_normalize_content_types(data.get("content_types")),
            source_ids=_normalize_string_list(data.get("source_ids"), "source_ids"),
            limit=_normalize_limit(data.get("limit")),
        )
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
        }
