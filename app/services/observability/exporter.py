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

_ingest_ok = 0
_ingest_auth_failed = 0
_ingest_client_error = 0
_ingest_timeout = 0
_ingest_other = 0


def ingest_stats() -> dict[str, int]:
    return {
        "ok": _ingest_ok,
        "auth_failed": _ingest_auth_failed,
        "client_error": _ingest_client_error,
        "timeout": _ingest_timeout,
        "other": _ingest_other,
    }


def reset_ingest_stats() -> None:
    global _ingest_ok, _ingest_auth_failed, _ingest_client_error, _ingest_timeout, _ingest_other
    _ingest_ok = 0
    _ingest_auth_failed = 0
    _ingest_client_error = 0
    _ingest_timeout = 0
    _ingest_other = 0


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


def _record_status_error(status_code: int) -> None:
    global _ingest_auth_failed, _ingest_client_error, _ingest_other
    if status_code in {401, 403}:
        _ingest_auth_failed += 1
        kind = "auth"
    elif 400 <= status_code < 500:
        _ingest_client_error += 1
        kind = "client"
    else:
        _ingest_other += 1
        kind = "server"
    logger.warning("langfuse ingest failed kind=%s status=%s", kind, status_code)


def _record_success() -> None:
    global _ingest_ok
    _ingest_ok += 1


def _record_timeout() -> None:
    global _ingest_timeout
    _ingest_timeout += 1
    logger.warning("langfuse ingest failed kind=timeout")


def _record_other() -> None:
    global _ingest_other
    _ingest_other += 1
    logger.warning("langfuse ingest failed kind=other")


def _handle_response(response: httpx.Response) -> None:
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        _record_status_error(exc.response.status_code)
        return
    _record_success()


def post_ingestion(envelope: dict[str, Any], client: httpx.Client | None = None) -> None:
    """테스트에서 client를 주입한다. 본문·키는 로그에 남기지 않는다."""
    headers = {"Authorization": _basic_auth()}
    try:
        if client is None:
            with httpx.Client(timeout=2.0) as owned:
                _handle_response(owned.post(_ingest_url(), json=envelope, headers=headers))
            return
        _handle_response(client.post(_ingest_url(), json=envelope, headers=headers))
    except httpx.TimeoutException:
        _record_timeout()
    except Exception:
        _record_other()


async def post_ingestion_async(envelope: dict[str, Any], client: httpx.AsyncClient | None = None) -> None:
    headers = {"Authorization": _basic_auth()}
    try:
        if client is None:
            async with httpx.AsyncClient(timeout=2.0) as owned:
                _handle_response(await owned.post(_ingest_url(), json=envelope, headers=headers))
            return
        _handle_response(await client.post(_ingest_url(), json=envelope, headers=headers))
    except httpx.TimeoutException:
        _record_timeout()
    except Exception:
        _record_other()


def dispatch_ingestion(envelope: dict[str, Any]) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        post_ingestion(envelope)
        return
    loop.create_task(post_ingestion_async(envelope))


def export_allowlisted_metadata(payload: dict[str, Any]) -> None:
    """Best-effort metadata_only 전송. 호출자를 깨지 않는다."""
    if not config.LANGFUSE_ENABLED:
        return
    try:
        envelope = build_ingestion_envelope(payload)
        dispatch_ingestion(envelope)
    except Exception:
        logger.debug("langfuse export skipped", exc_info=True)
        _record_other()
