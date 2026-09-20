from __future__ import annotations

from typing import Any

from app.services.observability.privacy import (
    ChatOutcome,
    VisionOutcome,
    assert_allowlisted_chatbot_metadata,
    assert_allowlisted_vision_metadata,
)


def chatbot_metadata(
    *,
    account_alias: str | None,
    session_alias: str | None,
    model: str | None,
    offered_tool_names: list[str] | None,
    called_tool_names: list[str] | None,
    measurement_codes: list[str] | None,
    outcome: ChatOutcome,
) -> dict[str, Any]:
    called = list(called_tool_names or [])
    codes = list(measurement_codes or [])
    payload = {
        "kind": "chatbot",
        "account": account_alias,
        "session": session_alias,
        "model": model,
        "offered_tool_names": list(offered_tool_names or []),
        "called_tool_names": called,
        "tool_call_count": len(called),
        "measurement_codes": codes,
        "measurement_count": len(codes),
        "outcome": outcome,
        "exact_values_logged": False,
        "transcript_included": False,
    }
    assert_allowlisted_chatbot_metadata(payload)
    return payload


def document_vision_metadata(
    *,
    account_alias: str | None,
    job_alias: str | None,
    model: str | None,
    page_count: int,
    outcome: VisionOutcome,
) -> dict[str, Any]:
    payload = {
        "kind": "document_vision",
        "account": account_alias,
        "job": job_alias,
        "model": model,
        "page_count": page_count,
        "outcome": outcome,
        "exact_values_logged": False,
        "transcript_included": False,
    }
    assert_allowlisted_vision_metadata(payload)
    return payload


def production_measurement_observation(codes: list[str], source: str) -> dict[str, Any]:
    from app.services.observability.privacy import assert_allowlisted_measurement_observation

    payload = {
        "measurement_codes": list(codes),
        "measurement_count": len(codes),
        "source": source,
        "exact_values_logged": False,
    }
    assert_allowlisted_measurement_observation(payload)
    return payload
