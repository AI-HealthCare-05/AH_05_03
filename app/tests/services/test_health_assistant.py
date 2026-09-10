import uuid
from collections.abc import AsyncIterator
from typing import Any, TypeVar

import pytest
from pydantic import BaseModel

from app.dtos.health_assistant import (
    ChatMessage,
    CurrentLocation,
    HealthAssistantChatRequest,
    HealthAssistantResponse,
    HealthAssistantScopeDecision,
    ProfileContext,
)
from app.dtos.outdoor_conditions import AirQualityConditions, OutdoorConditionsResult, WeatherConditions
from app.services.health_assistant import HealthAssistantService

T = TypeVar("T", bound=BaseModel)


class MockLLMClient:
    """`LLMClientProtocol` 의 두 메서드를 다 흉내 낸다.

    스트리밍은 **한 글자씩** 흘린다 — 실제 모델도 토큰 단위로 오고, 덩어리로 주면
    부분 JSON 해독기가 경계를 밟을 일이 없어 시험이 되지 않는다.
    """

    def __init__(self, fake_json: str):
        self.fake_json = fake_json

    async def generate_structured_response(self, *args, **kwargs):
        if kwargs.get("response_schema") is HealthAssistantScopeDecision:
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=False,
            )
        return HealthAssistantResponse.model_validate_json(self.fake_json)

    async def stream_structured_response(self, *args, **kwargs):
        for character in self.fake_json:
            yield character


class CapturingLLMClient:
    def __init__(self) -> None:
        self.system_instruction = ""

    async def generate_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> T:
        self.system_instruction = system_instruction
        if response_schema is HealthAssistantScopeDecision:
            return response_schema.model_validate(
                {
                    "scope": "health",
                    "requires_authoritative_evidence": True,
                    "required_evidence_types": ["outdoor"],
                }
            )
        return response_schema.model_validate({"intent": "health_advice", "assistant_message": "확인했습니다."})

    async def stream_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> AsyncIterator[str]:
        yield '{"intent": "health_advice", "assistant_message": "확인했습니다."}'


class OutdoorConditionsStub:
    async def get_outdoor_conditions(self, latitude: float, longitude: float) -> OutdoorConditionsResult:
        assert (latitude, longitude) == (37.5665, 126.978)
        return OutdoorConditionsResult(
            latitude=latitude,
            longitude=longitude,
            weather=WeatherConditions(
                temperature_c=23.4,
                humidity_percent=55,
                precipitation_type="강수 없음",
                wind_speed_mps=1.2,
            ),
            air_quality=AirQualityConditions(
                region_name="서울",
                station_name="중구",
                pm10=24,
                pm25=11,
                pm10_grade="좋음",
                pm25_grade="보통",
            ),
        )

    async def resolve_location(self, text: str) -> tuple[float, float, str] | None:
        return None


@pytest.mark.asyncio
async def test_health_assistant_loads_outdoor_tool_result_for_outdoor_question() -> None:
    llm_client = CapturingLLMClient()
    service = HealthAssistantService(
        llm_client=llm_client,
        outdoor_conditions_client=OutdoorConditionsStub(),
    )

    response = await service.respond(
        HealthAssistantChatRequest(
            messages=[ChatMessage(role="user", content="오늘 산책해도 돼?")],
            current_location=CurrentLocation(latitude=37.5665, longitude=126.978),
        )
    )

    assert response.outdoor_conditions is not None
    assert response.outdoor_conditions.weather is not None
    assert response.outdoor_conditions.weather.temperature_c == 23.4
    assert "기온 23.4℃" in llm_client.system_instruction
    assert "PM2.5 11㎍/㎥(보통)" in llm_client.system_instruction


def test_health_assistant_routes_aerobic_recommendation_to_outdoor_tool() -> None:
    request = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="오늘 유산소 할 건데 추천 좀")])

    assert HealthAssistantService._needs_outdoor_conditions(request) is True


def test_health_assistant_routes_exercise_plans_to_outdoor_tool() -> None:
    for text in ["오늘 러닝할거야", "오늘 달리기 할까?", "자전거 타러 갈까?", "오늘 산책갈래", "오늘 야외 운동 어때?"]:
        req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=text)])
        assert HealthAssistantService._needs_outdoor_conditions(req) is True, f"Failed for: {text}"


def test_health_assistant_does_not_route_completed_run_record_to_outdoor_tool() -> None:
    for text in [
        "오늘 러닝 30분 했어",
        "오늘 5km 달렸어",
        "오늘 10km 뛰었어",
        "오늘 1만보 걸었어",
        "자전거 1시간 탔어",
    ]:
        req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=text)])
        assert HealthAssistantService._needs_outdoor_conditions(req) is False, f"Failed for: {text}"


@pytest.mark.asyncio
async def test_health_assistant_evaluates_rain_as_outdoor_not_recommended() -> None:
    class RainyStub:
        async def get_outdoor_conditions(self, latitude: float, longitude: float) -> OutdoorConditionsResult:
            return OutdoorConditionsResult(
                latitude=latitude,
                longitude=longitude,
                weather=WeatherConditions(
                    temperature_c=18.0,
                    precipitation_type="비",
                ),
                air_quality=AirQualityConditions(
                    region_name="서울",
                    pm10_grade="좋음",
                    pm25_grade="좋음",
                ),
            )

        async def resolve_location(self, text: str) -> tuple[float, float, str] | None:
            return None

    llm_client = CapturingLLMClient()
    service = HealthAssistantService(llm_client=llm_client, outdoor_conditions_client=RainyStub())
    await service.respond(
        HealthAssistantChatRequest(
            messages=[ChatMessage(role="user", content="오늘 러닝할거야")],
            current_location=CurrentLocation(latitude=37.5665, longitude=126.978),
        )
    )
    assert "환경 종합 평가: 야외 활동 비권장" in llm_client.system_instruction
    assert "비/강수" in llm_client.system_instruction
    assert "실내 운동 추천 필요" in llm_client.system_instruction


