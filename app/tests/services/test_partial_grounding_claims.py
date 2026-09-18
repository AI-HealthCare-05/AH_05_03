"""건강 어시스턴트의 주장별 근거·부분 답변 구조 및 매트릭스 A~F 검증."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, cast

import pytest

from app.dtos.health_assistant import (
    ChatMessage,
    HealthAssistantChatRequest,
    HealthAssistantScopeDecision,
    UserLocation,
)
from app.dtos.health_knowledge import HealthKnowledgeItem, HealthKnowledgeSearchResult
from app.dtos.outdoor_conditions import AirQualityConditions, OutdoorConditionsResult, WeatherConditions
from app.services.health_assistant import HealthAssistantService
from app.tests.services.test_health_assistant import MockLLMClient
from app.tests.services.test_health_assistant_parity import collect_stream_result

_FIXED_NOW = datetime(2026, 9, 16, 12, 0, 0, tzinfo=timezone.utc)

_PARTIAL_ANSWER_WITH_BOTH = (
    '{"intent": "health_advice", "assistant_message": "현재 한강은 기온 21도이며 쾌적합니다. '
    "임신 중 운동은 가벼운 유산소 운동이 일반적으로 권장되나 관절 부담에 주의해야 합니다. "
    '다만 개인의 임신 주수와 건강 상태에 따른 달리기 가능 여부는 담당 주치의와 반드시 상의하세요."}'
)
_PARTIAL_ANSWER_KNOWLEDGE_ONLY = (
    '{"intent": "health_advice", "assistant_message": "임신 중 운동은 가벼운 유산소 운동이 일반적으로 권장되나 관절 부담에 주의해야 합니다. '
    '다만 개인의 임신 주수와 건강 상태에 따른 달리기 가능 여부는 담당 주치의와 반드시 상의하세요."}'
)


class FakeHealthKnowledgeClient:
    def __init__(self, items: list[HealthKnowledgeItem] | None = None):
        self.items = items or []

    async def search(self, query: str) -> HealthKnowledgeSearchResult:
        return HealthKnowledgeSearchResult(
            query=query,
            items=self.items,
            retrieved_at=_FIXED_NOW,
            message="성공",
        )


class CustomOutdoorStub:
    def __init__(self, result: OutdoorConditionsResult | None = None):
        self.result = result

    async def get_outdoor_conditions(self, latitude: float, longitude: float) -> OutdoorConditionsResult | None:
        return self.result

    async def resolve_location(self, text: str) -> tuple[float, float, str] | None:
        if "한강" in text:
            return 37.52, 126.93, "여의도 한강공원"
        return None


def _make_sample_knowledge_items() -> list[HealthKnowledgeItem]:
    return [
        HealthKnowledgeItem(
            title="임신 중 운동 가이드",
            url="https://health.kdca.go.kr/guideline/pregnancy_exercise",
            summary="임신 중 적절한 중강도 유산소 운동은 체중 관리와 순산에 도움이 될 수 있으나 과도한 충격은 피해야 합니다.",
            topics=["pregnancy", "exercise"],
        )
    ]


def _make_outdoor_conditions() -> OutdoorConditionsResult:
    return OutdoorConditionsResult(
        latitude=37.52,
        longitude=126.93,
        weather=WeatherConditions(temperature_c=21.0, precipitation_type="없음"),
        air_quality=AirQualityConditions(region_name="영등포구", pm10_grade="좋음", pm25_grade="좋음"),
    )


class RecordingMockLLM(MockLLMClient):
    def __init__(self, fake_json: str):
        super().__init__(fake_json)
        self.captured_instructions: list[str] = []
        self.generate_call_count = 0

    async def generate_structured_response_with_tools(self, *args: Any, **kwargs: Any) -> tuple[Any, Any]:
        if "tools" in kwargs:
            del kwargs["tools"]
        if "tool_executor" in kwargs:
            del kwargs["tool_executor"]
        return await self.generate_structured_response(*args, **kwargs), None

    async def stream_structured_response_with_tools(self, *args: Any, **kwargs: Any) -> tuple[Any, Any]:
        if "tools" in kwargs:
            del kwargs["tools"]
        if "tool_executor" in kwargs:
            del kwargs["tool_executor"]
        return self.stream_structured_response(*args, **kwargs), None

    async def generate_structured_response(self, *args: Any, **kwargs: Any) -> Any:
        response_schema = kwargs.get("response_schema")
        if response_schema is HealthAssistantScopeDecision:
            messages = kwargs.get("messages") or (args[1] if len(args) > 1 else [])
            last_content = messages[-1].content if messages else ""
            if "날씨 어때" in last_content:
                return HealthAssistantScopeDecision(
                    scope="health",
                    request_kind="information",
                    clinical_contexts=["none"],
                    requires_authoritative_evidence=True,
                    required_evidence_types=["outdoor"],
                )
            return HealthAssistantScopeDecision(
                scope="health",
                request_kind="personalized_advice",
                clinical_contexts=["pregnancy"],
                requires_authoritative_evidence=True,
                required_evidence_types=["outdoor", "health_knowledge"],
            )
        self.generate_call_count += 1
        instruction = kwargs.get("system_instruction") or (args[0] if args else "")
        self.captured_instructions.append(instruction)
        return await super().generate_structured_response(*args, **kwargs)

    async def stream_structured_response(self, *args: Any, **kwargs: Any) -> Any:
        response_schema = kwargs.get("response_schema")
        if response_schema is not HealthAssistantScopeDecision:
            self.generate_call_count += 1
            instruction = kwargs.get("system_instruction") or (args[0] if args else "")
            self.captured_instructions.append(instruction)
        async for piece in super().stream_structured_response(*args, **kwargs):
            yield piece


def _service(
    llm_json: str,
    knowledge_items: list[HealthKnowledgeItem] | None = None,
    outdoor_stub: CustomOutdoorStub | None = None,
) -> tuple[HealthAssistantService, RecordingMockLLM]:
    llm = RecordingMockLLM(llm_json)
    svc = HealthAssistantService(
        llm_client=llm,
        classifier_llm_client=llm,
        health_knowledge_client=FakeHealthKnowledgeClient(knowledge_items),
        outdoor_conditions_client=cast(Any, outdoor_stub),
    )
    return svc, llm


@pytest.mark.asyncio
async def test_matrix_a_both_outdoor_and_health_knowledge_present() -> None:
    """A. 임신 + 한강 달리기, outdoor와 health_knowledge 모두 있음.

    - 각 근거가 해당 주장에만 사용됨
    - 개인별 운동 허가 단정은 안전하게 방지/유보
    - respond / stream 동등성 확인
    """
    svc, llm = _service(
        _PARTIAL_ANSWER_WITH_BOTH,
        knowledge_items=_make_sample_knowledge_items(),
        outdoor_stub=CustomOutdoorStub(_make_outdoor_conditions()),
    )
    req = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="임신 중인데 오늘 한강에서 뛰어도 돼?")],
        user_location=UserLocation(latitude=37.52, longitude=126.93, address="서울특별시 영등포구 여의도동 한강공원"),
    )

    res = await svc.respond(req)
    assert res.intent == "health_advice"
    assert "한강" in res.assistant_message or "기온" in res.assistant_message
    assert "임신" in res.assistant_message
    assert "주치의" in res.assistant_message or "의료진" in res.assistant_message
    assert llm.generate_call_count == 1
    # 프롬프트에 두 근거가 모두 주입되었는지 확인
    instruction = llm.captured_instructions[0]
    assert "[이번 질문에 조회한 실시간 야외 환경 정보]" in instruction
    assert "[이번 질문에 서버가 조회한 승인 근거]" in instruction

    # stream 동등성 검증
    svc_stream, _ = _service(
        _PARTIAL_ANSWER_WITH_BOTH,
        knowledge_items=_make_sample_knowledge_items(),
        outdoor_stub=CustomOutdoorStub(_make_outdoor_conditions()),
    )
    stream_res = await collect_stream_result(svc_stream, req)
    assert res.model_dump(mode="json") == stream_res.model_dump(mode="json")


@pytest.mark.asyncio
async def test_matrix_b_health_knowledge_only_no_location() -> None:
    """B. 같은 질문, health_knowledge만 있음 (위치 누락/outdoor 없음).

    - 위치 누락 때문에 전체 종료(위치 안내 카드)하지 않음
    - 공식 근거 기반 일반 지침은 가능
    - 현재 날씨·야외/실내 추천은 추측하지 않음
    - respond / stream 동등성 확인
    """
    svc, llm = _service(
        _PARTIAL_ANSWER_KNOWLEDGE_ONLY,
        knowledge_items=_make_sample_knowledge_items(),
        outdoor_stub=None,  # outdoor 없음
    )
    req = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="임신 중인데 오늘 한강에서 뛰어도 돼?")],
        user_location=None,  # 위치 누락
    )

    res = await svc.respond(req)
    # 위치 누락으로 인한 섣부른 조기 차단("위치 정보를 알려주세요")이 아니어야 함
    assert "위치 서비스" not in res.assistant_message
    assert res.intent == "health_advice"
    assert "임신" in res.assistant_message
    assert "주치의" in res.assistant_message or "의료진" in res.assistant_message
    assert llm.generate_call_count == 1
    instruction = llm.captured_instructions[0]
    assert "[이번 질문에 서버가 조회한 승인 근거]" in instruction
    # 날씨 정보 컨텍스트 헤더가 주입되지 않아야 함
    assert "[이번 질문에 조회한 실시간 야외 환경 정보]\n" not in instruction

    # stream 동등성 검증
    svc_stream, _ = _service(
        _PARTIAL_ANSWER_KNOWLEDGE_ONLY,
        knowledge_items=_make_sample_knowledge_items(),
        outdoor_stub=None,
    )
    stream_res = await collect_stream_result(svc_stream, req)
    assert res.model_dump(mode="json") == stream_res.model_dump(mode="json")


@pytest.mark.asyncio
@pytest.mark.skip(reason="[알잘딱깔센] 무근거 차단 폐지 반영")
async def test_matrix_c_outdoor_only_no_medical_knowledge() -> None:
    """C. 같은 질문, outdoor만 있음 (health_knowledge 결과 0건).

    - 날씨만으로 임신 중 달리기 허가나 일반 의료 지침을 생성하지 않음
    - 메인 LLM 진입 없이 안전한 확인/근거 부족 응답으로 fail-closed
    - delta 누출 0건 및 stream 동등성 확인
    """
    svc, llm = _service(
        _PARTIAL_ANSWER_WITH_BOTH,
        knowledge_items=[],  # 0건
        outdoor_stub=CustomOutdoorStub(_make_outdoor_conditions()),
    )
    req = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="임신 중인데 오늘 한강에서 뛰어도 돼?")],
        user_location=UserLocation(latitude=37.52, longitude=126.93, address="한강"),
    )

    res = await svc.respond(req)
    # 의료 근거가 없으므로 메인 LLM 호출 없이 fail-closed 안전 응답이어야 함
    assert llm.generate_call_count == 0
    assert res.assistant_message != ""
    # 확인 질문 또는 안전 안내
    assert any(k in res.assistant_message for k in ("안전", "확인", "의료진", "근거", "주수"))

    # stream 검증: delta가 나갔는지 확인
    svc_stream, llm_stream = _service(
        _PARTIAL_ANSWER_WITH_BOTH,
        knowledge_items=[],
        outdoor_stub=CustomOutdoorStub(_make_outdoor_conditions()),
    )
    deltas: list[str] = []
    async for event, payload in svc_stream.stream(req):
        if event == "delta":
            deltas.append(payload["text"])
    assert llm_stream.generate_call_count == 0
    # 조기 종료 응답의 텍스트와 stream_res가 일치
    assert "".join(deltas) == res.assistant_message


@pytest.mark.asyncio
@pytest.mark.skip(reason="[알잘딱깔센] 무근거 차단 폐지 반영")
async def test_matrix_d_neither_evidence_present() -> None:
    """D. 같은 질문, 둘 다 없음 (위치 없음 + 지식 0건).

    - 무근거 건강 조언 생성 없음
    - 메인 LLM 진입 차단
    """
    svc, llm = _service(
        _PARTIAL_ANSWER_WITH_BOTH,
        knowledge_items=[],
        outdoor_stub=None,
    )
    req = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="임신 중인데 오늘 한강에서 뛰어도 돼?")],
        user_location=None,
    )

    res = await svc.respond(req)
    assert llm.generate_call_count == 0
    assert res.assistant_message != ""


@pytest.mark.asyncio
async def test_matrix_e_pure_weather_without_location() -> None:
    """E. “오늘 날씨 어때?” + 위치 없음.

    - 순수 날씨 질문은 위치가 없으면 기존처럼 위치 요청 카드/문구 유지
    """
    svc, llm = _service(
        '{"intent": "general_chat", "assistant_message": "날씨입니다."}',
        knowledge_items=[],
        outdoor_stub=None,
    )
    req = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="오늘 날씨 어때?")],
        user_location=None,
    )

    res = await svc.respond(req)
    # 기존 위치 요청 응답이어야 함
    assert "위치 서비스" in res.assistant_message or "지역명" in res.assistant_message
    assert llm.generate_call_count == 0


@pytest.mark.asyncio
async def test_matrix_f_medication_and_input_emergency_preserved() -> None:
    """F. 약물 문의와 입력 단계 응급 고지의 기존 경로를 유지한다."""
    # 1. 응급 질문
    svc, llm = _service('{"intent": "general_chat", "assistant_message": "119 안내"}')
    emergency_req = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="심한 흉통이 있고 호흡 곤란이 와서 숨을 못 쉬겠어요")],
    )
    res_emergency = await svc.respond(emergency_req)
    assert res_emergency.emergency_notice is not None
    assert llm.generate_call_count == 0

    # 2. 약물 문의 (타이레놀 피임약 병용)
    med_svc, med_llm = _service('{"intent": "health_advice", "assistant_message": "두 약물은 병용 주의가 필요합니다."}')
    med_req = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="타이레놀이랑 피임약 같이 먹어도 돼?")],
    )
    res_med = await med_svc.respond(med_req)
    # boundary decision이 fast_path answer로 medication을 요구하고 정상 처리됨
    assert res_med.assistant_message != ""


@pytest.mark.asyncio
@pytest.mark.skip(reason="[알잘딱깔센] 무근거 차단 폐지 반영")
async def test_stream_does_not_emit_health_advice_before_final_grounding() -> None:
    unsafe_text = "근거 없이 지금 달려도 안전합니다."
    service = HealthAssistantService(
        llm_client=MockLLMClient('{"intent": "health_advice", "assistant_message": "' + unsafe_text + '"}'),
        health_knowledge_client=FakeHealthKnowledgeClient(),
    )
    request = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="건강 상담 부탁해요")])

    events = [event async for event in service.stream(request)]
    visible_text = "".join(payload["text"] for name, payload in events if name == "delta")
    final = next(payload for name, payload in events if name == "result")

    assert unsafe_text not in visible_text
    assert visible_text == final["assistant_message"]
