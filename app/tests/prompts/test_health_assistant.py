from app.dtos.health_assistant import ProfileContext
from app.prompts.health_assistant import build_system_instruction


def test_build_system_instruction_without_context() -> None:
    instruction = build_system_instruction(None)

    assert "시스템 기준 일자" in instruction
    assert "한국 표준시" in instruction
    assert "가족 건강관리 서비스" in instruction
    assert "원래 질문에도 답하세요" in instruction
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


def test_build_system_instruction_with_previous_conversations_summary() -> None:
    ctx = ProfileContext(
        profile_name="김영희",
        relationship="본인",
        previous_conversations_summary="- 세션 '임신 초기 상담':\n  * 사용자: 나 지금 임신 12주차야",
    )
    instruction = build_system_instruction(ctx)

    assert "대화 대상 프로필 컨텍스트" in instruction
    assert "이전 대화 세션 기록" in instruction
    assert "임신 12주차야" in instruction
    assert "이전 대화 맥락 및 지속적 건강 상태(임신, 수유, 만성질환 등) 연계 안내" in instruction