@pytest.mark.asyncio
async def test_health_assistant_evaluates_bad_air_as_outdoor_not_recommended() -> None:
    class BadAirStub:
        async def get_outdoor_conditions(self, latitude: float, longitude: float) -> OutdoorConditionsResult:
            return OutdoorConditionsResult(
                latitude=latitude,
                longitude=longitude,
                weather=WeatherConditions(
                    temperature_c=22.0,
                    precipitation_type="강수 없음",
                ),
                air_quality=AirQualityConditions(
                    region_name="서울",
                    pm10_grade="나쁨",
                    pm25_grade="보통",
                ),
            )

        async def resolve_location(self, text: str) -> tuple[float, float, str] | None:
            return None

    llm_client = CapturingLLMClient()
    service = HealthAssistantService(llm_client=llm_client, outdoor_conditions_client=BadAirStub())
    await service.respond(
        HealthAssistantChatRequest(
            messages=[ChatMessage(role="user", content="오늘 산책 어때?")],
            current_location=CurrentLocation(latitude=37.5665, longitude=126.978),
        )
    )
    assert "환경 종합 평가: 야외 활동 비권장" in llm_client.system_instruction
    assert "미세먼지 나쁨" in llm_client.system_instruction
    assert "실내 운동 추천 필요" in llm_client.system_instruction


@pytest.mark.asyncio
async def test_health_assistant_evaluates_good_weather_as_outdoor_suitable() -> None:
    class NiceWeatherStub:
        async def get_outdoor_conditions(self, latitude: float, longitude: float) -> OutdoorConditionsResult:
            return OutdoorConditionsResult(
                latitude=latitude,
                longitude=longitude,
                weather=WeatherConditions(
                    temperature_c=21.0,
                    precipitation_type="강수 없음",
                ),
                air_quality=AirQualityConditions(
                    region_name="서울",
                    pm10_grade="좋음",
                    pm25_grade="좋음",
                ),
            )

        async def resolve_location(self, text: str) -> tuple[float, float, str] | None:
            return None

    llm_client = CapturingLLMClient()
    service = HealthAssistantService(llm_client=llm_client, outdoor_conditions_client=NiceWeatherStub())
    await service.respond(
        HealthAssistantChatRequest(
            messages=[ChatMessage(role="user", content="오늘 러닝할거야")],
            current_location=CurrentLocation(latitude=37.5665, longitude=126.978),
        )
    )
    assert (
        "환경 종합 평가: 야외 활동 적합 (쾌적한 환경 - 가벼운 산책이나 야외 러닝 적극 추천 가능)"
        in llm_client.system_instruction
    )


@pytest.mark.asyncio
async def test_health_assistant_evaluates_extreme_heat_as_outdoor_not_recommended() -> None:
    class HotWeatherStub:
        async def get_outdoor_conditions(self, latitude: float, longitude: float) -> OutdoorConditionsResult:
            return OutdoorConditionsResult(
                latitude=latitude,
                longitude=longitude,
                weather=WeatherConditions(
                    temperature_c=35.0,
                    humidity_percent=70,
                    precipitation_type="강수 없음",
                    wind_speed_mps=1.0,
                ),
                air_quality=AirQualityConditions(
                    region_name="서울",
                    pm10_grade="좋음",
                    pm25_grade="좋음",
                ),
            )

        async def resolve_location(self, text: str) -> tuple[float, float, str] | None:
            return None

    llm_client = CapturingLLMClient()
    service = HealthAssistantService(llm_client=llm_client, outdoor_conditions_client=HotWeatherStub())
    await service.respond(
        HealthAssistantChatRequest(
            messages=[ChatMessage(role="user", content="오늘 러닝할거야")],
            current_location=CurrentLocation(latitude=37.5665, longitude=126.978),
        )
    )

    assert "환경 종합 평가: 야외 활동 비권장" in llm_client.system_instruction
    assert "폭염 수준 고온" in llm_client.system_instruction


def test_health_assistant_needs_facility_tools_classification() -> None:
    # 1. Weather questions do not need facility tools
    req_weather = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="오늘 서울 날씨 어때")])
    assert HealthAssistantService._needs_facility_tools(req_weather) is False

    # 2. Diet/exercise advice does not need facility tools
    req_diet = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="임산부 추천 식단 알려줘")])
    assert HealthAssistantService._needs_facility_tools(req_diet) is False

    # 3. Merely stating location does not need facility tools
    req_loc = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="난 서울살아")])
    assert HealthAssistantService._needs_facility_tools(req_loc) is False

    # 4. Actual pharmacy search needs facility tools
    req_pharmacy = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="종로구 약국 찾아줘")])
    assert HealthAssistantService._needs_facility_tools(req_pharmacy) is True

    # 5. Hospital/clinic search needs facility tools
    req_hospital = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="서울 내과 어디 있어?")])
    assert HealthAssistantService._needs_facility_tools(req_hospital) is True

    # 6. Past treatment, medication advice, and record requests must not enable facility tools
    for text in [
        "내과에서 혈압약 처방받았어",
        "오늘 혈압약 처방받았는데 술 마셔도 돼?",
        "진료받고 왔어 기록해줘",
        "병원 갔다 왔어",
    ]:
        req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=text)])
        assert HealthAssistantService._needs_facility_tools(req) is False, f"Failed for: {text}"

    # 7. Terse location + facility searches remain supported
    for text in ["강남응급실", "서울 내과", "문산역 약국"]:
        req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=text)])
        assert HealthAssistantService._needs_facility_tools(req) is True, f"Failed for: {text}"


