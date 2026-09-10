from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.dtos.health_assistant import ChatMessage, HealthAssistantResponse
from app.dtos.health_knowledge import HealthKnowledgeItem, HealthKnowledgeSearchResult
from app.dtos.health_record_query import AlcoholConsultationSnapshot
from app.services.health_assistant_boundary import HealthAssistantBoundaryService
from app.services.health_knowledge_catalog import HealthKnowledgeCatalogClient, is_alcohol_topic


@pytest.mark.asyncio
async def test_catalog_returns_only_curated_kdca_alcohol_sources() -> None:
    client = HealthKnowledgeCatalogClient()

    alcohol = await client.search("나 오늘 술 마셔도 돼?")
    unrelated = await client.search("허리가 아파")

    assert len(alcohol.items) == 2
    assert all(item.url.startswith("https://health.kdca.go.kr/") for item in alcohol.items)
    assert unrelated.items == []


def test_alcohol_question_requires_personal_records_and_health_knowledge() -> None:
    decision = HealthAssistantBoundaryService._fast_path_decision(
        [ChatMessage(role="user", content="나 오늘 술 마셔도 돼?")]
    )

    assert decision is not None
    assert decision.required_evidence_types == ["health_knowledge", "health_records"]


def test_grounding_accepts_alcohol_answer_only_when_both_evidence_types_exist() -> None:
    boundary = HealthAssistantBoundaryService()
    decision = HealthAssistantBoundaryService._fast_path_decision([ChatMessage(role="user", content="술 마셔도 됨?")])
    assert decision is not None
    knowledge = HealthKnowledgeSearchResult(
        query="술",
        items=[
            HealthKnowledgeItem(
                title="음주",
                url="https://health.kdca.go.kr/example",
                summary="과도한 음주는 혈압을 높일 수 있습니다.",
                topics=["alcohol"],
            )
        ],
        retrieved_at=datetime.now(ZoneInfo("Asia/Seoul")),
        message="",
    )
    snapshot = AlcoholConsultationSnapshot(message="기록 없음", missing_sections=["blood_pressure", "liver_tests"])
    response = HealthAssistantResponse(intent="health_advice", assistant_message="오늘은 피하는 편이 안전합니다.")

    allowed = boundary.enforce_grounding(
        decision,
        response,
        tool_result=[snapshot, knowledge],
        outdoor_conditions=None,
    )
    blocked = boundary.enforce_grounding(
        decision,
        response,
        tool_result=[snapshot],
        outdoor_conditions=None,
    )

    assert allowed.assistant_message == response.assistant_message
    assert "답변 근거를 확인하지 못했습니다" in blocked.assistant_message


@pytest.mark.asyncio
async def test_catalog_returns_curated_hypertension_sources() -> None:
    """음주 말고 다른 주제도 health_knowledge 근거를 채울 수 있어야 한다.

    이 카탈로그가 음주 하나만 갖고 있으면, 서비스 범위 판정기 자신의 프롬프트 예시인
    '고혈압에 좋은 운동 알려줘'조차 근거를 못 채워서 항상 차단된다. 고혈압 버킷을
    추가해서 이 예시가 실제로 그라운딩되는지 확인한다."""
    client = HealthKnowledgeCatalogClient()

    hypertension = await client.search("고혈압에 좋은 운동 알려줘")
    diabetes = await client.search("당뇨병 관리 어떻게 해?")

    assert len(hypertension.items) == 3
    assert all(item.url.startswith("https://health.kdca.go.kr/") for item in hypertension.items)
    # 아직 큐레이션 안 된 주제는 지어내지 말고 정직하게 빈 목록을 돌려줘야 한다.
    assert diabetes.items == []


def test_is_alcohol_topic_catches_statement_form_that_fast_path_intent_check_misses() -> None:
    """`is_alcohol_topic`은 주제 단어만 본다 — 의도(질문/평서문)는 상관하지 않는다.

    반면 바운더리의 fast-path는 '마셔/괜찮/될까' 같은 의도 키워드가 없으면 아예
    None을 반환하고 LLM 판정기로 넘긴다. 근거 로딩(`is_alcohol_topic`)이 fast-path
    보다 관대해야, LLM 판정기가 evidence가 필요하다고 판단한 평서문 질문에도
    개인 건강기록 스냅샷을 채울 수 있다."""
    statement = "요즘 매일 소주 한 병씩 마시고 있어"

    assert is_alcohol_topic(statement) is True
    assert HealthAssistantBoundaryService._fast_path_decision([ChatMessage(role="user", content=statement)]) is None
