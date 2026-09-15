from app.dtos.health_assistant import (
    ChatMessage,
    HealthAssistantChatRequest,
    HealthAssistantResponse,
    PainDiaryToolCall,
    PainDraft,
)
from app.services.health_assistant import HealthAssistantService


def test_unstated_pain_intensity_is_removed_before_saving() -> None:
    request = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="머리가 깨질 것 같아")])
    response = HealthAssistantResponse(
        intent="record_pain",
        assistant_message="통증 기록을 확인해 주세요.",
        pain_draft=PainDraft(body_area="머리", intensity=5),
        pain_diary_tool=PainDiaryToolCall(
            body_area="머리",
            intensity=5,
            formatted_diary="머리가 깨질 듯한 통증이 있음.",
        ),
        auto_save=True,
    )

    sanitized = HealthAssistantService._clear_unstated_pain_intensity(response, request)

    assert sanitized.pain_draft is not None
    assert sanitized.pain_draft.intensity is None
    assert sanitized.pain_diary_tool is not None
    assert sanitized.pain_diary_tool.intensity is None
    assert sanitized.auto_save is False
    assert sanitized.needs_confirmation is True


def test_explicit_pain_intensity_is_preserved() -> None:
    request = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="무릎 통증 강도 6이야")])
    response = HealthAssistantResponse(
        intent="record_pain",
        assistant_message="통증 기록을 확인해 주세요.",
        pain_draft=PainDraft(body_area="무릎", intensity=6),
        auto_save=True,
    )

    sanitized = HealthAssistantService._clear_unstated_pain_intensity(response, request)

    assert sanitized.pain_draft is not None
    assert sanitized.pain_draft.intensity == 6
    assert sanitized.auto_save is True


def test_explicit_pain_intensity_is_preserved_across_turns() -> None:
    request = HealthAssistantChatRequest(
        messages=[
            ChatMessage(role="user", content="머리 통증 6점이야"),
            ChatMessage(role="assistant", content="언제부터 아팠나요?"),
            ChatMessage(role="user", content="어제부터요"),
        ]
    )
    response = HealthAssistantResponse(
        intent="record_pain",
        assistant_message="통증 기록을 확인해 주세요.",
        pain_draft=PainDraft(body_area="머리", intensity=6),
        auto_save=True,
    )

    sanitized = HealthAssistantService._clear_unstated_pain_intensity(response, request)

    assert sanitized.pain_draft is not None
    assert sanitized.pain_draft.intensity == 6
    assert sanitized.auto_save is True
