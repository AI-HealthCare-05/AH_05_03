from __future__ import annotations

import hashlib
import hmac
import json
import re
from typing import Any, Literal

CANARY_RESIDENT_ID = "950101-1234567"
CANARY_PATIENT_NAME = "홍길동환자"
CANARY_GLUCOSE_VALUE = "105"

HMAC_ALIAS_HEX_LEN = 32
_ALIAS_RE = re.compile(r"^(account|session|job)_[0-9a-f]{32}$")
_TOOL_OR_CODE_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_MODEL_RE = re.compile(r"^[A-Za-z0-9:._/-]{1,80}$")
_RESIDENT_ID = re.compile(r"\d{6}[-\s]?\d{7}")
_PHONE = re.compile(r"01[016789]-?\d{3,4}-?\d{4}")

ChatOutcome = Literal["non_streaming_success", "streaming_success"]

CHATBOT_ALLOWED_KEYS = frozenset(
    {
        "kind",
        "account",
        "session",
        "model",
        "offered_tool_names",
        "called_tool_names",
        "tool_call_count",
        "measurement_codes",
        "measurement_count",
        "outcome",
        "exact_values_logged",
        "langfuse_export",
    }
)
CHATBOT_OUTCOMES = frozenset({"non_streaming_success", "streaming_success"})

MEASUREMENT_ALLOWED_KEYS = frozenset(
    {
        "measurement_codes",
        "measurement_count",
        "source",
        "exact_values_logged",
    }
)


def hmac_alias(kind: str, raw_id: str | None, secret: str) -> str | None:
    if not raw_id:
        return None
    digest = hmac.new(
        secret.encode(),
        f"{kind}:{raw_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"{kind}_{digest[:HMAC_ALIAS_HEX_LEN]}"


def _walk_strings(value: Any) -> list[str]:
    found: list[str] = []
    if value is None:
        return found
    if isinstance(value, str):
        found.append(value)
    elif isinstance(value, dict):
        for item in value.values():
            found.extend(_walk_strings(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            found.extend(_walk_strings(item))
    else:
        found.append(str(value))
    return found


def contains_sensitive_canary(payload: Any) -> bool:
    """2차 방어. allowlist를 통과한 뒤에도 canary 문자열이 있으면 실패한다."""
    for blob in _walk_strings(payload):
        if CANARY_RESIDENT_ID in blob or CANARY_PATIENT_NAME in blob:
            return True
        if CANARY_GLUCOSE_VALUE in blob and ("mg/dL" in blob or "glucose" in blob.lower()):
            return True
        if _RESIDENT_ID.search(blob) or _PHONE.search(blob):
            return True
    return False


def _require_alias(value: Any) -> None:
    if value is None:
        return
    if not isinstance(value, str) or not _ALIAS_RE.fullmatch(value):
        raise ValueError("observability alias must be hmac hex or null")


def _require_name_list(value: Any) -> None:
    if not isinstance(value, list):
        raise ValueError("observability name list must be a list")
    for item in value:
        if not isinstance(item, str) or not _TOOL_OR_CODE_RE.fullmatch(item):
            raise ValueError("observability names must be snake_case codes")


def _require_counts(payload: dict[str, Any]) -> None:
    if not isinstance(payload["tool_call_count"], int) or payload["tool_call_count"] < 0:
        raise ValueError("tool_call_count must be a non-negative int")
    if payload["tool_call_count"] != len(payload["called_tool_names"]):
        raise ValueError("tool_call_count must match called_tool_names")
    if payload["measurement_count"] != len(payload["measurement_codes"]):
        raise ValueError("measurement_count must match measurement_codes")


def assert_allowlisted_chatbot_metadata(payload: dict[str, Any]) -> None:
    extra = set(payload) - CHATBOT_ALLOWED_KEYS
    missing = CHATBOT_ALLOWED_KEYS - set(payload)
    if extra or missing:
        raise ValueError(f"chatbot metadata keys must match allowlist extra={extra} missing={missing}")
    if payload["kind"] != "chatbot" or payload["outcome"] not in CHATBOT_OUTCOMES:
        raise ValueError("kind/outcome not allowed")
    if payload["exact_values_logged"] is not False or payload["langfuse_export"] is not False:
        raise ValueError("chatbot metadata cannot log exact values or export to Langfuse")
    _require_alias(payload["account"])
    _require_alias(payload["session"])
    model = payload["model"]
    if model is not None and (not isinstance(model, str) or not _MODEL_RE.fullmatch(model)):
        raise ValueError("model must be a short provider identifier")
    _require_name_list(payload["offered_tool_names"])
    _require_name_list(payload["called_tool_names"])
    _require_name_list(payload["measurement_codes"])
    _require_counts(payload)
    if contains_sensitive_canary(payload):
        raise ValueError("observability payload failed canary")


def assert_allowlisted_measurement_observation(payload: dict[str, Any]) -> None:
    extra = set(payload) - MEASUREMENT_ALLOWED_KEYS
    missing = MEASUREMENT_ALLOWED_KEYS - set(payload)
    if extra or missing:
        raise ValueError(f"measurement observation keys must match allowlist extra={extra} missing={missing}")
    _require_name_list(payload["measurement_codes"])
    if payload["measurement_count"] != len(payload["measurement_codes"]):
        raise ValueError("measurement_count must match measurement_codes")
    if payload["exact_values_logged"] is not False:
        raise ValueError("measurement observation cannot log exact values")
    source = payload["source"]
    if not isinstance(source, str) or not _TOOL_OR_CODE_RE.fullmatch(source):
        raise ValueError("source must be a snake_case code")
    if contains_sensitive_canary(payload):
        raise ValueError("observability payload failed canary")


def dump_for_canary(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, default=str)
