"""
Modal app entrypoint.
Deploy with: modal deploy modal/app.py
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import modal

from jobs.process_pdf import process_pdf_impl
from jobs.process_video import process_video_impl
from jobs.search_content import search_content_impl
from webhooks.process_pdf import process_pdf_webhook_impl
from webhooks.process_video import process_video_webhook_impl
from webhooks.search_content import search_content_webhook_impl

BASE_DIR = Path(__file__).resolve().parent

app = modal.App("pdf-processor")

image = (
    modal.Image.debian_slim()
    .apt_install("ffmpeg")
    .pip_install(
        "boto3==1.34.131",
        "faster-whisper==1.1.1",
        "fastapi[standard]==0.115.0",
        "google-genai==1.62.0",
        "httpx>=0.27,<1",
        "pypdf==4.2.0",
        "qdrant-client==1.7.0",
    )
    .add_local_dir(str(BASE_DIR / "jobs"), remote_path="/root/jobs")
    .add_local_dir(str(BASE_DIR / "webhooks"), remote_path="/root/webhooks")
    .add_local_dir(str(BASE_DIR / "lib"), remote_path="/root/lib")
)

process_pdf = app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("aws-s3-credentials"),
        modal.Secret.from_name("gemini-api-key"),
        modal.Secret.from_name("supabase-credentials"),
        modal.Secret.from_name("qdrant-credentials"),
        modal.Secret.from_name("modal-webhook-secret"),
    ],
    timeout=900,
    memory=4096,
)(process_pdf_impl)


process_video = app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("aws-s3-credentials"),
        modal.Secret.from_name("gemini-api-key"),
        modal.Secret.from_name("supabase-credentials"),
        modal.Secret.from_name("qdrant-credentials"),
        modal.Secret.from_name("modal-webhook-secret"),
    ],
    timeout=3600,
    memory=8192,
)(process_video_impl)


@app.function(image=image, secrets=[modal.Secret.from_name("modal-webhook-secret")])
@modal.fastapi_endpoint(method="POST")
def process_pdf_webhook(data: Dict[str, Any]) -> Dict[str, Any]:
    return process_pdf_webhook_impl(
        data,
        enqueue_process_pdf=lambda book_id, class_id, title, storage_path, file_name: process_pdf.spawn(
            book_id,
            class_id,
            title,
            storage_path,
            file_name,
        ),
    )


@app.function(image=image, secrets=[modal.Secret.from_name("modal-webhook-secret")])
@modal.fastapi_endpoint(method="POST")
def process_video_webhook(data: Dict[str, Any]) -> Dict[str, Any]:
    return process_video_webhook_impl(
        data,
        enqueue_process_video=lambda recording_id, class_id, title, storage_path, file_name, duration: process_video.spawn(
            recording_id,
            class_id,
            title,
            storage_path,
            file_name,
            duration,
        ),
    )


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("gemini-api-key"),
        modal.Secret.from_name("qdrant-credentials"),
        modal.Secret.from_name("modal-webhook-secret"),
    ],
    timeout=300,
    memory=2048,
)
@modal.fastapi_endpoint(method="POST")
def search_content_webhook(data: Dict[str, Any]) -> Dict[str, Any]:
    return search_content_webhook_impl(
        data,
        perform_search=search_content_impl,
    )
