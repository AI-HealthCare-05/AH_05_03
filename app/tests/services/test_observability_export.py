from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Config
from app.services.observability.events import chatbot_metadata, document_vision_metadata
from app.services.observability.exporter import build_ingestion_envelope, export_allowlisted_metadata
from app.services.observability.privacy import (
    CANARY_GLUCOSE_VALUE,
    CANARY_PATIENT_NAME,
    CANARY_RESIDENT_ID,
    assert_allowlisted_vision_metadata,
    assert_metadata_only_envelope,
    hmac_alias,
    mask_for_provider,
)


def test_langfuse_enabled_requires_public_and_secret_keys() -> None:
    with pytest.raises(ValidationError, match="LANGFUSE_PUBLIC_KEY"):
        Config(
            LANGFUSE_ENABLED=True,
            OBSERVABILITY_HMAC_SECRET="secret-secret-secret-secret-1234",
            LANGFUSE_PUBLIC_KEY="",
            LANGFUSE_SECRET_KEY="",
        )


def test_provider_mask_is_separate_from_observability_allowlist() -> None:
    raw = f"환자 {CANARY_PATIENT_NAME} {CANARY_RESIDENT_ID} 공복혈당 {CANARY_GLUCOSE_VALUE} mg/dL"
    masked = mask_for_provider(raw)
    assert CANARY_PATIENT_NAME not in masked
    assert CANARY_RESIDENT_ID not in masked
    assert "[redacted_rid]" in masked
    assert "[redacted_name]" in masked
    leaked = chatbot_metadata(
        account_alias=None,
        session_alias=None,
        model="gemini-3.5-flash-lite",
        offered_tool_names=[],
        called_tool_names=[],
        measurement_codes=[],
        outcome="non_streaming_success",
    )
    leaked["prompt"] = raw
    from app.services.observability.privacy import assert_allowlisted_chatbot_metadata

    with pytest.raises(ValueError, match="allowlist"):
        assert_allowlisted_chatbot_metadata(leaked)


def test_vision_metadata_rejects_document_body() -> None:
    payload = document_vision_metadata(
        account_alias=None,
        job_alias=hmac_alias("job", "job-1", "secret-secret-secret-secret-1234"),
        model="gemini-3.5-flash-lite",
        page_count=2,
        outcome="vision_success",
    )
    assert payload["kind"] == "document_vision"
    assert payload["kind"] != "chatbot"
    leaked = dict(payload)
    leaked["text"] = f"공복혈당 {CANARY_GLUCOSE_VALUE} mg/dL"
    with pytest.raises(ValueError, match="allowlist"):
        assert_allowlisted_vision_metadata(leaked)


def test_ingestion_envelope_has_metadata_only() -> None:
    payload = chatbot_metadata(
        account_alias=hmac_alias("account", "acct-1", "secret-secret-secret-secret-1234"),
        session_alias=hmac_alias("session", "sess-1", "secret-secret-secret-secret-1234"),
        model="openai:gpt-4o",
        offered_tool_names=["search_hospital"],
        called_tool_names=[],
        measurement_codes=["fasting_glucose"],
        outcome="streaming_success",
    )
    envelope = build_ingestion_envelope(payload)
    body = envelope["batch"][0]["body"]
    assert body["name"] == "chatbot"
    assert body["metadata"]["kind"] == "chatbot"
    assert "input" not in body
    assert "output" not in body
    assert CANARY_GLUCOSE_VALUE not in str(body["metadata"])
    assert_metadata_only_envelope(envelope)
    leaked = {"batch": [{"body": {"input": raw_prompt(), "metadata": payload}}]}
    with pytest.raises(ValueError, match="input"):
        assert_metadata_only_envelope(leaked)


def raw_prompt() -> str:
    return f"환자 {CANARY_RESIDENT_ID} 공복혈당 {CANARY_GLUCOSE_VALUE} mg/dL"


