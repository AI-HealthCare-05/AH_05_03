from typing import Literal

import pytest

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


@pytest.mark.parametrize("user_text", ["통증을 2라고 했어", "무릎 통증 2", "강도는 2"])
def test_explicitly_stated_pain_intensity_is_preserved(user_text: str) -> None:
    request = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=user_text)])
    response = HealthAssistantResponse(
        intent="record_pain",
        assistant_message="통증 기록을 확인해 주세요.",
        pain_draft=PainDraft(body_area="무릎", intensity=2),
        auto_save=True,
    )

    sanitized = HealthAssistantService._clear_unstated_pain_intensity(response, request)

    assert sanitized.pain_draft is not None
    assert sanitized.pain_draft.intensity == 2
    assert sanitized.auto_save is True


@pytest.mark.parametrize("user_text", ["2일 전부터 아파", "통증은 2일 전에 시작했어"])
def test_date_number_is_not_preserved_as_pain_intensity(user_text: str) -> None:
    request = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content=user_text)])
    response = HealthAssistantResponse(
        intent="record_pain",
        assistant_message="통증 기록을 확인해 주세요.",
        pain_draft=PainDraft(body_area="무릎", intensity=2),
        auto_save=True,
    )

    sanitized = HealthAssistantService._clear_unstated_pain_intensity(response, request)

    assert sanitized.pain_draft is not None
    assert sanitized.pain_draft.intensity is None
    assert sanitized.auto_save is False


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


# --- 물어본 답을 버리지 않는다 (2026-09-16) -----------------------------------
#
# 봄이가 "0~10점 중 몇 점인가요?" 라고 물으면 사용자는 보통 `2` 처럼 숫자만 답한다.
# 그 답은 `강도 2` 와 달리 명시 패턴에 걸리지 않아 도로 지워졌고, 화면에는
# "강도 2를 저장했습니다" 가 뜨는데 슬라이더는 비어 있고 저장 버튼은 꺼져 있었다.
# 묻고서 받은 답을 버리면 대화가 제자리를 돈다.

_INTENSITY_QUESTION = "확인 하나만 할게요. 통증 기록을 위해 강도를 0~10점 중 몇 점인지 알려주시겠어요?"


def _record_pain_response() -> HealthAssistantResponse:
    return HealthAssistantResponse(
        intent="record_pain",
        assistant_message="머리 통증 강도 2를 오늘 통증 기록에 저장했습니다.",
        pain_draft=PainDraft(body_area="머리", intensity=2),
    )


def _kept_intensity(*turns: tuple[Literal["user", "assistant"], str]) -> int | None:
    request = HealthAssistantChatRequest(messages=[ChatMessage(role=role, content=content) for role, content in turns])
    result = HealthAssistantService._clear_unstated_pain_intensity(_record_pain_response(), request)
    assert result.pain_draft is not None
    return result.pain_draft.intensity


def test_bare_number_after_the_intensity_question_counts_as_stated() -> None:
    assert _kept_intensity(("user", "머리 아파"), ("assistant", _INTENSITY_QUESTION), ("user", "2")) == 2
    assert _kept_intensity(("user", "머리 아파"), ("assistant", _INTENSITY_QUESTION), ("user", "2요")) == 2


def test_bare_number_after_a_freely_worded_intensity_question_also_counts() -> None:
    """서버의 고정 문구만 인정하면, 모델이 제 말로 물었을 때 같은 문제가 반복된다."""
    assert _kept_intensity(("user", "머리 아파"), ("assistant", "강도가 몇 점 정도인가요?"), ("user", "2")) == 2


def test_bare_number_answering_a_different_question_is_still_removed() -> None:
    """강도를 물은 게 아니면 숫자만으로는 강도를 말한 것이 아니다."""
    assert _kept_intensity(("user", "머리 아파"), ("assistant", "어디가 아프신가요?"), ("user", "2")) is None
