from __future__ import annotations

import hashlib
import hmac
import json
import re
from typing import Any

CANARY_RESIDENT_ID = "950101-1234567"
CANARY_PATIENT_NAME = "홍길동환자"
CANARY_GLUCOSE_VALUE = "105"

_RESIDENT_ID = re.compile(r"\d{6}[-\s]?\d{7}")
_PHONE = re.compile(r"01[016789]-?\d{3,4}-?\d{4}")
_NUMERIC_LAB = re.compile(
    r"\b(?:glucose|fasting_glucose|hba1c|sbp|dbp|creatinine)\b[^,]{0,40}\b\d+(?:\.\d+)?\b",
    re.IGNORECASE,
)
_BARE_LAB_VALUE = re.compile(r"\b\d{2,3}(?:\.\d+)?\s*(?:mg/dL|mmol/L|mmHg)\b", re.IGNORECASE)


def hmac_alias(kind: str, raw_id: str | None, secret: str) -> str | None:
    if not raw_id:
        return None
    digest = hmac.new(
        secret.encode("utf-8"),
        f"{kind}:{raw_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{kind}_{digest[:16]}"


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


def contains_sensitive(payload: Any) -> bool:
    for blob in _walk_strings(payload):
        if CANARY_RESIDENT_ID in blob or CANARY_PATIENT_NAME in blob:
            return True
        if CANARY_GLUCOSE_VALUE in blob and ("mg/dL" in blob or "glucose" in blob.lower()):
            return True
        if _RESIDENT_ID.search(blob) or _PHONE.search(blob):
            return True
        if _NUMERIC_LAB.search(blob) or _BARE_LAB_VALUE.search(blob):
            return True
    return False


def assert_metadata_only(payload: Any) -> None:
    if contains_sensitive(payload):
        raise ValueError("observability payload contains sensitive health or identity data")


def dump_for_canary(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, default=str)