@pytest.mark.asyncio
async def test_health_assistant_resolves_sido_location_from_text() -> None:
    req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="오늘 서울 날씨 어때")])
    loc = await HealthAssistantService()._resolve_request_location(req)
    assert loc is not None
    assert loc.latitude == 37.5665
    assert loc.longitude == 126.978
    assert loc.address == "서울특별시"


@pytest.mark.asyncio
async def test_health_assistant_resolves_specific_place_for_outdoor_question() -> None:
    class LocationResolvingStub:
        async def get_outdoor_conditions(self, latitude: float, longitude: float) -> OutdoorConditionsResult:
            return OutdoorConditionsResult(latitude=latitude, longitude=longitude)

        async def resolve_location(self, text: str) -> tuple[float, float, str] | None:
            assert text == "오늘 양재숲에서 러닝할 거야"
            return 37.47, 127.035, "양재시민의숲"

    req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="오늘 양재숲에서 러닝할 거야")])
    service = HealthAssistantService(outdoor_conditions_client=LocationResolvingStub())

    loc = await service._resolve_request_location(req)

    assert loc is not None
    assert (loc.latitude, loc.longitude) == (37.47, 127.035)
    assert loc.address == "양재시민의숲"


@pytest.mark.asyncio
async def test_health_assistant_does_not_reuse_location_from_assistant_message() -> None:
    class NoLocationStub:
        async def get_outdoor_conditions(self, latitude: float, longitude: float) -> OutdoorConditionsResult:
            return OutdoorConditionsResult(latitude=latitude, longitude=longitude)

        async def resolve_location(self, text: str) -> tuple[float, float, str] | None:
            return None

    req = HealthAssistantChatRequest(
        messages=[
            ChatMessage(role="assistant", content="예를 들어 서울이라고 알려주세요."),
            ChatMessage(role="user", content="오늘 러닝할 거야"),
        ]
    )

    loc = await HealthAssistantService(outdoor_conditions_client=NoLocationStub())._resolve_request_location(req)

    assert loc is None


@pytest.mark.asyncio
async def test_health_assistant_service_extracts_exercise_draft() -> None:
    fake_json = """{
        "intent": "record_exercise",
        "assistant_message": "오늘 하신 랫풀다운 20kg 10회 3세트 운동을 기록했습니다.",
        "exercise_draft": {
            "exercise_name": "랫풀다운",
            "weight_kg": 20.0,
            "reps": 10,
            "sets": 3,
            "duration_minutes": null,
            "date_str": "2026-08-31",
            "note": null
        },
        "blood_pressure_draft": null,
        "blood_glucose_draft": null,
        "medication_draft": null,
        "pain_draft": null,
        "lab_result_draft": null,
        "query_draft": null,
        "missing_fields": [],
        "needs_confirmation": false,
        "auto_save": true,
        "suggested_quick_replies": [],
        "emergency_notice": null,
        "safety_disclaimer": "본 서비스는 의료 진단이나 처방을 대신하지 않습니다. 이상 징후가 있을 경우 의료진과 상담하세요."
    }"""
    mock_client = MockLLMClient(fake_json)
    service = HealthAssistantService(llm_client=mock_client)

    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="오늘 랫풀다운 20kg 10개 3세트 했어")],
        profile_context=ProfileContext(profile_name="홍길동", relationship="본인"),
    )
    response = await service.respond(request)

    assert response.intent == "record_exercise"
    assert response.exercise_draft is not None
    assert response.exercise_draft.exercise_name == "랫풀다운"
    assert response.exercise_draft.weight_kg == 20.0
    assert response.exercise_draft.reps == 10
    assert response.exercise_draft.sets == 3
    assert response.needs_confirmation is False
    assert response.auto_save is True


@pytest.mark.asyncio
async def test_health_assistant_service_extracts_blood_pressure_and_missing_fields() -> None:
    fake_json = """{
        "intent": "record_blood_pressure",
        "assistant_message": "수축기 혈압 130을 확인했습니다. 이완기 혈압(낮은 수치)도 함께 알려주시겠어요?",
        "exercise_draft": null,
        "blood_pressure_draft": {
            "systolic": 130,
            "diastolic": null,
            "pulse": null,
            "measured_at": null,
            "note": null
        },
        "blood_glucose_draft": null,
        "medication_draft": null,
        "pain_draft": null,
        "lab_result_draft": null,
        "query_draft": null,
        "missing_fields": ["diastolic"],
        "needs_confirmation": false,
        "suggested_quick_replies": ["80이야", "85", "기억 안 나"],
        "emergency_notice": null,
        "safety_disclaimer": "본 서비스는 의료 진단이나 처방을 대신하지 않습니다. 이상 징후가 있을 경우 의료진과 상담하세요."
    }"""
    mock_client = MockLLMClient(fake_json)
    service = HealthAssistantService(llm_client=mock_client)

    request = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="오늘 혈압 130 나왔어")])
    response = await service.respond(request)

    assert response.intent == "record_blood_pressure"
    assert response.blood_pressure_draft is not None
    assert response.blood_pressure_draft.systolic == 130
    assert "diastolic" in response.missing_fields
    assert response.needs_confirmation is False


