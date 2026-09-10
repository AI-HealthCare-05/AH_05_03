import uuid
from collections.abc import AsyncIterator
from datetime import date
from typing import Any, cast

import pytest
from pydantic import ValidationError

from app.dtos.health_assistant import (
    ChatMessage,
    HealthAssistantChatRequest,
    HealthAssistantResponse,
    HealthAssistantScopeDecision,
    ProfileContext,
)
from app.dtos.health_record_query import (
    HealthRecordQueryArguments,
    HealthRecordQueryMatch,
    HealthRecordQueryPeriod,
    HealthRecordQueryResult,
)
from app.models.service_accounts import ServiceAccount
from app.prompts.health_assistant import build_system_instruction
from app.services.health_assistant import HealthAssistantService
from app.services.health_records import HealthRecordService


def _request(message: str) -> HealthAssistantChatRequest:
    return HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=message)])


def test_query_tool_arguments_never_accept_account_or_profile_ids() -> None:
    assert set(HealthRecordQueryArguments.model_fields) == {
        "record_type",
        "period",
        "metric",
        "operator",
        "threshold",
        "aggregation",
    }

    with pytest.raises(ValidationError):
        HealthRecordQueryArguments.model_validate(
            {
                "record_type": "blood_pressure",
                "period": {"type": "relative_months", "value": 3},
                "metric": "systolic",
                "operator": "gt",
                "threshold": 140,
                "aggregation": "count_days",
                "profile_id": "00000000-0000-0000-0000-000000000000",
            }
        )


@pytest.mark.parametrize("operator", ["eq", "lt", "sql"])
def test_query_tool_rejects_unsupported_operator(operator: str) -> None:
    with pytest.raises(ValidationError):
        HealthRecordQueryArguments.model_validate(
            {
                "record_type": "blood_pressure",
                "period": {"type": "relative_months", "value": 3},
                "metric": "systolic",
                "operator": operator,
                "threshold": 140,
                "aggregation": "count_days",
            }
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("record_type", "medication"),
        ("metric", "payload->>'systolic'"),
    ],
)
def test_query_tool_rejects_non_whitelisted_record_type_and_metric(field: str, value: str) -> None:
    payload = {
        "record_type": "blood_pressure",
        "period": {"type": "relative_months", "value": 3},
        "metric": "systolic",
        "operator": "gt",
        "threshold": 140,
        "aggregation": "count_days",
    }
    payload[field] = value

    with pytest.raises(ValidationError):
        HealthRecordQueryArguments.model_validate(payload)


def test_deep_blood_pressure_count_question_enables_query_tool() -> None:
    assert HealthAssistantService._needs_health_record_query_tool(
        _request("지난 3개월 동안 혈압 140을 넘은 날이 며칠이야?")
    )
    assert HealthAssistantService._needs_health_record_query_tool(
        _request("최근 6개월 혈압 140 이상인 날은 몇 번이야?")
    )


@pytest.mark.parametrize(
    "message",
    [
        "안녕하세요",
        "오늘 혈압 140에 80 나왔어",
        "최근 혈압 기록 보여줘",
        "최근 혈압 140을 넘은 날이 며칠이야?",
        "작년 혈압 140 이상인 날이 몇 번이야?",
        "지난 13개월 혈압 140 이상인 날이 몇 번이야?",
        "지난달 혈압 그래프 보여줘",
    ],
)
def test_non_aggregate_questions_do_not_enable_query_tool(message: str) -> None:
    assert not HealthAssistantService._needs_health_record_query_tool(_request(message))


def test_recent_records_are_only_prefetched_for_relevant_health_questions() -> None:
    assert not HealthAssistantService._needs_recent_records_context(_request("안녕하세요"))
    assert HealthAssistantService._needs_recent_records_context(_request("오늘 술 마셔도 돼?"))
    assert HealthAssistantService._needs_recent_records_context(_request("오른쪽 허벅지가 아파"))
    assert not HealthAssistantService._needs_recent_records_context(
        _request("지난 3개월 동안 혈압 140을 넘은 날이 며칠이야?")
    )


def test_profile_id_is_not_inserted_into_llm_system_instruction() -> None:
    profile_id = uuid.uuid4()
    private_summary = "최근 혈압은 141/90mmHg입니다."
    instruction = build_system_instruction(
        ProfileContext(profile_id=profile_id, profile_name="본인", recent_records_summary=None)
    )

    assert str(profile_id) not in instruction
    assert private_summary not in instruction


class _FakeRecordService:
    async def query_numeric_summary(self, *_args: Any, **_kwargs: Any) -> HealthRecordQueryResult:
        return HealthRecordQueryResult(
            record_type="blood_pressure",
            metric="systolic",
            operator="gt",
            threshold=140,
            period=HealthRecordQueryPeriod(date_from=date(2026, 6, 8), date_to=date(2026, 9, 8)),
            matched_days=7,
            matched_measurements=9,
            total_measurements=42,
            latest_matches=[HealthRecordQueryMatch(date=date(2026, 9, 3), value=145)],
            message=("지난 3개월 동안 수축기 혈압이 140mmHg를 초과한 날은 총 7일이며, 해당 측정은 9회입니다."),
        )


class _FakeToolClient:
    async def generate_structured_response(self, **_kwargs: Any) -> HealthAssistantScopeDecision:
        return HealthAssistantScopeDecision(scope="health", requires_authoritative_evidence=False)

    async def stream_structured_response_with_tools(
        self,
        *,
        tool_executor: Any,
        **_kwargs: Any,
    ) -> tuple[AsyncIterator[str], HealthRecordQueryResult]:
        result = await tool_executor(
            "query_health_records",
            {
                "record_type": "blood_pressure",
                "period": {"type": "relative_months", "value": 3},
                "metric": "systolic",
                "operator": "gt",
                "threshold": 140,
                "aggregation": "count_days",
            },
        )

        async def wrong_llm_stream() -> AsyncIterator[str]:
            yield HealthAssistantResponse(
                intent="query_records",
                assistant_message="LLM이 잘못 계산한 값은 99일입니다.",
            ).model_dump_json()

        return wrong_llm_stream(), result


@pytest.mark.asyncio
async def test_health_query_stream_uses_authoritative_result_without_facility_event() -> None:
    account = ServiceAccount(id=uuid.uuid4(), email="query@example.com", password_hash="hash")
    profile_id = uuid.uuid4()
    service = HealthAssistantService(
        llm_client=cast(Any, _FakeToolClient()),
        health_record_service=cast(HealthRecordService, _FakeRecordService()),
    )
    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="지난 3개월 동안 혈압 140 넘은 날이 며칠이야?")],
        profile_context=ProfileContext(profile_id=profile_id, profile_name="본인"),
    )

    events = [event async for event in service.stream(request, account)]

    assert [name for name, _ in events] == ["delta", "result"]
    assert "99일" not in str(events)
    assert events[0][1]["text"].endswith("해당 측정은 9회입니다.")
    result_payload = events[1][1]
    assert result_payload["health_record_query_result"]["matched_days"] == 7
