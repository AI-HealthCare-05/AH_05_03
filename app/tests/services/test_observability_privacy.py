from app.services.observability.events import chatbot_metadata, production_measurement_observation
from app.services.observability.privacy import (
    CANARY_GLUCOSE_VALUE,
    CANARY_PATIENT_NAME,
    CANARY_RESIDENT_ID,
    assert_metadata_only,
    contains_sensitive,
    hmac_alias,
)


def test_hmac_alias_is_stable_and_not_raw_id() -> None:
    first = hmac_alias("account", "acct-1", "secret")
    second = hmac_alias("account", "acct-1", "secret")
    other = hmac_alias("account", "acct-2", "secret")
    assert first == second
    assert first != other
    assert first is not None
    assert "acct-1" not in first


def test_production_metadata_passes_canary() -> None:
    payload = production_measurement_observation(["fasting_glucose"], "user_confirmed_ocr")
    assert_metadata_only(payload)
    assert payload["exact_values_logged"] is False
    assert CANARY_GLUCOSE_VALUE not in str(payload)


def test_chatbot_metadata_rejects_leaked_identity() -> None:
    leaked = chatbot_metadata(
        account_alias=CANARY_PATIENT_NAME,
        session_alias=None,
        model="gemini-3.5-flash-lite",
        tool_names=[],
        measurement_codes=[],
        error=False,
    )
    assert contains_sensitive(leaked)


def test_chatbot_metadata_rejects_resident_id_and_lab_value() -> None:
    leaked = {
        "prompt": f"환자 {CANARY_RESIDENT_ID} 공복혈당 {CANARY_GLUCOSE_VALUE} mg/dL",
    }
    assert contains_sensitive(leaked)


def test_allowed_metadata_has_codes_not_values() -> None:
    payload = chatbot_metadata(
        account_alias=hmac_alias("account", "uuid-here", "s"),
        session_alias=hmac_alias("session", "sess", "s"),
        model="gemini-3.5-flash-lite",
        tool_names=["search_hospital"],
        measurement_codes=["fasting_glucose"],
        error=False,
    )
    assert_metadata_only(payload)
    assert payload["kind"] == "chatbot"
    assert payload["measurement_codes"] == ["fasting_glucose"]
