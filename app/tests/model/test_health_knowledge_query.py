"""국가건강정보포털 2차 질의 정규화.

실측(2026-09-16)으로 확인한 계약을 고정한다 — 포털은 문장이 아니라 주제어에
매칭되므로, 원문 검색이 0건일 때 `조건어 + 주제어` 로 줄여 한 번 더 본다.
"""

import pytest

from app.services.health_knowledge_query import mentions_activity, normalize_knowledge_query


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        # 실측: 원문 0건 -> 정규화 3건
        ("임신 중인데 달리기 해도 돼?", "임신 운동"),
        # 실측: 원문 0건 -> 정규화 1건
        ("무릎이 아픈데 산책해도 돼?", "무릎 운동"),
        # 실측: 원문 0건 -> 정규화 3건
        ("허리 아픈데 자전거 타도 돼?", "허리 운동"),
        ("당뇨인데 뭐 먹어도 돼?", "당뇨 식이"),
        # 포털 표제어로 맞춘다
        ("임산부인데 요가 해도 되나요", "임신 운동"),
        ("항암 치료 중에 등산해도 돼?", "암 운동"),
    ],
)
def test_normalizes_to_condition_and_topic(question: str, expected: str) -> None:
    assert normalize_knowledge_query(question) == expected


@pytest.mark.parametrize(
    "question",
    [
        "오늘 날씨 어때?",  # 조건어도 주제어도 없다
        "달리기 해도 돼?",  # 활동만 있고 조건이 없다 — "달리기" 단독은 포털에서 0건
        "무릎이 아파",  # 조건만 있고 주제가 없다
        "근처 약국 알려줘",
    ],
)
def test_returns_none_when_a_topical_query_cannot_be_built(question: str) -> None:
    """만들 수 없으면 None. 엉뚱한 질의로 관련 없는 문서를 끌어오는 것보다 안전하다."""
    assert normalize_knowledge_query(question) is None


def test_mentions_activity() -> None:
    assert mentions_activity("무릎이 아픈데 산책해도 돼?")
    assert mentions_activity("임신 중인데 달리기 해도 돼?")
    assert not mentions_activity("오늘 날씨 어때?")
    assert not mentions_activity("무릎이 아파")
