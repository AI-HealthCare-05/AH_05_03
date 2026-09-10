from collections.abc import AsyncIterator
from typing import Any, TypeVar, cast
from unittest.mock import AsyncMock

import pytest
from pydantic import BaseModel

from app.dtos.health_assistant import (
    ChatMessage,
    HealthAssistantChatRequest,
    HealthAssistantResponse,
    HealthAssistantScopeDecision,
    UserLocation,
)
from app.dtos.medical_facility import FacilityItem, FacilitySearchResult
from app.services.health_assistant import HealthAssistantService
from app.services.medical_facility_tools import (
    FACILITY_TOOL_DECLARATIONS,
    execute_facility_tool,
    get_facility_tools,
)

T = TypeVar("T", bound=BaseModel)


@pytest.mark.asyncio
async def test_execute_facility_tool_emergency_room() -> None:
    mock_client = AsyncMock()
    mock_client.search_nearby_emergency_room.return_value = FacilitySearchResult(
        search_type="emergency_room",
        count=1,
        items=[
            FacilityItem(
                name="서울대병원",
                address="서울 종로구 대학로 101",
                phone="02-2072-2114",
                emergency_room_phone="02-2072-1182",
                distance_m=500,
            )
        ],
        emergency_notice="응급 상황 시 즉시 119에 연락하세요.",
    )

    result = await execute_facility_tool(
        "search_nearby_emergency_room",
        {"latitude": 37.57, "longitude": 126.99},
        client=mock_client,
    )

    assert result is not None
    assert result.search_type == "emergency_room"
    assert result.count == 1
    assert result.items[0].name == "서울대병원"
    mock_client.search_nearby_emergency_room.assert_awaited_once_with(
        latitude=37.57, longitude=126.99, radius=10000, stage1=None, stage2=None
    )


@pytest.mark.asyncio
async def test_execute_facility_tool_hospital() -> None:
    mock_client = AsyncMock()
    mock_client.search_nearby_hospital.return_value = FacilitySearchResult(
        search_type="hospital",
        count=1,
        items=[
            FacilityItem(
                name="행복한의원",
                category="의원",
                address="서울 강남구 역삼동 123",
                phone="02-123-4567",
                distance_m=300,
            )
        ],
    )

    result = await execute_facility_tool(
        "search_nearby_hospital",
        {"latitude": 37.5, "longitude": 127.0, "radius": 1500, "keyword": "의원"},
        client=mock_client,
    )

    assert result is not None
    assert result.search_type == "hospital"
    assert result.items[0].name == "행복한의원"
    mock_client.search_nearby_hospital.assert_awaited_once_with(
        latitude=37.5, longitude=127.0, radius=1500, keyword="의원"
    )


@pytest.mark.asyncio
async def test_execute_facility_tool_unknown_name() -> None:
    mock_client = AsyncMock()
    result = await execute_facility_tool(
        "non_existent_tool",
        {},
        client=mock_client,
    )
    assert result is None


def test_get_facility_tools_declaration_structure() -> None:
    tools = get_facility_tools()
    assert len(tools) == 1
    tool_names = [decl.name for decl in FACILITY_TOOL_DECLARATIONS]
    assert "search_nearby_emergency_room" in tool_names
    assert "search_nearby_hospital" in tool_names
    assert "search_nearby_pharmacy" in tool_names


