"""덜 온 JSON 에서 `text` 를 뽑는 파서. 청크 경계가 어디에 떨어져도 살아야 한다.

여기가 깨지면 증상이 "글자가 이상하게 깨짐" 이라 원인 찾기가 어렵다. 그래서 경계를
손으로 골라 가며 밀어 넣는다 — 실제 스트림에서 그 자리가 언제 나올지는 고를 수 없다.
"""

from app.services.ocr_partial import PartialJsonTextReader

FULL = '{"text": "검사기관: 강서구보건소\\n검사일자: 2024-09-19", "tables": []}'
EXPECTED = "검사기관: 강서구보건소\n검사일자: 2024-09-19"


def _drain(chunks: list[str]) -> str:
    reader = PartialJsonTextReader()
    return "".join(reader.push(chunk) for chunk in chunks)


def test_reads_a_single_complete_chunk() -> None:
    assert _drain([FULL]) == EXPECTED


def test_survives_one_character_at_a_time() -> None:
    """가장 잔인한 경계. 모든 이스케이프가 반드시 쪼개진다."""
    assert _drain(list(FULL)) == EXPECTED


def test_survives_a_cut_right_after_a_backslash() -> None:
    cut = FULL.index("\\n") + 1  # `\` 까지만 온 상태
    assert _drain([FULL[:cut], FULL[cut:]]) == EXPECTED


def test_survives_a_cut_inside_a_unicode_escape() -> None:
    raw = '{"text": "A\\u00e9B"}'
    for cut in range(len(raw)):
        assert _drain([raw[:cut], raw[cut:]]) == "A\u00e9B", f"cut={cut}"


def test_emits_nothing_before_the_text_key_arrives() -> None:
    reader = PartialJsonTextReader()
    assert reader.push('{"tables": [], "te') == ""


def test_follows_text_even_when_tables_come_first() -> None:
    """모델이 필드 순서를 바꿔 내보낼 수 있다. 스키마가 순서를 보장하지 않는다."""
    raw = '{"tables": [{"table_index": 1, "rows": []}], "text": "결과"}'
    assert _drain([raw]) == "결과"


def test_stops_at_the_closing_quote() -> None:
    """`text` 가 닫힌 뒤 `tables` 안의 문자열까지 이어 읽으면 안 된다."""
    raw = '{"text": "끝", "tables": [{"rows": [["오염", "999"]]}]}'
    assert _drain([raw]) == "끝"


def test_emits_only_the_newly_grown_part() -> None:
    reader = PartialJsonTextReader()
    assert reader.push('{"text": "가나') == "가나"
    assert reader.push("다라") == "다라"
    assert reader.push('", "tables": []}') == ""


def test_ignores_escaped_quotes() -> None:
    raw = '{"text": "그는 \\"정상\\" 이라고 했다", "tables": []}'
    assert _drain([raw]) == '그는 "정상" 이라고 했다'


def test_treats_quote_after_escaped_backslash_as_the_end() -> None:
    raw = '{"text": "경로 C:\\\\\\\\temp", "tables": []}'
    assert _drain([raw]) == "경로 C:\\\\temp"