@pytest.mark.asyncio
async def test_health_assistant_service_handles_emergency_notice() -> None:
    fake_json = """{
        "intent": "health_advice",
        "assistant_message": "가슴을 쥐어짜는 듯한 심한 통증은 심근경색 등 급성 심혈관 질환의 위험 신호일 수 있습니다. 지체하지 마시고 즉시 119에 연락하거나 가까운 응급실을 방문하세요.",
        "exercise_draft": null,
        "blood_pressure_draft": null,
        "blood_glucose_draft": null,
        "medication_draft": null,
        "pain_draft": null,
        "lab_result_draft": null,
        "query_draft": null,
        "missing_fields": [],
        "needs_confirmation": false,
        "suggested_quick_replies": [],
        "emergency_notice": "심한 흉통 및 호흡곤란은 즉각적인 응급 처치가 필요합니다. 지금 바로 119에 도움을 요청하세요.",
        "safety_disclaimer": null
    }"""
    mock_client = MockLLMClient(fake_json)
    service = HealthAssistantService(llm_client=mock_client)

    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="갑자기 가슴이 쥐어짜듯 너무 아프고 숨쉬기가 힘들어")]
    )
    response = await service.respond(request)

    assert response.intent == "health_advice"
    assert response.emergency_notice is not None
    assert "119" in response.emergency_notice
    # safety_service에 의해 disclaimer가 자동으로 채워졌는지 확인
    assert response.safety_disclaimer is not None
    assert "진단이나 처방을 대신하지 않습니다" in response.safety_disclaimer


@pytest.mark.asyncio
async def test_health_assistant_blocks_alcohol_advice_without_official_evidence() -> None:
    fake_json = """{
        "intent": "health_advice",
        "assistant_message": "최근 8월 31일에 타이레놀(아세트아미노펜) 복약 기록이 있습니다. 타이레놀 복용 중 알코올을 섭취하면 간 손상 위험이 급격히 증가하므로 음주를 피하시는 것이 안전합니다.",
        "exercise_draft": null,
        "blood_pressure_draft": null,
        "blood_glucose_draft": null,
        "medication_draft": null,
        "pain_draft": null,
        "lab_result_draft": null,
        "query_draft": null,
        "missing_fields": [],
        "needs_confirmation": false,
        "suggested_quick_replies": ["복약 기록 자세히 보기", "건강 메모 남기기"],
        "emergency_notice": null,
        "safety_disclaimer": "본 답변은 의학적 진단을 대신하지 않으며, 약물 복용 중 음주는 전문의 또는 약사와 상담하세요."
    }"""
    mock_client = MockLLMClient(fake_json)
    service = HealthAssistantService(llm_client=mock_client)

    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="나 오늘 술마셔도 됨?")],
        profile_context=ProfileContext(
            profile_name="다원", relationship="본인", recent_records_summary="[2026-08-31 복약] 타이레놀 1알"
        ),
    )
    response = await service.respond(request)

    assert response.intent == "health_advice"
    assert "타이레놀" not in response.assistant_message
    assert "근거 없이 건강정보를 안내하지 않겠습니다" in response.assistant_message
    assert response.needs_confirmation is False


@pytest.mark.asyncio
async def test_streaming_emits_message_deltas_then_the_whole_response() -> None:
    """글자는 흐르고 초안은 마지막에 한 번.

    두 벌인 이유가 있다. 기록 초안은 JSON 이 끝나야 유효해지고, 안전 검증도 완성본에만
    걸 수 있다 — 덜 온 문장으로 응급 판정을 하면 "가슴이 아" 에서 119 를 띄우거나
    반대로 놓친다.
    """
    fake_json = """{
        "intent": "record_blood_pressure",
        "assistant_message": "아침 혈압 130에 85로 기록할까요?",
        "blood_pressure_draft": {"systolic": 130, "diastolic": 85},
        "missing_fields": [],
        "needs_confirmation": true,
        "suggested_quick_replies": ["네", "아니요"]
    }"""
    service = HealthAssistantService(llm_client=MockLLMClient(fake_json))
    request = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="아침 혈압 130에 85")])

    events = [event async for event in service.stream(request)]
    deltas = [payload["text"] for name, payload in events if name == "delta"]
    results = [payload for name, payload in events if name == "result"]

    # 한 글자씩 흘렸으므로 조각이 여럿이어야 한다 — 한 덩어리면 스트리밍이 아니다.
    assert len(deltas) > 1
    assert "".join(deltas) == "아침 혈압 130에 85로 기록할까요?"
    # 초안은 마지막 한 번에만 실린다.
    assert len(results) == 1
    assert results[0]["blood_pressure_draft"]["systolic"] == 130
    assert results[0]["intent"] == "record_blood_pressure"


@pytest.mark.asyncio
async def test_streaming_answers_emergencies_without_calling_the_model() -> None:
    """응급 표현은 모델을 부르기 전에 잡는다. 그때도 화면 계약은 같다."""

    class Exploding:
        async def generate_structured_response(self, *args, **kwargs):
            raise AssertionError("모델을 부르면 안 된다")

        async def stream_structured_response(self, *args, **kwargs):
            raise AssertionError("모델을 부르면 안 된다")
            yield ""  # pragma: no cover - 제너레이터로 만들기 위한 줄

    service = HealthAssistantService(llm_client=Exploding())
    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="심한 흉통이 있고 호흡곤란도 와요")]
    )
    events = [event async for event in service.stream(request)]
    names = [name for name, _ in events]
    assert names == ["delta", "result"]
    assert "119" in events[0][1]["text"]


