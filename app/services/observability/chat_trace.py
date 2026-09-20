from __future__ import annotations

import logging
from typing import Any

from app.core import config
from app.services.observability.events import chatbot_metadata
from app.services.observability.privacy import ChatOutcome, hmac_alias

logger = logging.getLogger(__name__)


def record_health_assistant_turn(
    *,
    account_id: str | None = None,
    session_id: str | None = None,
    model: str | None = None,
    offered_tool_names: list[str] | None = None,
    called_tool_names: list[str] | None = None,
    measurement_codes: list[str] | None = None,
    outcome: ChatOutcome,
) -> dict[str, Any] | None:
    """비스트리밍/스트리밍 성공 턴의 metadata_only 관찰. 실패해도 호출자를 깨지 않는다.

    이 슬라이스는 Langfuse 로 보내지 않는다. 오류 경로와 Vision trace는 후속(#204).
    """
    try:
        secret = (config.OBSERVABILITY_HMAC_SECRET or "").strip()
        if config.LANGFUSE_ENABLED and len(secret) < 32:
            logger.warning("observability hmac secret missing while langfuse enabled")
            return None
        payload = chatbot_metadata(
            account_alias=hmac_alias("account", account_id, secret) if secret else None,
            session_alias=hmac_alias("session", session_id, secret) if secret else None,
            model=model,
            offered_tool_names=offered_tool_names,
            called_tool_names=called_tool_names,
            measurement_codes=measurement_codes,
            outcome=outcome,
        )
        if config.LANGFUSE_ENABLED:
            logger.debug(
                "metadata-only chatbot observation ready outcome=%s offered=%s called=%s export=false",
                payload["outcome"],
                payload["offered_tool_names"],
                payload["called_tool_names"],
            )
        return payload
    except Exception:
        logger.debug("health assistant observability skipped", exc_info=True)
        return None
