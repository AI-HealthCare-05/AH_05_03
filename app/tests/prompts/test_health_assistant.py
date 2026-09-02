from app.dtos.health_assistant import ProfileContext
from app.prompts.health_assistant import build_system_instruction


def test_build_system_instruction_without_context() -> None:
    instruction = build_system_instruction(None)

    assert "시스템 기준 일자" in instruction
    assert "가족 건강관리 서비스" in instruction
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
