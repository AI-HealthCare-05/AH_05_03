from __future__ import annotations

from typing import Any, Literal

TraceKind = Literal["chatbot", "document_vision"]


def chatbot_metadata(
    *,
    account_alias: str | None,
    session_alias: str | None,
    model: str | None,
    tool_names: list[str] | None,
    measurement_codes: list[str] | None,
    error: bool,
) -> dict[str, Any]:
    return {
        "kind": "chatbot",
        "account": account_alias,
        "session": session_alias,
        "model": model,
        "tool_names": list(tool_names or []),
        "tool_count": len(tool_names or []),
        "measurement_codes": list(measurement_codes or []),
        "measurement_count": len(measurement_codes or []),
        "error": error,
        "exact_values_logged": False,
    }


def document_vision_metadata(
    *,
    account_alias: str | None,
    job_alias: str | None,
    model: str | None,
    page_count: int | None,
    success: bool,
) -> dict[str, Any]:
    return {
        "kind": "document_vision",
        "account": account_alias,
        "job": job_alias,
        "model": model,
        "page_count": page_count,
        "success": success,
        "exact_values_logged": False,
    }


def production_measurement_observation(codes: list[str], source: str) -> dict[str, Any]:
    return {
        "measurement_codes": list(codes),
        "measurement_count": len(codes),
        "source": source,
        "exact_values_logged": False,
    }
