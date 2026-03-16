"""
Modal app entrypoint.
Deploy with: modal deploy modal/app.py
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import modal

from jobs.process_pdf import process_pdf_impl
from webhooks.process_pdf import process_pdf_webhook_impl

BASE_DIR = Path(__file__).resolve().parent

app = modal.App("pdf-processor")

image = (
    modal.Image.debian_slim()
    .pip_install(
        "boto3==1.34.131",
        "fastapi[standard]==0.115.0",
        "httpx==0.24.1",
        "pypdf==4.2.0",
        "qdrant-client==1.7.0",
        "sentence-transformers==2.7.0",
        "transformers==4.51.3",
    )
    .add_local_dir(str(BASE_DIR / "jobs"), remote_path="/root/jobs")
    .add_local_dir(str(BASE_DIR / "webhooks"), remote_path="/root/webhooks")
    .add_local_dir(str(BASE_DIR / "lib"), remote_path="/root/lib")
)

process_pdf = app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("aws-s3-credentials"),
        modal.Secret.from_name("supabase-credentials"),
        modal.Secret.from_name("qdrant-credentials"),
        modal.Secret.from_name("modal-webhook-secret"),
    ],
    timeout=900,
    memory=8192,
    gpu="L4",
)(process_pdf_impl)


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