@pytest.mark.asyncio
async def test_health_assistant_service_calls_format_pain_diary_tool() -> None:
    fake_json = """{
        "intent": "record_pain",
        "assistant_message": "작성해 주신 통증 내용을 맞춤법과 구조에 맞게 다듬어 통증 다이어리 초안을 작성했습니다.",
        "exercise_draft": null,
        "blood_pressure_draft": null,
        "blood_glucose_draft": null,
        "medication_draft": null,
        "pain_draft": {
            "body_area": "팔꿈치, 왼쪽 고관절, 왼쪽 발바닥",
            "intensity": 5,
            "sensation": "이물감, 지지력 약화",
            "onset_at": "2026-09-06T12:00",
            "note": "웨이트 트레이닝 후 팔꿈치 통증 및 왼쪽 고관절 이물감"
        },
        "pain_diary_tool": {
            "tool_name": "format_pain_diary",
            "body_area": "팔꿈치, 왼쪽 고관절, 왼쪽 발바닥",
            "intensity": 5,
            "sensation": "이물감, 지지력 약화",
            "aggravating_factors": "웨이트 트레이닝 후, 보행 시",
            "formatted_diary": "웨이트 트레이닝 후 팔꿈치에 통증이 발생함. 왼쪽 고관절 부위에 이물감과 불편감이 지속되며, 보행 시 왼쪽 발바닥을 딛는 지지력이 다소 약화된 느낌을 받음. 관절 및 족부 부담을 줄이기 위한 충분한 안정과 스트레칭 필요.",
            "date_str": "2026-09-06"
        },
        "lab_result_draft": null,
        "query_draft": null,
        "challenge_draft": null,
        "missing_fields": [],
        "needs_confirmation": true,
        "auto_save": false,
        "suggested_quick_replies": ["통증 다이어리에 저장해줘", "다이어리 보러가기"],
        "emergency_notice": null,
        "safety_disclaimer": "본 서비스는 의료 진단이나 처방을 대신하지 않습니다. 이상 징후가 있을 경우 의료진과 상담하세요."
    }"""
    mock_client = MockLLMClient(fake_json)
    service = HealthAssistantService(llm_client=mock_client)

    request = HealthAssistantChatRequest(
        messages=[
            ChatMessage(
                role="user",
                content="통증일기. 웨이트한후에 팔꿈치가 아프다. 왼쪽 고관절에 이물감이 있고 왼쪽발 바닥을 딛는 힘이 약한 것 같아.",
            )
        ]
    )
    response = await service.respond(request)

    assert response.intent == "record_pain"
    assert response.pain_diary_tool is not None
    assert response.pain_diary_tool.tool_name == "format_pain_diary"
    assert "팔꿈치" in response.pain_diary_tool.body_area
    assert "웨이트 트레이닝 후" in response.pain_diary_tool.formatted_diary
    assert response.pain_draft is not None


@pytest.mark.asyncio
async def test_needs_medication_info_flexible_routing() -> None:
    """다양한 구어체/띄어쓰기 없는 복약 질문도 툴 라우팅이 정상 작동한다."""
    cases = [
        "타이레놀이랑 피임약 같이먹어도돼?",
        "탁센이랑 소화제 함께복용해도되나요",
        "판콜 먹어도돼?",
        "혈압약이랑 비타민 같이먹어도되나",
        "타이레놀 부작용 알려줘",
        "타이레놀 먹었는데 또 먹어도돼?",
        "타이레놀 먹었는데 몇 알까지 가능해?",
    ]
    for text in cases:
        req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=text)])
        assert HealthAssistantService._needs_medication_info(req) is True, f"Failed for: {text}"

    # 단순 기록형 발화는 툴 호출 없이 False
    record_cases = [
        "타이레놀 1알 먹었어",
        "혈압약 먹음",
        "탁센 복용완료",
        "비타민 챙겨먹었어",
    ]
    for text in record_cases:
        req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=text)])
        assert HealthAssistantService._needs_medication_info(req) is False, f"Failed for: {text}"


@pytest.mark.asyncio
async def test_needs_food_nutrition_routing() -> None:
    """음식 영양성분 및 섭취 질문 시 식품영양성분 툴 라우팅이 정상 작동한다."""
    food_cases = [
        "라면 먹어도 될까?",
        "짜장면 칼로리 얼마야?",
        "김치찌개 나트륨 많아?",
        "바나나 당류 알려줘",
        "삼겹살 먹어도 돼?",
        "떡볶이 영양성분 알려줘",
        "치킨 칼로리 몇이야?",
    ]
    for text in food_cases:
        req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=text)])
        assert HealthAssistantService._needs_food_nutrition(req) is True, f"Failed for: {text}"

    # 단순 운동/복약 발화는 False
    non_food_cases = [
        "타이레놀 1알 먹었어",
        "타이레놀 먹어도 돼?",
        "오늘 30분 달렸어",
        "혈압 120에 80 나왔어",
    ]
    for text in non_food_cases:
        req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=text)])
        assert HealthAssistantService._needs_food_nutrition(req) is False, f"Failed for: {text}"


