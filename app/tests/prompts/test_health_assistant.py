import pytest

from app.dtos.health_assistant import ProfileContext
from app.prompts.health_assistant import build_system_instruction
from app.prompts.health_assistant_boundary import build_health_assistant_scope_instruction


def test_build_system_instruction_without_context() -> None:
    instruction = build_system_instruction(None)

    assert "시스템 기준 일자" in instruction
    assert "한국 표준시" in instruction
    assert "가족 건강관리 서비스" in instruction
    assert "원래 질문" in instruction
    assert "임의의 08:00, 12:00 같은 시각을 만들지 마세요" in instruction
    assert "대화 대상 프로필 컨텍스트" not in instruction


def test_build_system_instruction_with_context() -> None:
    ctx = ProfileContext(
        profile_name="홍길동", relationship="아빠", birth_year=1970, recent_records_summary="최근 8월 31일 혈압 120/80"
    )
    instruction = build_system_instruction(ctx)

    assert "대화 대상 프로필 컨텍스트" in instruction
    assert "홍길동 (아빠)" in instruction
    assert "출생년도: 1970년" in instruction
    assert "최근 8월 31일 혈압 120/80" in instruction


def test_build_system_instruction_forbids_claiming_location_was_checked() -> None:
    instruction = build_system_instruction()

    assert "실제 위치를 확인하거나 날씨·대기질을 조회한 것처럼 말하지 마세요" in instruction


def test_build_system_instruction_does_not_invent_profile_location_settings() -> None:
    instruction = build_system_instruction()

    assert "프로필에는 거주지나 현재 위치를 저장하는 설정이 없습니다" in instruction
    assert "브라우저가 이번 요청에 제공한 좌표" in instruction
    assert "대기질 측정소는 사용자의 거주지가 아닙니다" in instruction


@pytest.mark.skip(reason="[알잘딱깔센] 무근거 차단 폐지 반영")
def test_build_system_instruction_contains_health_condition_guidance() -> None:
    instruction = build_system_instruction()

    assert "대화 맥락 및 지속적 건강 상태(임신, 수유, 만성질환 등) 연계 안내" in instruction
    assert "이전 대화 세션 기록" not in instruction
    assert "승인 근거에 없는 임신 중 약물 안전성" in instruction
    assert "비교적 안전하게 사용되는 진통제" not in instruction


@pytest.mark.skip(reason="[알잘딱깔센] 무근거 차단 폐지 반영")
def test_build_system_instruction_contains_supplement_guidance() -> None:
    instruction = build_system_instruction()

    assert "영양제 섭취는 담당 의료진이나 전문의와 상의를 먼저 하신 후 복용을 권장드립니다" in instruction
    assert "일반적으로는 ~" in instruction
    assert "음식·식단·영양성분 질문은 영양제 문의가 아닙니다" in instruction


def test_build_system_instruction_contains_food_nutrition_guidance() -> None:
    instruction = build_system_instruction()

    assert "음식 및 영양성분(칼로리/나트륨/당류) 문의 지침" in instruction
    assert "search_food_nutrition" in instruction
    assert "1일 나트륨 2,000mg 권장치" in instruction


@pytest.mark.skip(reason="[알잘딱깔센] 무근거 차단 폐지 반영")
def test_system_instruction_contains_safety_rules() -> None:
    instruction = build_system_instruction()

    assert "의료 진단/처방 절대 금지" in instruction
    assert "사실 기반 추출" in instruction


def test_scope_instruction_contains_scope_evidence_and_query_builder() -> None:
    instruction = build_health_assistant_scope_instruction()

    assert "서비스 범위 판정기" in instruction
    assert "requires_authoritative_evidence" in instruction
    assert "required_evidence_types" in instruction
    assert "inferred_intent" in instruction
    assert "enriched_query" in instruction
    assert "response_mode" in instruction
    assert "clarification_kind" in instruction
    assert "request_kind" in instruction
    assert "clinical_contexts" in instruction
    assert "자유문장 질문을 만들지 말고" in instruction
    assert "특정 음식·제품을 지목하지 않은 질환별 식이 질문" in instruction
    assert "현재 한 문장에 기록명이나 질환명이 다시 나오지 않았다는" in instruction
    assert "개인기록을 가리키는 대상이 이어지고 있으면" in instruction


def test_system_instruction_keeps_record_interpretation_conversational() -> None:
    instruction = build_system_instruction()

    assert "저장된 기록을 평가·해석하거나 원인·관리법·대안을 묻는 요청은 `health_advice`" in instruction
    assert "같은 정보를 다시 조회하라고 돌려보내지 마세요" in instruction
    assert "하나만 요청하면 가장 실행하기 쉬운 행동 정확히 한 가지만" in instruction
    assert "화면에 곧 표시된다고 약속하지 마세요" in instruction


def test_scope_instruction_defines_request_kind_and_clinical_context_contract() -> None:
    instruction = build_health_assistant_scope_instruction()

    assert "operation" in instruction
    assert "information" in instruction
    assert "personalized_advice" in instruction
    assert "pregnancy" in instruction
    assert "symptom" in instruction
    assert "chronic_condition" in instruction
    assert "medication" in instruction
    assert "treatment" in instruction
    assert "none은 다른 값과 함께 넣지 마세요" in instruction


def test_scope_instruction_distinguishes_health_record_from_contextual_advice() -> None:
    instruction = build_health_assistant_scope_instruction()

    assert "'무릎이 아파' → health, operation, [symptom], false, []" in instruction
    assert "'무릎이 아픈데 산책해도 돼?' → health, personalized_advice, [symptom], true" in instruction
    assert "'임신 중인데 달리기 해도 돼?' → health, personalized_advice, [pregnancy], true" in instruction
    assert "required_evidence_types=[] 또는 [outdoor]만 반환하지 마세요" in instruction


def test_scope_instruction_distinguishes_activity_from_current_outdoor_conditions() -> None:
    instruction = build_health_assistant_scope_instruction()

    assert "활동명이 있다는 이유만으로 outdoor를 넣지 마세요" in instruction
    assert "'오늘 날씨 어때?' → health, information, [none], true, [outdoor], answer" in instruction
    assert "'오늘 한강에서 러닝해도 돼?' → health, personalized_advice, [none], true, [outdoor], answer" in instruction
    assert "[health_knowledge, outdoor], clarify" in instruction
