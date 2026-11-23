"""Make `lib`, `jobs` and `webhooks` importable the same way they are inside the Modal image."""
from __future__ import annotations

import sys
from pathlib import Path

MODAL_DIR = Path(__file__).resolve().parents[1]
if str(MODAL_DIR) not in sys.path:
    sys.path.insert(0, str(MODAL_DIR))
