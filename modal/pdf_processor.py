"""
Backward-compatible Modal entrypoint.
Prefer: modal deploy modal/app.py
"""

from app import app, process_pdf, process_pdf_webhook  # noqa: F401
