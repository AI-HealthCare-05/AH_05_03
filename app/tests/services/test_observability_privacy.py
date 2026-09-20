import pytest
from pydantic import ValidationError

from app.core.config import Config, Env
from app.services.observability.events import chatbot_metadata, production_measurement_observation
from app.services.observability.privacy import (
    CANARY_GLUCOSE_VALUE,
    CANARY_PATIENT_NAME,
    CANARY_RESIDENT_ID,
    HMAC_ALIAS_HEX_LEN,
    assert_allowlisted_chatbot_metadata,
    contains_sensitive_canary,
    hmac_alias,
)


def test_hmac_alias_is_stable_and_not_raw_id() -> None:
    first = hmac_alias("account", "acct-1", "secret-secret-secret-secret-1234")
    second = hmac_alias("account", "acct-1", "secret-secret-secret-secret-1234")
    other = hmac_alias("account", "acct-2", "secret-secret-secret-secret-1234")
    assert first == second
    assert first != other
    assert first is not None
    assert "acct-1" not in first
    assert first.startswith("account_")
    assert len(first.split("_", 1)[1]) == HMAC_ALIAS_HEX_LEN


def test_production_metadata_is_allowlisted() -> None:
    payload = production_measurement_observation(["fasting_glucose"], "user_confirmed_ocr")
    assert payload["exact_values_logged"] is False
    assert CANARY_GLUCOSE_VALUE not in str(payload)


def test_chatbot_metadata_rejects_unknown_keys() -> None:
    payload = chatbot_metadata(
        account_alias=None,
        session_alias=None,
        model="gemini-3.5-flash-lite",
        offered_tool_names=["search_hospital"],
        called_tool_names=[],
        measurement_codes=["fasting_glucose"],
        outcome="non_streaming_success",
    )
    leaked = dict(payload)
    leaked["prompt"] = f"환자 {CANARY_RESIDENT_ID} 공복혈당 {CANARY_GLUCOSE_VALUE} mg/dL"
    with pytest.raises(ValueError, match="allowlist"):
        assert_allowlisted_chatbot_metadata(leaked)


def test_chatbot_metadata_rejects_identity_alias() -> None:
    with pytest.raises(ValueError):
        chatbot_metadata(
            account_alias=CANARY_PATIENT_NAME,
            session_alias=None,
            model="gemini-3.5-flash-lite",
            offered_tool_names=[],
            called_tool_names=[],
            measurement_codes=[],
            outcome="non_streaming_success",
        )


def test_canary_still_catches_leaked_blob() -> None:
    assert contains_sensitive_canary(
        {"prompt": f"환자 {CANARY_RESIDENT_ID} 공복혈당 {CANARY_GLUCOSE_VALUE} mg/dL"}
    )


def test_allowed_metadata_separates_offered_and_called_tools() -> None:
    secret = "secret-secret-secret-secret-1234"
    payload = chatbot_metadata(
        account_alias=hmac_alias("account", "uuid-here", secret),
        session_alias=hmac_alias("session", "sess", secret),
        model="openai:gpt-4o",
        offered_tool_names=["search_hospital", "query_health_records"],
        called_tool_names=["search_hospital"],
        measurement_codes=["fasting_glucose"],
        outcome="non_streaming_success",
    )
    assert payload["offered_tool_names"] == ["search_hospital", "query_health_records"]
    assert payload["called_tool_names"] == ["search_hospital"]
    assert payload["tool_call_count"] == 1
    assert payload["langfuse_export"] is False
    assert payload["outcome"] == "non_streaming_success"


def test_langfuse_enabled_requires_dedicated_hmac_secret() -> None:
    with pytest.raises(ValidationError, match="OBSERVABILITY_HMAC_SECRET"):
        Config(LANGFUSE_ENABLED=True, OBSERVABILITY_HMAC_SECRET="")


def test_exact_values_require_synthetic_flag() -> None:
    with pytest.raises(ValidationError, match="SYNTHETIC_DATA_ONLY"):
        Config(ENV=Env.LOCAL, OBSERVABILITY_EXACT_VALUES=True, SYNTHETIC_DATA_ONLY=False)


def test_exact_values_forbidden_in_production_even_if_synthetic() -> None:
    with pytest.raises(ValidationError, match="프로덕션"):
        Config(
            ENV=Env.PROD,
            SYNTHETIC_DATA_ONLY=True,
            OBSERVABILITY_EXACT_VALUES=True,
        )