def test_export_is_skipped_when_disabled(monkeypatch) -> None:
    from app.core import config
    from app.services.observability import exporter

    monkeypatch.setattr(config, "LANGFUSE_ENABLED", False)
    called = []
    monkeypatch.setattr(exporter, "dispatch_ingestion", lambda envelope: called.append(envelope))
    payload = chatbot_metadata(
        account_alias=None,
        session_alias=None,
        model=None,
        offered_tool_names=[],
        called_tool_names=[],
        measurement_codes=[],
        outcome="non_streaming_success",
    )
    export_allowlisted_metadata(payload)
    assert called == []


def test_export_dispatches_envelope_when_enabled(monkeypatch) -> None:
    from app.core import config
    from app.services.observability import exporter

    monkeypatch.setattr(config, "LANGFUSE_ENABLED", True)
    captured: list[dict] = []
    monkeypatch.setattr(exporter, "dispatch_ingestion", lambda envelope: captured.append(envelope))
    payload = document_vision_metadata(
        account_alias=None,
        job_alias=None,
        model="openai:gpt-4o",
        page_count=1,
        outcome="vision_error",
    )
    export_allowlisted_metadata(payload)
    assert len(captured) == 1
    body = captured[0]["batch"][0]["body"]
    assert body["name"] == "document_vision"
    assert "input" not in body
    assert body["metadata"]["outcome"] == "vision_error"


def test_export_failure_does_not_raise(monkeypatch) -> None:
    from app.core import config
    from app.services.observability import exporter

    def boom(_payload: dict) -> dict:
        raise RuntimeError("down")

    monkeypatch.setattr(config, "LANGFUSE_ENABLED", True)
    monkeypatch.setattr(exporter, "build_ingestion_envelope", boom)
    export_allowlisted_metadata({"kind": "chatbot"})


def test_ingest_accepts_2xx_and_records_401_without_raising() -> None:
    import httpx

    from app.services.observability import exporter

    exporter.reset_ingest_stats()
    payload = chatbot_metadata(
        account_alias=None,
        session_alias=None,
        model=None,
        offered_tool_names=[],
        called_tool_names=[],
        measurement_codes=[],
        outcome="non_streaming_success",
    )
    envelope = build_ingestion_envelope(payload)

    def ok(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"success": True})

    with httpx.Client(transport=httpx.MockTransport(ok)) as client:
        exporter.post_ingestion(envelope, client=client)
    assert exporter.ingest_stats()["ok"] == 1

    exporter.reset_ingest_stats()

    def unauthorized(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="unauthorized body must not be logged")

    with httpx.Client(transport=httpx.MockTransport(unauthorized)) as client:
        exporter.post_ingestion(envelope, client=client)
    assert exporter.ingest_stats()["auth_failed"] == 1


def test_ingest_timeout_is_counted_not_raised() -> None:
    import httpx

    from app.services.observability import exporter

    exporter.reset_ingest_stats()
    payload = chatbot_metadata(
        account_alias=None,
        session_alias=None,
        model=None,
        offered_tool_names=[],
        called_tool_names=[],
        measurement_codes=[],
        outcome="non_streaming_success",
    )
    envelope = build_ingestion_envelope(payload)

    def timeout(_request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("slow")

    with httpx.Client(transport=httpx.MockTransport(timeout)) as client:
        exporter.post_ingestion(envelope, client=client)
    assert exporter.ingest_stats()["timeout"] == 1


def test_chat_contents_mask_resident_id_before_gemini() -> None:
    from app.dtos.health_assistant import ChatMessage
    from app.integrations.llm.gemini import _contents_from_messages

    contents = _contents_from_messages([ChatMessage(role="user", content=f"주민번호 {CANARY_RESIDENT_ID} 입니다")])
    text = contents[0].parts[0].text
    assert CANARY_RESIDENT_ID not in text
    assert "[redacted_rid]" in text
