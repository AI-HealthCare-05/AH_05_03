from app.dtos.health_assistant import ProfileContext
from app.prompts.health_assistant import build_system_instruction
from app.prompts.health_assistant_boundary import build_health_assistant_scope_instruction


def test_build_system_instruction_without_context() -> None:
    instruction = build_system_instruction(None)

    assert "시스템 기준 일자" in instruction
    assert "한국 표준시" in instruction
    assert "가족 건강관리 서비스" in instruction
    assert "원래 질문은 공식 의약품 도구 결과가 있을 때만 답하세요" in instruction
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


def test_build_system_instruction_contains_health_condition_guidance() -> None:
    instruction = build_system_instruction()

    assert "대화 맥락 및 지속적 건강 상태(임신, 수유, 만성질환 등) 연계 안내" in instruction
    assert "이전 대화 세션 기록" not in instruction


def test_build_system_instruction_contains_supplement_guidance() -> None:
    instruction = build_system_instruction()

    assert "영양제 관련 공식 근거가 없으면" in instruction
    assert "일반 정보를 덧붙이지 말고" in instruction


def test_build_system_instruction_contains_food_nutrition_guidance() -> None:
    instruction = build_system_instruction()

    assert "음식 및 영양성분(칼로리/나트륨/당류) 문의 지침" in instruction
    assert "search_food_nutrition" in instruction
    assert "질환별 권장량과 비교하거나 섭취 방법을 권고하려면" in instruction


def test_system_instruction_forbids_model_prior_health_knowledge() -> None:
    instruction = build_system_instruction()

    assert "모델의 학습 지식 사용 금지" in instruction
    assert "공식 외부 API 도구 결과" in instruction
    assert "근거 없이 건강정보를 안내하지 않겠습니다" in instruction
    assert "건강과 무관한 질문에는 답하지 말고" in instruction


def test_scope_instruction_separates_health_service_and_unrelated_questions() -> None:
    instruction = build_health_assistant_scope_instruction()

    assert "health: 질병, 증상" in instruction
    assert "service_usage: 인사" in instruction
    assert "out_of_scope: 연예인" in instruction
    assert "prompt_attack" in instruction
    assert "답하거나 건강정보를 설명하지 말고" in instruction
