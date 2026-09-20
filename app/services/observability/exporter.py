from __future__ import annotations

import asyncio
import logging
import uuid
from base64 import b64encode
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core import config
from app.services.observability.privacy import (
    assert_allowlisted_chatbot_metadata,
    assert_allowlisted_vision_metadata,
    assert_metadata_only_envelope,
)

logger = logging.getLogger(__name__)


def build_ingestion_envelope(payload: dict[str, Any]) -> dict[str, Any]:
    """allowlist metadata만 batch에 넣는다. input/output 필드는 만들지 않는다."""
    kind = payload.get("kind")
    if kind == "chatbot":
        assert_allowlisted_chatbot_metadata(payload)
    elif kind == "document_vision":
        assert_allowlisted_vision_metadata(payload)
    else:
        raise ValueError("langfuse metadata kind must be chatbot or document_vision")
    now = datetime.now(timezone.utc).isoformat()
    envelope = {
        "batch": [
            {
                "id": str(uuid.uuid4()),
                "timestamp": now,
                "type": "trace-create",
                "body": {
                    "id": str(uuid.uuid4()),
                    "timestamp": now,
                    "name": kind,
                    "userId": payload.get("account"),
                    "sessionId": payload.get("session") or payload.get("job"),
                    "metadata": payload,
                },
            }
        ]
    }
    assert_metadata_only_envelope(envelope)
    return envelope


def _basic_auth() -> str:
    public = (config.LANGFUSE_PUBLIC_KEY or "").strip()
    secret = (config.LANGFUSE_SECRET_KEY or "").strip()
    token = b64encode(f"{public}:{secret}".encode()).decode()
    return f"Basic {token}"


def _ingest_url() -> str:
    return f"{(config.LANGFUSE_HOST or 'https://cloud.langfuse.com').rstrip('/')}/api/public/ingestion"


def _post_sync(envelope: dict[str, Any]) -> None:
    with httpx.Client(timeout=2.0) as client:
        client.post(_ingest_url(), json=envelope, headers={"Authorization": _basic_auth()})


async def _post_async(envelope: dict[str, Any]) -> None:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(_ingest_url(), json=envelope, headers={"Authorization": _basic_auth()})
    except Exception:
        logger.debug("langfuse ingest skipped", exc_info=True)


def dispatch_ingestion(envelope: dict[str, Any]) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        _post_sync(envelope)
        return
    loop.create_task(_post_async(envelope))


def export_allowlisted_metadata(payload: dict[str, Any]) -> None:
    """Best-effort metadata_only 전송. 호출자를 깨지 않는다."""
    if not config.LANGFUSE_ENABLED:
        return
    try:
        envelope = build_ingestion_envelope(payload)
        dispatch_ingestion(envelope)
    except Exception:
        logger.debug("langfuse export skipped", exc_info=True)
