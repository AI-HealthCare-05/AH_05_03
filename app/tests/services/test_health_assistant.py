import pytest

from app.dtos.health_assistant import (
    ChatMessage,
    HealthAssistantChatRequest,
    HealthAssistantResponse,
    ProfileContext,
)
from app.services.health_assistant import HealthAssistantService


class MockLLMClient:
    """`LLMClientProtocol` 의 두 메서드를 다 흉내 낸다.

    스트리밍은 **한 글자씩** 흘린다 — 실제 모델도 토큰 단위로 오고, 덩어리로 주면
    부분 JSON 해독기가 경계를 밟을 일이 없어 시험이 되지 않는다.
    """

    def __init__(self, fake_json: str):
        self.fake_json = fake_json

    async def generate_structured_response(self, *args, **kwargs):
        return HealthAssistantResponse.model_validate_json(self.fake_json)

    async def stream_structured_response(self, *args, **kwargs):
        for character in self.fake_json:
            yield character


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
async def test_health_assistant_service_advises_on_alcohol_with_medication_context() -> None:
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
    assert "타이레놀" in response.assistant_message
    assert "간 손상" in response.assistant_message or "간" in response.assistant_message
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
async def test_health_assistant_service_enriches_anatomy_context_and_draft() -> None:
    from datetime import datetime
    from unittest.mock import AsyncMock

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

    import uuid

    mock_client = MockLLMClient(fake_json)
    service = HealthAssistantService(llm_client=mock_client, record_repo=mock_repo)

    context = ProfileContext(profile_id=uuid.uuid4(), profile_name="테스터")
    enriched = await service._enrich_context(context)

    assert enriched is not None
    assert enriched.recent_records_summary is not None
    assert "3D해부학: 우측 대퇴직근(오른쪽 thigh)" in enriched.recent_records_summary
    assert "확산범위 15.0mm" in enriched.recent_records_summary

    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="오른쪽 허벅지가 묵직하게 아파")],
        profile_context=context,
    )
    response = await service.respond(request)

    assert response.intent == "record_pain"
    assert response.pain_draft is not None
    assert response.pain_draft.anatomy_concept_id == "muscle_rectus_femoris_r"
    assert response.pain_draft.anatomy_label == "우측 대퇴직근"
    assert response.pain_diary_tool is not None
    assert response.pain_diary_tool.anatomy_concept_id == "muscle_rectus_femoris_r"
