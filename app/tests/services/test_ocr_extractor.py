"""OCR 행 조립 로직 — 엔진 없이 순수 로직만 검증한다.

토큰은 실제 RapidOCR 출력을 그대로 옮긴 것이다. 한글 라벨이 깨져 나오는
모습(`引`, `吕青品`)까지 재현해야 보완 단서(라틴·단위·참고치)가 실제로
동작하는지 확인할 수 있다.
"""

from app.services.ocr.engine import OcrToken
from app.services.ocr.extractor import extract_rows, find_measured_date, group_rows


def token(text: str, *, conf: float = 1.0, left: float = 0, top: float = 0, width: float = 80) -> OcrToken:
    return OcrToken(text=text, confidence=conf, left=left, right=left + width, top=top, bottom=top + 40)


def _row(y: float, label: str, value: str, unit: str, reference: str, *, label_conf: float = 0.9) -> list[OcrToken]:
    return [
        token(label, conf=label_conf, left=250, top=y),
        token(value, left=1100, top=y),
        token(unit, left=1300, top=y),
        token(reference, left=1740, top=y),
    ]


class TestGroupRows:
    def test_tokens_on_same_y_group_into_one_row(self) -> None:
        tokens = [*_row(100, "요산", "5.4", "mg/dL", "2.6~7.2"), *_row(200, "크레아티닌", "0.91", "mg/dL", "0~1.5")]
        assert len(group_rows(tokens)) == 2

    def test_empty_tokens_yield_no_rows(self) -> None:
        assert group_rows([]) == []


class TestExtractRows:
    def test_clean_korean_label_matches_directly(self) -> None:
        rows = extract_rows(_row(100, "트리글리세라이드", "98", "mg/dL", "0~150"))
        assert [(r.item_code, r.value, r.needs_review) for r in rows] == [("triglyceride", 98.0, False)]

    def test_latin_prefix_separates_hdl_from_ldl_when_korean_is_garbled(self) -> None:
        # RapidOCR 실측 출력: HDL-콜레스테롤 → "HDL-引", LDL-콜레스테롤 → "LDL-印"
        tokens = [
            *_row(100, "HDL-引", "62", "mg/dL", "60 이상"),
            *_row(200, "LDL-印", "103", "mg/dL", "0~130"),
        ]
        rows = extract_rows(tokens)
        assert {r.item_code: r.value for r in rows} == {"hdl_cholesterol": 62.0, "ldl_cholesterol": 103.0}
        assert all("latin" in r.signals for r in rows)

    def test_reference_range_alone_identifies_item(self) -> None:
        # 실측: 혈색소 행의 g/dL이 "7p/6"으로 깨져 단위 단서를 잃었다.
        tokens = [
            token("", conf=0.0, left=250, top=100),
            token("15.0", left=1100, top=100),
            token("7p/6", conf=0.91, left=1300, top=100),
            token("13~16.5", left=1740, top=100),
        ]
        rows = extract_rows(tokens)
        assert [(r.item_code, r.value) for r in rows] == [("hemoglobin", 15.0)]
        assert rows[0].signals == ["reference"]

    def test_garbled_unit_token_is_not_read_as_value(self) -> None:
        # "7p/6"을 숫자로 보면 76이 값이 된다. 슬래시가 든 토큰은 숫자가 아니다.
        rows = extract_rows(
            [
                token("15.0", left=1100, top=100),
                token("7p/6", left=1300, top=100),
                token("13~16.5", left=1740, top=100),
            ]
        )
        assert rows[0].value == 15.0

    def test_same_item_code_is_assigned_only_once(self) -> None:
        tokens = [
            *_row(100, "총콜레스테롤", "185", "mg/dL", "0~200"),
            *_row(200, "총콜레스테롤", "236", "mg/dL", "0~200"),
        ]
        codes = [r.item_code for r in extract_rows(tokens)]
        assert codes.count("total_cholesterol") == 1
        assert None in codes  # 남은 행은 항목 미확정으로 검수 대상이 된다

    def test_out_of_range_value_is_not_confirmed(self) -> None:
        # 크레아티닌 상한 15를 넘는 값. OCR이 소수점을 놓친 경우다.
        rows = extract_rows(_row(100, "크레아티닌", "91", "mg/dL", "0~1.5"))
        assert rows[0].value is None
        assert rows[0].needs_review is True

    def test_low_confidence_row_needs_review(self) -> None:
        rows = extract_rows(_row(100, "요산", "5.4", "mg/dL", "2.6~7.2", label_conf=0.4))
        assert rows[0].value == 5.4
        assert rows[0].needs_review is True

    def test_line_without_value_is_not_a_row(self) -> None:
        assert extract_rows([token("검사항목", left=250, top=100), token("결과", left=1100, top=100)]) == []

    def test_unidentified_item_has_null_code_and_needs_review(self) -> None:
        rows = extract_rows(_row(100, "알수없는항목", "42", "mg/dL", "1~2"))
        assert rows[0].item_code is None
        assert rows[0].needs_review is True
        assert rows[0].raw_value == "42"


class TestFindMeasuredDate:
    def test_finds_hyphen_separated_date(self) -> None:
        assert find_measured_date([token("2026-03-11")]) == "2026-03-11"

    def test_pads_single_digit_month_and_day(self) -> None:
        assert find_measured_date([token("2026.1.5")]) == "2026-01-05"

    def test_returns_none_when_absent(self) -> None:
        assert find_measured_date([token("건강검진 결과통보서")]) is None

    def test_ignores_out_of_range_month(self) -> None:
        assert find_measured_date([token("2026-13-01")]) is None
