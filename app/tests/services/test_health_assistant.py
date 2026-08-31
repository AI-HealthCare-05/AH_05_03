import pytest

from app.core import config
from app.dtos.health_assistant import (
    ChatMessage,
    ChatRole,
    HealthAssistantChatRequest,
    HealthAssistantProfileContext,
    HealthIntent,
)
from app.exceptions import AppError
from app.services.health_assistant import HealthAssistantService


@pytest.mark.asyncio
async def test_health_assistant_service_raises_when_no_api_key(monkeypatch) -> None:
    monkeypatch.setattr(config, "GEMINI_API_KEY", None)
    service = HealthAssistantService()
    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role=ChatRole.USER, content="오늘 랫풀다운 20kg 10개 3세트 했어")]
    )
    with pytest.raises(AppError, match="Gemini API 키가 설정되지 않았습니다"):
        await service.respond(request)


@pytest.mark.asyncio
async def test_health_assistant_service_extracts_exercise_draft(monkeypatch) -> None:
    fake_json = """{
        "intent": "record_exercise",
        "assistant_message": "오늘 하신 랫풀다운 20kg 10회 3세트 운동을 기록할까요?",
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
        "query_draft": null,
        "missing_fields": [],
        "needs_confirmation": true,
        "suggested_quick_replies": ["오늘 운동 기록에 저장", "수정하기"],
        "emergency_notice": null,
        "safety_disclaimer": null
    }"""

    class FakeResponse:
        text = fake_json

    class FakeModels:
        def generate_content(self, *args, **kwargs):
            return FakeResponse()

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.models = FakeModels()

    import google.genai as genai
    monkeypatch.setattr(genai, "Client", FakeClient)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_gemini_key")

    service = HealthAssistantService()
    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role=ChatRole.USER, content="오늘 랫풀다운 20kg 10개 3세트 했어")],
        profile_context=HealthAssistantProfileContext(profile_name="홍길동", relationship="본인")
    )
    response = await service.respond(request)

    assert response.intent == HealthIntent.RECORD_EXERCISE
    assert response.exercise_draft is not None
    assert response.exercise_draft.exercise_name == "랫풀다운"
    assert response.exercise_draft.weight_kg == 20.0
    assert response.exercise_draft.reps == 10
    assert response.exercise_draft.sets == 3
    assert response.needs_confirmation is True


@pytest.mark.asyncio
async def test_health_assistant_service_extracts_blood_pressure_and_missing_fields(monkeypatch) -> None:
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
        "query_draft": null,
        "missing_fields": ["diastolic"],
        "needs_confirmation": false,
        "suggested_quick_replies": ["80이야", "85", "기억 안 나"],
        "emergency_notice": null,
        "safety_disclaimer": null
    }"""

    class FakeResponse:
        text = fake_json

    class FakeModels:
        def generate_content(self, *args, **kwargs):
            return FakeResponse()

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.models = FakeModels()

    import google.genai as genai
    monkeypatch.setattr(genai, "Client", FakeClient)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_gemini_key")

    service = HealthAssistantService()
    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role=ChatRole.USER, content="오늘 혈압 130 나왔어")]
    )
    response = await service.respond(request)

    assert response.intent == HealthIntent.RECORD_BLOOD_PRESSURE
    assert response.blood_pressure_draft is not None
    assert response.blood_pressure_draft.systolic == 130
    assert "diastolic" in response.missing_fields
    assert response.needs_confirmation is False


@pytest.mark.asyncio
async def test_health_assistant_service_handles_emergency_notice(monkeypatch) -> None:
    fake_json = """{
        "intent": "health_advice",
        "assistant_message": "가슴을 쥐어짜는 듯한 심한 통증은 심근경색 등 급성 심혈관 질환의 위험 신호일 수 있습니다. 지체하지 마시고 즉시 119에 연락하거나 가까운 응급실을 방문하세요.",
        "exercise_draft": null,
        "blood_pressure_draft": null,
        "blood_glucose_draft": null,
        "medication_draft": null,
        "pain_draft": null,
        "query_draft": null,
        "missing_fields": [],
        "needs_confirmation": false,
        "suggested_quick_replies": [],
        "emergency_notice": "심한 흉통 및 호흡곤란은 즉각적인 응급 처치가 필요합니다. 지금 바로 119에 도움을 요청하세요.",
        "safety_disclaimer": "본 답변은 의료 진단이 아니며, 응급 처치를 대체할 수 없습니다."
    }"""

    class FakeResponse:
        text = fake_json

    class FakeModels:
        def generate_content(self, *args, **kwargs):
            return FakeResponse()

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.models = FakeModels()

    import google.genai as genai
    monkeypatch.setattr(genai, "Client", FakeClient)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_gemini_key")

    service = HealthAssistantService()
    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role=ChatRole.USER, content="갑자기 가슴이 쥐어짜듯 너무 아프고 숨쉬기가 힘들어")]
    )
    response = await service.respond(request)

    assert response.intent == HealthIntent.HEALTH_ADVICE
    assert response.emergency_notice is not None
    assert "119" in response.emergency_notice