@pytest.mark.asyncio
async def test_medication_tool_stream_preserves_llm_answer() -> None:
    """의약품 도구 실행 후에도 조기 return 없이 LLM의 자연어 스트리밍 답변이 유지된다."""
    from unittest.mock import AsyncMock

    from app.dtos.medication import DrugInfo, MedicationSearchResult

    fake_json = """{
        "intent": "health_advice",
        "assistant_message": "식약처 조회 결과에 따라 다른 약과 복용하기 전 전문가와 상의해 주세요.",
        "exercise_draft": null,
        "blood_pressure_draft": null,
        "blood_glucose_draft": null,
        "medication_draft": null,
        "pain_draft": null,
        "lab_result_draft": null,
        "query_draft": null,
        "challenge_draft": null,
        "missing_fields": [],
        "needs_confirmation": false,
        "auto_save": false,
        "suggested_quick_replies": [],
        "emergency_notice": null,
        "safety_disclaimer": "본 서비스는 의료 진단을 대신하지 않습니다."
    }"""

    mock_med_result = MedicationSearchResult(
        query="타이레놀",
        message="[식약처 정보] 아세트아미노펜",
        items=[DrugInfo(item_name="타이레놀정500밀리그람", intrc_qesitm="다른 약과 복용 전 전문가와 상의")],
    )

    async def fake_chunks():
        yield fake_json

    mock_llm = AsyncMock()
    mock_llm.generate_structured_response = AsyncMock(
        return_value=HealthAssistantScopeDecision(
            scope="health",
            requires_authoritative_evidence=True,
            required_evidence_types=["medication"],
        )
    )
    mock_llm.stream_structured_response_with_tools = AsyncMock(return_value=(fake_chunks(), mock_med_result))

    service = HealthAssistantService(llm_client=mock_llm)
    req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="타이레놀이랑 피임약 같이먹어도돼?")])

    events: list[tuple[str, Any]] = []
    async for event_type, data in service.stream(req):
        events.append((event_type, data))

    event_types = [e[0] for e in events]
    assert "medication" in event_types
    assert "delta" in event_types
    assert "result" in event_types

    # final result 객체에 medication_search_result가 포함되어 있고 assistant_message는 LLM 답변임
    result_event = next(e[1] for e in events if e[0] == "result")
    assert "식약처 조회 결과" in result_event["assistant_message"]
    assert result_event["medication_search_result"] is not None


@pytest.mark.asyncio
async def test_health_assistant_service_enriches_anatomy_context_and_draft() -> None:
    from datetime import datetime
    from unittest.mock import AsyncMock

    from app.models.households import HouseholdStatus

    profile_id = uuid.uuid4()
    household_id = uuid.uuid4()
    account_id = uuid.uuid4()

    mock_profile = AsyncMock(id=profile_id, household_id=household_id, status="active")
    mock_household = AsyncMock(id=household_id, status=HouseholdStatus.ACTIVE)
    mock_profile_repo = AsyncMock()
    mock_profile_repo.get = AsyncMock(return_value=mock_profile)
    mock_household_repo = AsyncMock()
    mock_household_repo.get = AsyncMock(return_value=mock_household)
    mock_household_repo.has_active_membership = AsyncMock(return_value=True)

    class DummyRecord:
        def __init__(self) -> None:
            self.recorded_at = datetime(2026, 9, 8, 10, 0)
            self.record_type = "pain"
            self.payload = {
                "sensation": "스쿼트 후 묵직함",
                "anatomyEvent": {
                    "version": "1.0.0",
                    "concept": {"id": "muscle_rectus_femoris_r", "label": "우측 대퇴직근"},
                    "body": {"side": "right", "region": "thigh"},
                    "layer": {"depth": "superficial", "systems": ["muscular"]},
                    "coverage": {"radius": 15.0, "centroid": [0.1, 0.2, 0.3]},
                    "source": "click",
                },
            }

    mock_repo = AsyncMock()
    mock_repo.list_by_profile.return_value = [DummyRecord()]

    fake_json = """{
        "intent": "record_pain",
        "assistant_message": "우측 대퇴직근 부위의 통증과 불편감을 기록했습니다.",
        "exercise_draft": null,
        "blood_pressure_draft": null,
        "blood_glucose_draft": null,
        "medication_draft": null,
        "pain_draft": {
            "body_area": "오른쪽 허벅지 앞쪽",
            "intensity": 6,
            "sensation": "묵직함",
            "onset_at": "2026-09-08T10:00",
            "note": "우측 대퇴직근 스쿼트 후 통증",
            "anatomy_concept_id": "muscle_rectus_femoris_r",
            "anatomy_label": "우측 대퇴직근"
        },
        "pain_diary_tool": {
            "tool_name": "format_pain_diary",
            "body_area": "오른쪽 허벅지 앞쪽",
            "intensity": 6,
            "sensation": "묵직함",
            "aggravating_factors": "스쿼트 후",
            "formatted_diary": "스쿼트 운동 후 우측 대퇴직근 부위에 묵직한 통증이 발생함.",
            "date_str": "2026-09-08",
            "anatomy_concept_id": "muscle_rectus_femoris_r",
            "anatomy_label": "우측 대퇴직근"
        },
        "lab_result_draft": null,
        "query_draft": null,
        "challenge_draft": null,
        "missing_fields": [],
        "needs_confirmation": true,
        "auto_save": false,
        "suggested_quick_replies": ["통증 다이어리에 저장해줘"],
        "emergency_notice": null,
        "safety_disclaimer": "본 서비스는 의료 진단이나 처방을 대신하지 않습니다."
    }"""

    mock_client = MockLLMClient(fake_json)
    service = HealthAssistantService(
        llm_client=mock_client,
        record_repo=mock_repo,
        profile_repo=mock_profile_repo,
        household_repo=mock_household_repo,
    )

    context = ProfileContext(profile_id=profile_id, profile_name="테스터")
    enriched = await service._enrich_context(context, account_id=account_id)

    assert enriched is not None
    assert enriched.recent_records_summary is not None
    assert "3D해부학: 우측 대퇴직근(오른쪽 thigh)" in enriched.recent_records_summary
    assert "확산범위 15.0mm" in enriched.recent_records_summary

    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="오른쪽 허벅지가 묵직하게 아파")],
        profile_context=context,
    )
    response = await service.respond(request, account=AsyncMock(id=account_id))

    assert response.intent == "record_pain"
    assert response.pain_draft is not None
    assert response.pain_draft.anatomy_concept_id == "muscle_rectus_femoris_r"
    assert response.pain_draft.anatomy_label == "우측 대퇴직근"
    assert response.pain_diary_tool is not None
    assert response.pain_diary_tool.anatomy_concept_id == "muscle_rectus_femoris_r"


