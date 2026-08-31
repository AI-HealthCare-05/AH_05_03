import pytest

from app.core import config
from app.dtos.health_assistant import (
    ChatMessage,
    HealthAssistantChatRequest,
    ProfileContext,
)
from app.exceptions import AppError
from app.services.health_assistant import HealthAssistantService


@pytest.mark.asyncio
async def test_health_assistant_service_raises_when_no_api_key(monkeypatch) -> None:
    monkeypatch.setattr(config, "GEMINI_API_KEY", None)
    service = HealthAssistantService()
    request = HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content="오늘 랫풀다운 20kg 10개 3세트 했어")]
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
        messages=[ChatMessage(role="user", content="오늘 랫풀다운 20kg 10개 3세트 했어")],
        profile_context=ProfileContext(profile_name="홍길동", relationship="본인")
    )
    response = await service.respond(request)

    assert response.intent == "record_exercise"
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
        messages=[ChatMessage(role="user", content="오늘 혈압 130 나왔어")]
    )
    response = await service.respond(request)

    assert response.intent == "record_blood_pressure"
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
        messages=[ChatMessage(role="user", content="갑자기 가슴이 쥐어짜듯 너무 아프고 숨쉬기가 힘들어")]
    )
    response = await service.respond(request)

    assert response.intent == "health_advice"
    assert response.emergency_notice is not None
    assert "119" in response.emergency_notice


@pytest.mark.asyncio
async def test_health_assistant_service_advises_on_alcohol_with_medication_context(monkeypatch) -> None:
    fake_json = """{
        "intent": "health_advice",
        "assistant_message": "최근 8월 31일에 타이레놀(아세트아미노펜) 복약 기록이 있습니다. 타이레놀 복용 중 알코올을 섭취하면 간 손상 위험이 급격히 증가하므로 음주를 피하시는 것이 안전합니다.",
        "exercise_draft": null,
        "blood_pressure_draft": null,
        "blood_glucose_draft": null,
        "medication_draft": null,
        "pain_draft": null,
        "query_draft": null,
        "missing_fields": [],
        "needs_confirmation": false,
        "suggested_quick_replies": ["복약 기록 자세히 보기", "건강 메모 남기기"],
        "emergency_notice": null,
        "safety_disclaimer": "본 답변은 의학적 진단을 대신하지 않으며, 약물 복용 중 음주는 전문의 또는 약사와 상담하세요."
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
        messages=[ChatMessage(role="user", content="나 오늘 술마셔도 됨?")],
        profile_context=ProfileContext(
            profile_name="다원",
            relationship="본인",
            recent_records_summary="[2026-08-31 복약] 타이레놀 1알"
        )
    )
    response = await service.respond(request)

    assert response.intent == "health_advice"
    assert "타이레놀" in response.assistant_message
    assert "간 손상" in response.assistant_message or "간" in response.assistant_message
    assert response.needs_confirmation is False
