from app.dtos.health_assistant import ChatMessage, HealthAssistantResponse
from app.services.health_assistant_safety import HealthAssistantSafetyService


def test_safety_service_adds_disclaimer_when_emergency_present() -> None:
    response = HealthAssistantResponse(
        intent="health_advice",
        assistant_message="위험합니다",
        emergency_notice="119에 연락하세요.",
        safety_disclaimer=None,
        missing_fields=[],
        suggested_quick_replies=[],
    )

    validated = HealthAssistantSafetyService.validate_response(response)

    assert validated.safety_disclaimer is not None
    assert "진단이나 처방을 대신하지 않습니다" in validated.safety_disclaimer


def test_safety_service_does_not_overwrite_existing_disclaimer() -> None:
    response = HealthAssistantResponse(
        intent="health_advice",
        assistant_message="위험합니다",
        emergency_notice="119에 연락하세요.",
        safety_disclaimer="커스텀 고지문",
        missing_fields=[],
        suggested_quick_replies=[],
    )

    validated = HealthAssistantSafetyService.validate_response(response)

    assert validated.safety_disclaimer == "커스텀 고지문"


def test_safety_service_does_nothing_if_no_emergency() -> None:
    response = HealthAssistantResponse(
        intent="general_chat",
        assistant_message="안녕하세요",
        emergency_notice=None,
        safety_disclaimer=None,
        missing_fields=[],
        suggested_quick_replies=[],
    )

    validated = HealthAssistantSafetyService.validate_response(response)

    assert validated.safety_disclaimer is None


def test_safety_service_check_input_safety_detects_emergency() -> None:
    messages = [ChatMessage(role="user", content="가슴이 쥐어짜듯 아파요")]
    result = HealthAssistantSafetyService.check_input_safety(messages)

    assert result is not None
    assert result.intent == "health_advice"
    assert "119에 연락" in result.assistant_message
    assert result.emergency_notice is not None


def test_safety_service_check_input_safety_ignores_normal_input() -> None:
    messages = [ChatMessage(role="user", content="오늘 랫풀다운 20kg 10회 했어")]
    result = HealthAssistantSafetyService.check_input_safety(messages)

    assert result is None