async def test_enrich_records_summary_denies_without_account_id() -> None:
    """account_id가 없으면(비인증 등) 건강기록을 절대 조회·보강하지 않는다."""
    from unittest.mock import AsyncMock

    mock_record_repo = AsyncMock()
    service = HealthAssistantService(record_repo=mock_record_repo)
    ctx = ProfileContext(profile_name="홍길동", profile_id=str(uuid.uuid4()))

    await service._enrich_records_summary(ctx, account_id=None)

    assert ctx.recent_records_summary is None
    mock_record_repo.list_by_profile.assert_not_called()


async def test_enrich_records_summary_denies_unauthorized_account() -> None:
    """해당 프로필 가구의 활성 구성원이 아닌 계정은 건강기록을 조회할 수 없다."""
    from unittest.mock import AsyncMock

    from app.models.households import HouseholdStatus

    profile_id = uuid.uuid4()
    household_id = uuid.uuid4()
    account_id = uuid.uuid4()

    mock_profile = AsyncMock(id=profile_id, household_id=household_id, status="active")
    mock_household = AsyncMock(id=household_id, status=HouseholdStatus.ACTIVE)

    mock_profile_repo = AsyncMock()
    mock_profile_repo.get = AsyncMock(return_value=mock_profile)

    mock_household_repo = AsyncMock()
    mock_household_repo.get = AsyncMock(return_value=mock_household)
    # 가구 구성원 아님
    mock_household_repo.has_active_membership = AsyncMock(return_value=False)

    mock_record_repo = AsyncMock()

    service = HealthAssistantService(
        record_repo=mock_record_repo,
        profile_repo=mock_profile_repo,
        household_repo=mock_household_repo,
    )
    ctx = ProfileContext(profile_name="홍길동", profile_id=str(profile_id))

    await service._enrich_records_summary(ctx, account_id=account_id)

    assert ctx.recent_records_summary is None
    mock_record_repo.list_by_profile.assert_not_called()


async def test_enrich_records_summary_denies_inactive_profile_or_household() -> None:
    """프로필이 비활성이거나 가구가 비활성이면 건강기록 조회가 차단된다."""
    from unittest.mock import AsyncMock

    from app.models.households import HouseholdStatus

    profile_id = uuid.uuid4()
    household_id = uuid.uuid4()
    account_id = uuid.uuid4()

    # 1) 비활성 프로필
    mock_profile_inactive = AsyncMock(id=profile_id, household_id=household_id, status="inactive")
    mock_profile_repo = AsyncMock()
    mock_profile_repo.get = AsyncMock(return_value=mock_profile_inactive)
    mock_household_repo = AsyncMock()
    mock_record_repo = AsyncMock()

    service = HealthAssistantService(
        record_repo=mock_record_repo,
        profile_repo=mock_profile_repo,
        household_repo=mock_household_repo,
    )
    ctx = ProfileContext(profile_name="홍길동", profile_id=str(profile_id))
    await service._enrich_records_summary(ctx, account_id=account_id)
    assert ctx.recent_records_summary is None
    mock_record_repo.list_by_profile.assert_not_called()

    # 2) 비활성 가구
    mock_profile_active = AsyncMock(id=profile_id, household_id=household_id, status="active")
    mock_profile_repo.get = AsyncMock(return_value=mock_profile_active)
    mock_household_inactive = AsyncMock(id=household_id, status=HouseholdStatus.CLOSED)
    mock_household_repo.get = AsyncMock(return_value=mock_household_inactive)

    await service._enrich_records_summary(ctx, account_id=account_id)
    assert ctx.recent_records_summary is None
    mock_record_repo.list_by_profile.assert_not_called()


