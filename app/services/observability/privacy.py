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
_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_ISO_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")

ChatOutcome = Literal["non_streaming_success", "streaming_success"]
VisionOutcome = Literal["vision_success", "vision_error"]

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
        "transcript_included",
    }
)
CHATBOT_OUTCOMES = frozenset({"non_streaming_success", "streaming_success"})

VISION_ALLOWED_KEYS = frozenset(
    {
        "kind",
        "account",
        "job",
        "model",
        "page_count",
        "outcome",
        "exact_values_logged",
        "transcript_included",
    }
)
VISION_OUTCOMES = frozenset({"vision_success", "vision_error"})
LANGFUSE_IO_KEYS = frozenset(
    {
        "input",
        "output",
        "prompt",
        "messages",
        "completion",
        "exception",
        "error",
        "text",
        "tables",
        "bytes",
        "files",
    }
)

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


def mask_for_provider(text: str) -> str:
    """공급자에게 보내거나 예외 문자열을 남기기 전의 PII 치환.

    문서 픽셀 마스킹(#210)이 아니다. 주민번호·전화·canary 이름만 지운다.
    혈당 수치 원문은 대화 근거에 필요할 수 있어 여기서 지우지 않는다.
    """
    redacted = _RESIDENT_ID.sub("[redacted_rid]", text)
    redacted = _PHONE.sub("[redacted_phone]", redacted)
    redacted = redacted.replace(CANARY_RESIDENT_ID, "[redacted_rid]")
    redacted = redacted.replace(CANARY_PATIENT_NAME, "[redacted_name]")
    return redacted


def _is_structural_observability_token(blob: str) -> bool:
    """Langfuse 봉투의 id·별칭·시각은 PII 정규식 대상이 아니다.

    uuid4 `168c9016-4803-4207-...` 같은 값이 `016-4803-4207` 전화번호 패턴에
    걸려 canary가 깨지는 일을 막는다. 주민번호·전화 원문 canary는 그대로 잡는다.
    """
    return bool(_ALIAS_RE.fullmatch(blob) or _UUID.fullmatch(blob) or _ISO_TIMESTAMP.match(blob))


def contains_sensitive_canary(payload: Any) -> bool:
    """2차 방어. allowlist를 통과한 뒤에도 canary 문자열이 있으면 실패한다."""
    for blob in _walk_strings(payload):
        if CANARY_RESIDENT_ID in blob or CANARY_PATIENT_NAME in blob:
            return True
        if CANARY_GLUCOSE_VALUE in blob and ("mg/dL" in blob or "glucose" in blob.lower()):
            return True
        if _is_structural_observability_token(blob):
            continue
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
    if payload["exact_values_logged"] is not False or payload["transcript_included"] is not False:
        raise ValueError("chatbot metadata cannot log exact values or include transcript")
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


def assert_allowlisted_vision_metadata(payload: dict[str, Any]) -> None:
    extra = set(payload) - VISION_ALLOWED_KEYS
    missing = VISION_ALLOWED_KEYS - set(payload)
    if extra or missing:
        raise ValueError(f"vision metadata keys must match allowlist extra={extra} missing={missing}")
    if payload["kind"] != "document_vision" or payload["outcome"] not in VISION_OUTCOMES:
        raise ValueError("kind/outcome not allowed")
    if payload["exact_values_logged"] is not False or payload["transcript_included"] is not False:
        raise ValueError("vision metadata cannot log exact values or include transcript")
    _require_alias(payload["account"])
    _require_alias(payload["job"])
    model = payload["model"]
    if model is not None and (not isinstance(model, str) or not _MODEL_RE.fullmatch(model)):
        raise ValueError("model must be a short provider identifier")
    page_count = payload["page_count"]
    if not isinstance(page_count, int) or page_count < 0:
        raise ValueError("page_count must be a non-negative int")
    if contains_sensitive_canary(payload):
        raise ValueError("observability payload failed canary")


def _dict_nodes(value: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(value, dict):
        found.append(value)
        for item in value.values():
            found.extend(_dict_nodes(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            found.extend(_dict_nodes(item))
    return found


def assert_metadata_only_envelope(envelope: dict[str, Any]) -> None:
    """Langfuse ingest JSON에 입력·출력·프롬프트 키가 없어야 한다."""
    for node in _dict_nodes(envelope):
        leaked = LANGFUSE_IO_KEYS & set(node)
        if leaked:
            raise ValueError(f"langfuse envelope cannot include {sorted(leaked)}")
    if contains_sensitive_canary(envelope):
        raise ValueError("langfuse envelope failed canary")


def dump_for_canary(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, default=str)
