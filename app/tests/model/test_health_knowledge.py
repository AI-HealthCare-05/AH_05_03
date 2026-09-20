from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.core import config
from app.dtos.health_assistant import ChatMessage, HealthAssistantResponse
from app.dtos.health_knowledge import HealthKnowledgeItem, HealthKnowledgeSearchResult
from app.dtos.health_record_query import PersonalHealthSnapshot
from app.services.health_assistant_boundary import HealthAssistantBoundaryService
from app.services.health_knowledge_catalog import HealthKnowledgeCatalogClient, is_alcohol_topic
from app.services.kdca_health_info_client import KdcaHealthInfoClient, _candidate_keywords, _is_relevant


@pytest.mark.asyncio
async def test_catalog_returns_only_curated_kdca_alcohol_sources() -> None:
    client = HealthKnowledgeCatalogClient()

    alcohol = await client.search("나 오늘 술 마셔도 돼?")
    unrelated = await client.search("허리가 아파")

    assert len(alcohol.items) == 2
    assert all(item.url.startswith("https://health.kdca.go.kr/") for item in alcohol.items)
    assert unrelated.items == []


def test_alcohol_question_falls_through_to_llm_classifier() -> None:
    """음주 질문은 전용 fast-path 없이 LLM 판정기로 넘어간다.

    삭제된 is_alcohol_topic fast-path가 없으므로 _fast_path_decision이 None을 반환한다.
    LLM이 health_records/health_knowledge 근거를 판정한다.
    """
    decision = HealthAssistantBoundaryService._fast_path_decision(
        [ChatMessage(role="user", content="나 오늘 술 마셔도 돼?")]
    )

    assert decision is None


@pytest.mark.skip(reason="[알잘딱깔센] 무근거 차단 폐지 반영")
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
    snapshot = PersonalHealthSnapshot(message="기록 없음", missing_sections=["blood_pressure", "liver_tests"])
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


@pytest.mark.skipif(
    not config.KDCA_HEALTH_INFO_API_KEY, reason="KDCA_HEALTH_INFO_API_KEY 미설정 — 실제 API 통합 테스트 생략"
)
@pytest.mark.asyncio
async def test_kdca_health_info_client_hits_the_real_api() -> None:
    """가짜로 대체한 단위 테스트는 내부 로직만 검증하고, 실제 질병관리청 API가 지금도
    이 형태로 응답하는지는 검증하지 못한다 — 그건 이 테스트가 진짜 네트워크로 확인한다.

    포털이 마크업을 바꾸면(HTML 스크레이핑이라 정식 계약이 없다) 이 테스트가
    가장 먼저, 그리고 유일하게 잡아낸다. 키가 없는 환경(CI 등)에서는 조용히
    건너뛴다 — 실패가 아니라 생략이다."""
    client = KdcaHealthInfoClient()

    result = await client.search("고혈압")

    assert len(result.items) > 0, "실제 KDCA API에서 '고혈압' 검색 결과가 비었다 — 포털 응답 형식이 바뀌었을 수 있다"
    first = result.items[0]
    assert first.title
    assert first.url.startswith("https://health.kdca.go.kr/")
    assert len(first.summary) > 10


def test_kdca_food_question_uses_portal_title_alias() -> None:
    candidates = _candidate_keywords("당뇨에 좋은 음식")

    assert "당뇨환자의 식이요법" in candidates


def test_kdca_relevance_requires_same_disease_and_intent() -> None:
    query = "당뇨병 환자의 식이요법 안내"

    assert _is_relevant("당뇨환자의 식이요법", query) is True
    assert _is_relevant("고혈압 환자의 식이요법", query) is False
    assert _is_relevant("투석환자의 식이요법", query) is False
    assert _is_relevant("당뇨병 급성 합병증", query) is False


def test_kdca_relevance_covers_newly_added_diseases() -> None:
    assert _is_relevant("무릎관절염, 올바로 운동하기", "관절염 환자 운동 어떻게 해야 돼") is True
    assert _is_relevant("당뇨환자의 식이요법", "관절염 환자 운동 어떻게 해야 돼") is False


def test_kdca_relevance_rejects_ambiguous_intake_word_match() -> None:
    """'섭취'는 식이요법(먹는 것)과 방사성동위원소 섭취율(검사 수치)에 둘 다 쓰여서 오매칭을 낸다.

    갑상선 검사 문서가 '음식' 관련 질문에 걸리면 안 된다.
    """
    assert _is_relevant("갑상선 검사(방사성 요오드 섭취율)", "갑상선 기능 저하증에 좋은 음식") is False


def test_is_alcohol_topic_catches_statement_form_that_fast_path_intent_check_misses() -> None:
    """`is_alcohol_topic`은 주제 단어만 본다 — 의도(질문/평서문)는 상관하지 않는다.

    반면 바운더리의 fast-path는 '마셔/괜찮/될까' 같은 의도 키워드가 없으면 아예
    None을 반환하고 LLM 판정기로 넘긴다. 근거 로딩(`is_alcohol_topic`)이 fast-path
    보다 관대해야, LLM 판정기가 evidence가 필요하다고 판단한 평서문 질문에도
    개인 건강기록 스냅샷을 채울 수 있다."""
    statement = "요즘 매일 소주 한 병씩 마시고 있어"

    assert is_alcohol_topic(statement) is True
    assert HealthAssistantBoundaryService._fast_path_decision([ChatMessage(role="user", content=statement)]) is None
