from __future__ import annotations

import logging
from typing import Any

from app.core import config
from app.services.observability.events import chatbot_metadata
from app.services.observability.privacy import assert_metadata_only, hmac_alias

logger = logging.getLogger(__name__)


def _hmac_secret() -> str:
    return config.OBSERVABILITY_HMAC_SECRET or config.SECRET_KEY


def record_health_assistant_turn(
    *,
    account_id: str | None = None,
    session_id: str | None = None,
    model: str | None = None,
    tool_names: list[str] | None = None,
    measurement_codes: list[str] | None = None,
    error: bool = False,
) -> dict[str, Any] | None:
    """챗봇 한 턴의 metadata_only 관찰. 실패해도 호출자를 깨지 않는다."""
    try:
        payload = chatbot_metadata(
            account_alias=hmac_alias("account", account_id, _hmac_secret()),
            session_alias=hmac_alias("session", session_id, _hmac_secret()),
            model=model,
            tool_names=tool_names,
            measurement_codes=measurement_codes,
            error=error,
        )
        if not config.OBSERVABILITY_EXACT_VALUES:
            assert_metadata_only(payload)
        if not config.LANGFUSE_ENABLED:
            return payload
        logger.debug("langfuse chatbot metadata ready kind=%s tools=%s", payload["kind"], payload["tool_count"])
        return payload
    except Exception:
        logger.debug("health assistant observability skipped", exc_info=True)
        return None
