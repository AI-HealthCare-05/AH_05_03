from __future__ import annotations

import logging
from typing import Any

from app.core import config
from app.services.observability.events import document_vision_metadata
from app.services.observability.exporter import export_allowlisted_metadata
from app.services.observability.privacy import VisionOutcome, hmac_alias

logger = logging.getLogger(__name__)


def record_document_vision(
    *,
    account_id: str | None = None,
    job_id: str | None = None,
    model: str | None = None,
    page_count: int,
    outcome: VisionOutcome,
) -> dict[str, Any] | None:
    """문서 Vision 성공/실패 metadata_only. 원문·바이트·프롬프트는 넣지 않는다."""
    try:
        secret = (config.OBSERVABILITY_HMAC_SECRET or "").strip()
        if config.LANGFUSE_ENABLED and len(secret) < 32:
            logger.warning("observability hmac secret missing while langfuse enabled")
            return None
        payload = document_vision_metadata(
            account_alias=hmac_alias("account", account_id, secret) if secret else None,
            job_alias=hmac_alias("job", job_id, secret) if secret else None,
            model=model,
            page_count=page_count,
            outcome=outcome,
        )
        export_allowlisted_metadata(payload)
        return payload
    except Exception:
        logger.debug("document vision observability skipped", exc_info=True)
        return None