async def test_enrich_records_summary_allows_authorized_member() -> None:
    """정상 가구 구성원인 계정은 건강기록을 안전하게 보강받는다."""
    from datetime import datetime, timezone
    from unittest.mock import AsyncMock

    from app.models.households import HouseholdStatus

    profile_id = uuid.uuid4()
    household_id = uuid.uuid4()
    account_id = uuid.uuid4()

    mock_profile = AsyncMock(id=profile_id, household_id=household_id, status="active")
    mock_household = AsyncMock(id=household_id, status=HouseholdStatus.ACTIVE)

    mock_profile_repo = AsyncMock()
    mock_profile_repo.get = AsyncMock(return_value=mock_profile)

    mock_household_repo = AsyncMock()
    mock_household_repo.get = AsyncMock(return_value=mock_household)
    mock_household_repo.has_active_membership = AsyncMock(return_value=True)

    mock_record1 = AsyncMock(
        recorded_at=datetime(2026, 9, 7, 10, 0, tzinfo=timezone.utc),
        record_type="blood_pressure",
        payload={"systolic": 120, "diastolic": 80},
    )
    mock_record_repo = AsyncMock()
    mock_record_repo.list_by_profile = AsyncMock(return_value=[mock_record1])

    service = HealthAssistantService(
        record_repo=mock_record_repo,
        profile_repo=mock_profile_repo,
        household_repo=mock_household_repo,
    )
    ctx = ProfileContext(profile_name="홍길동", profile_id=str(profile_id))

    await service._enrich_records_summary(ctx, account_id=account_id)

    assert ctx.recent_records_summary is not None
    assert "blood_pressure" in ctx.recent_records_summary
    assert "120" in ctx.recent_records_summary
    mock_record_repo.list_by_profile.assert_called_once_with(profile_id, limit=5)


async def test_enrich_context_skips_records_on_greeting() -> None:
    """일반 인사(안녕, 안녕하세요 등)에는 건강기록을 조회하거나 주입하지 않는다."""
    from unittest.mock import AsyncMock

    from app.dtos.health_assistant import ChatMessage, HealthAssistantChatRequest

    mock_record_repo = AsyncMock()
    service = HealthAssistantService(record_repo=mock_record_repo)
    ctx = ProfileContext(profile_name="홍길동", profile_id=str(uuid.uuid4()))

    greeting_req = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="안녕하세요 봄이님!")],
        profile_context=ctx,
    )

    enriched = await service._enrich_context(ctx, account_id=uuid.uuid4(), request=greeting_req)

    assert enriched is not None
    assert enriched.recent_records_summary is None
    mock_record_repo.list_by_profile.assert_not_called()


async def test_enrich_context_enriches_records_on_health_symptom() -> None:
    """통증이나 건강 증상 언급 시에는 인가된 계정에 한해 건강기록을 보강한다."""
    from datetime import datetime, timezone
    from unittest.mock import AsyncMock

    from app.dtos.health_assistant import ChatMessage, HealthAssistantChatRequest
    from app.models.households import HouseholdStatus

    profile_id = uuid.uuid4()
    household_id = uuid.uuid4()
    account_id = uuid.uuid4()

    mock_profile = AsyncMock(id=profile_id, household_id=household_id, status="active")
    mock_household = AsyncMock(id=household_id, status=HouseholdStatus.ACTIVE)

    mock_profile_repo = AsyncMock()
    mock_profile_repo.get = AsyncMock(return_value=mock_profile)
    mock_household_repo = AsyncMock()
    mock_household_repo.get = AsyncMock(return_value=mock_household)
    mock_household_repo.has_active_membership = AsyncMock(return_value=True)

    mock_record = AsyncMock(
        recorded_at=datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc),
        record_type="pain",
        payload={"note": "오른쪽 무릎 뻐근함"},
    )
    mock_record_repo = AsyncMock()
    mock_record_repo.list_by_profile = AsyncMock(return_value=[mock_record])

    service = HealthAssistantService(
        record_repo=mock_record_repo,
        profile_repo=mock_profile_repo,
        household_repo=mock_household_repo,
    )
    ctx = ProfileContext(profile_name="홍길동", profile_id=str(profile_id))

    health_req = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="오늘 무릎 통증이 좀 심해졌어")],
        profile_context=ctx,
    )

    enriched = await service._enrich_context(ctx, account_id=account_id, request=health_req)

    assert enriched is not None
    assert enriched.recent_records_summary is not None
    assert "무릎 뻐근함" in enriched.recent_records_summary
    mock_record_repo.list_by_profile.assert_called_once_with(profile_id, limit=5)


@pytest.mark.asyncio
async def test_standalone_medicine_word_does_not_match_unrelated_korean() -> None:
    """`약` 한 글자를 부분 문자열로 찾으면 약간·약속·요약·계약이 전부 의약품 질문이 된다.

    질문 의도 키워드(`어떻게`·`언제`·`괜찮`)나 물음표와 겹치면 그대로 도구가 붙어,
    의약품과 무관한 대화마다 식약처 조회 도구가 LLM 에 노출됐다.
    """
    unrelated = [
        "약간 어지러운데 괜찮을까요?",
        "오늘 운동 약속 언제였지?",
        "검진 결과 요약해서 알려줘",
        "계약서 어떻게 쓰지?",
        "다리에 힘이 약해요, 괜찮을까요?",
        "만약 혈압이 높으면 어떻게 해요?",
        "병원 예약 언제 되나요?",
        "절약하려면 어떻게 해야 돼?",
    ]
    for text in unrelated:
        req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=text)])
        assert HealthAssistantService._needs_medication_info(req) is False, f"오탐: {text}"

    # 홀로 쓰인 `약` 과 조사가 붙은 형태는 그대로 잡아야 한다.
    medicine = [
        "이 약 효능이 뭐야?",
        "약을 언제 먹어도 되나요?",
        "이 약은 부작용이 뭔가요?",
        "감기약 먹어도 돼?",
        "혈압약 복용법이 어떻게 되나요?",
    ]
    for text in medicine:
        req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=text)])
        assert HealthAssistantService._needs_medication_info(req) is True, f"미탐: {text}"