class MockToolEnabledLLMClient:
    """도구 호출 및 최종 구조화 응답을 시뮬레이션하는 LLM 클라이언트"""

    def __init__(self, final_response: HealthAssistantResponse):
        self.final_response = final_response

    async def generate_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> T:
        if response_schema is HealthAssistantScopeDecision:
            return cast(
                T,
                HealthAssistantScopeDecision(
                    scope="health",
                    requires_authoritative_evidence=True,
                    required_evidence_types=["facility"],
                ),
            )
        return cast(T, self.final_response)

    def stream_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> AsyncIterator[str]:
        async def _stream() -> AsyncIterator[str]:
            raw_json = self.final_response.model_dump_json()
            for char in raw_json:
                yield char

        return _stream()

    async def generate_structured_response_with_tools(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
        tools: Any = None,
        tool_executor: Any = None,
    ) -> tuple[T, Any | None]:
        tool_result = None
        if tool_executor:
            tool_result = await tool_executor("search_nearby_emergency_room", {"latitude": 37.5, "longitude": 127.0})
        return cast(T, self.final_response), tool_result

    async def stream_structured_response_with_tools(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
        tools: Any = None,
        tool_executor: Any = None,
    ) -> tuple[AsyncIterator[str], Any | None]:
        tool_result = None
        if tool_executor:
            tool_result = await tool_executor("search_nearby_emergency_room", {"latitude": 37.5, "longitude": 127.0})

        async def _stream() -> AsyncIterator[str]:
            raw_json = self.final_response.model_dump_json()
            for char in raw_json:
                yield char

        return _stream(), tool_result


@pytest.mark.asyncio
async def test_health_assistant_service_with_facility_tool_flow() -> None:
    facility_result = FacilitySearchResult(
        search_type="emergency_room",
        count=1,
        items=[
            FacilityItem(
                name="강남세브란스병원",
                address="서울 강남구 언주로 211",
                phone="02-2019-2114",
                emergency_room_phone="02-2019-3333",
                distance_m=800,
            )
        ],
        emergency_notice="응급 상황 시 즉시 119에 연락하세요.",
    )

    mock_facility_client = AsyncMock()
    mock_facility_client.search_nearby_emergency_room.return_value = facility_result

    expected_resp = HealthAssistantResponse(
        intent="search_facility",
        assistant_message="가장 가까운 응급실은 강남세브란스병원입니다.",
        facility_search_draft=facility_result,
        emergency_notice="응급 상황 시 즉시 119에 연락하세요.",
        suggested_quick_replies=["가까운 약국도 알려줘"],
    )

    mock_llm = MockToolEnabledLLMClient(expected_resp)
    service = HealthAssistantService(
        llm_client=mock_llm,
        facility_client=mock_facility_client,
    )

    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="근처 응급실 찾아줘")],
        user_location=UserLocation(latitude=37.498, longitude=127.049),
    )

    resp = await service.respond(request)

    assert resp.intent == "search_facility"
    assert resp.facility_search_draft is not None
    assert resp.facility_search_draft.count == 1
    assert resp.facility_search_draft.items[0].name == "강남세브란스병원"
    assert resp.emergency_notice is not None
    assert "119" in resp.emergency_notice
    mock_facility_client.search_nearby_emergency_room.assert_awaited_once()


@pytest.mark.asyncio
async def test_streaming_emits_facility_before_final_response() -> None:
    """시설 카드는 Gemini 안내문이 완성되기 전에 바로 화면으로 보낸다."""
    facility_result = FacilitySearchResult(
        facility_type="pharmacy",
        total_count=1,
        items=[FacilityItem(name="봄약국", address="서울 중구 세종대로 1")],
    )
    expected_resp = HealthAssistantResponse(
        intent="search_facility",
        assistant_message="가까운 봄약국을 안내해 드릴게요.",
        suggested_quick_replies=[],
    )
    mock_facility_client = AsyncMock()
    mock_facility_client.search_nearby_emergency_room.return_value = facility_result
    service = HealthAssistantService(
        llm_client=MockToolEnabledLLMClient(expected_resp),
        facility_client=mock_facility_client,
    )
    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="근처 약국 찾아줘")],
        user_location=UserLocation(latitude=37.5, longitude=127.0),
    )

    events = [event async for event in service.stream(request)]
    names = [name for name, _ in events]
    facility_index = names.index("facility")
    assert facility_index < names.index("delta")
    assert facility_index < names.index("result")
    assert events[facility_index][1]["items"][0]["name"] == "봄약국"
