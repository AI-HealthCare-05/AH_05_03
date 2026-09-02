"""표 → 수치 매핑. **통과시키는 것보다 걸러 내는 것을 더 많이 잰다.**

`config.OPENAI_IMAGE_DETAIL` 주석에 기록된 실제 오독을 그대로 케이스로 옮겼다.
그 오독이 수치로 통과하면 사용자는 자기가 적지도 않은 숫자로 판정받는다.
"""

from app.services.ocr_measurements import extract


def table(*rows: list[str]) -> list[dict]:
    return [{"table_index": 0, "rows": list(rows)}]


class TestReadsWhatItShould:
    def test_maps_standard_checkup_rows_to_values(self) -> None:
        """국가건강검진 결과지에 실제로 인쇄되는 표기들."""
        result = extract(
            table(
                ["식전혈당(FBS)", "113", "mg/dL", "이상 (정상: 74~99)"],
                ["총콜레스테롤", "188", "mg/dL", "정상 (0~199)"],
                ["HDL콜레스테롤", "52", "mg/dL", "정상 (40~60)"],
                ["중성지방", "142", "mg/dL", "정상 (0~199)"],
                ["혈색소", "14.2", "g/dL", "정상 (13~16.5)"],
                ["혈청크레아티닌", "0.9", "mg/dL", "정상 (0.5~1.4)"],
            )
        )
        assert result.values == {
            "fasting_glucose": 113.0,
            "total_chol": 188.0,
            "hdl": 52.0,
            "triglyceride": 142.0,
            "hemoglobin": 14.2,
            "creatinine": 0.9,
        }
        assert result.review == []

    def test_matches_the_old_name_inside_parentheses(self) -> None:
        """`AST (SGOT)` 처럼 괄호에 옛 이름을 넣는 관행이 있다."""
        assert extract(table(["AST (SGOT)", "41", "U/L", "이상 (정상: 0~40)"])).values == {"ast": 41.0}

    def test_treats_iu_per_litre_as_u_per_litre(self) -> None:
        assert extract(table(["감마지티피", "35", "IU/L", "정상 (0~73)"])).values == {"ggt": 35.0}

    def test_splits_blood_pressure_printed_in_one_cell(self) -> None:
        """`120/80` 을 한 칸에 찍는 검진표가 있다. 행 하나가 값 둘이다."""
        assert extract(table(["혈압", "128/82", "mmHg", "정상"])).values == {"sbp": 128.0, "dbp": 82.0}

    def test_reads_fullwidth_characters(self) -> None:
        """검진표가 전각 영숫자(`ＡＬＴ`)를 쓰는 일이 있다."""
        assert extract(table(["ＡＬＴ", "２２", "U/L", "정상 (0~40)"])).values == {"alt": 22.0}


class TestUnitConversion:
    def test_converts_mmol_per_litre_glucose(self) -> None:
        """mmol/L → mg/dL 은 포도당 분자량으로 정해진 상수다."""
        assert extract(table(["공복혈당", "5.5", "mmol/L", ""])).values["fasting_glucose"] == round(5.5 * 18.0182, 4)

    def test_flags_a_unit_it_cannot_convert(self) -> None:
        """HbA1c 의 IFCC(mmol/mol) → NGSP(%) 는 1차식이라 곱셈으로 못 바꾼다."""
        result = extract(table(["당화혈색소", "42", "mmol/mol", ""]))
        assert result.values == {}
        assert "단위" in (result.review[0].reason or "")
        # 환산하지 못했으므로 값도 단위도 원문 그대로여야 한다.
        assert result.review[0].value == 42.0
        assert result.review[0].unit == "mmol/mol"


class TestGuardsAgainstMisreadNames:
    """여기가 이 모듈의 존재 이유다."""

    def test_bun_misread_as_uric_acid_is_caught_by_the_printed_reference(self) -> None:
        """기록된 사례. BUN 12.0 이 `요산` 으로 붙으면 요산 6.1 인 사람이 중증 고요산혈증이 된다."""
        result = extract(table(["요산", "12.0", "mg/dL", "정상 (8~20)"]))
        assert result.values == {}
        assert len(result.review) == 1
        assert "참고치" in (result.review[0].reason or "")
        # 화면에서 원본과 대조할 수 있어야 한다.
        assert result.review[0].value == 12.0
        assert result.review[0].source == ["요산", "12.0", "mg/dL", "정상 (8~20)"]

    def test_a_genuine_uric_acid_row_passes(self) -> None:
        assert extract(table(["요산", "6.1", "mg/dL", "정상 (3.0~7.0)"])).values == {"uric_acid": 6.1}

    def test_creatine_misread_is_held_for_review_not_accepted(self) -> None:
        """`크레아티닌` → `크레아틴`. 2026-08-28 `sample.jpeg` 실측에서 그대로 나왔다.

        **값을 잃지도, 말없이 채우지도 않는다.** 크레아티닌은 신기능 판정의 재료라
        틀리면 되돌릴 수 없고, 그렇다고 버리면 정밀형 tier 를 한 칸 잃는다.
        """
        row = ["크레아틴", "0.88", "mg/dL", "정상 (0.1~1.5)"]
        result = extract(table(row))
        assert result.values == {}
        assert result.unmatched == []
        assert len(result.review) == 1
        assert result.review[0].field == "creatinine"
        assert result.review[0].value == 0.88
        assert "크레아티닌" in (result.review[0].reason or "")

    def test_an_unknown_name_still_matches_nothing(self) -> None:
        """오독 사전은 **관측된 것만** 담는다. 모르는 이름은 여전히 안 잡힌다."""
        row = ["듣도보도못한검사", "0.9", "mg/dL", "정상 (0.5~1.4)"]
        result = extract(table(row))
        assert result.values == {}
        assert result.review == []
        assert result.unmatched == [row]

    def test_a_misread_row_still_goes_through_the_gates(self) -> None:
        """오독 사전을 통과했다고 관문을 건너뛰지 않는다."""
        result = extract(table(["크레아틴", "980", "mg/dL", ""]))
        assert result.values == {}
        assert "허용 범위" in (result.review[0].reason or "")

    def test_the_same_test_twice_with_different_values_is_held(self) -> None:
        """실제로 `요산` 행이 둘 나온 적이 있다. 어느 쪽이 맞는지 코드는 모른다."""
        result = extract(
            table(
                ["요산", "6.1", "mg/dL", "정상 (3.0~7.0)"],
                ["요산", "12.0", "mg/dL", "정상 (3.0~7.0)"],
            )
        )
        assert result.values == {}
        assert len(result.review) == 2
        assert all("서로 다른 값" in (row.reason or "") for row in result.review)

    def test_the_same_value_twice_counts_once(self) -> None:
        result = extract(
            table(
                ["요산", "6.1", "mg/dL", "정상 (3.0~7.0)"],
                ["Uric Acid", "6.1", "mg/dL", "정상 (3.0~7.0)"],
            )
        )
        assert result.values == {"uric_acid": 6.1}
        assert result.review == []


class TestGuardsAgainstBadValues:
    def test_censored_values_do_not_become_point_estimates(self) -> None:
        """`<5` 는 "5 미만" 이지 5 가 아니다."""
        result = extract(table(["요알부민크레아티닌비", "<5", "mg/g", "정상 (0~30)"]))
        assert result.values == {}
        assert "부등호" in (result.review[0].reason or "")

    def test_values_outside_the_input_range_are_refused(self) -> None:
        """DTO 의 `hemoglobin` 은 3~25 다. 142 는 다른 줄을 읽은 것이다."""
        result = extract(table(["혈색소", "142", "g/dL", ""]))
        assert result.values == {}
        assert "허용 범위" in (result.review[0].reason or "")

    def test_a_cell_without_a_number_goes_to_review(self) -> None:
        result = extract(table(["공복혈당", "판독불가", "mg/dL", ""]))
        assert result.values == {}
        assert "숫자" in (result.review[0].reason or "")

    def test_thousand_separators_are_not_decimal_points(self) -> None:
        assert extract(table(["요알부민크레아티닌비", "1,250", "mg/g", ""])).values == {"urine_acr": 1250.0}


class TestClassification:
    def test_known_but_unused_tests_are_kept_apart_from_unmatched(self) -> None:
        """읽긴 읽었는데 모델이 안 쓰는 것과, 아예 못 읽은 것은 다른 이야기다."""
        result = extract(table(["요소질소(BUN)", "12.0", "mg/dL", "정상 (8~20)"]))
        assert result.values == {}
        assert result.unmatched == []
        assert result.unused[0].field == "요소질소(BUN)"

    def test_a_row_with_missing_columns_still_reads(self) -> None:
        """모델이 열을 빠뜨리는 일이 있다."""
        assert extract(table(["공복혈당", "95"])).values == {"fasting_glucose": 95.0}

    def test_empty_tables_give_an_empty_result(self) -> None:
        assert extract([]).values == {}
        assert extract(None).values == {}

    def test_a_malformed_row_does_not_crash(self) -> None:
        assert extract([{"table_index": 0, "rows": ["망가진행", []]}]).values == {}


class TestPayload:
    def test_payload_is_json_ready(self) -> None:
        payload = extract(table(["공복혈당", "113", "mg/dL", "이상 (정상: 74~99)"])).to_payload()
        assert payload["values"] == {"fasting_glucose": 113.0}
        assert payload["review"] == []
        assert set(payload) == {"values", "review", "unused", "unmatched"}


class TestUnitlessSiValues:
    """모델이 단위 열을 통째로 비우는 일이 있다 (2026-08-28 실측).

    단위가 없으면 국내 관용 단위로 보고 환산하지 않는다. SI 단위 값이 단위 없이
    들어오면 **DTO 범위 관문이 잡는다** — 모듈 docstring 이 기대는 성질이라 못 박아 둔다.
    """

    def test_conventional_values_pass_without_a_unit(self) -> None:
        result = extract(
            table(
                ["크레아티닌", "0.88", "", "정상: 0.1~5"],
                ["요산", "6.1", "", "정상"],
                ["중성지방", "69", "", "정상: 0~20"],
            )
        )
        assert result.values == {"creatinine": 0.88, "uric_acid": 6.1, "triglyceride": 69.0}

    def test_si_glucose_without_a_unit_is_caught_by_bounds(self) -> None:
        result = extract(table(["공복혈당", "5.5", "", ""]))
        assert result.values == {}
        assert "허용 범위" in (result.review[0].reason or "")

    def test_si_haemoglobin_without_a_unit_is_caught_by_bounds(self) -> None:
        result = extract(table(["혈색소", "140", "", ""]))
        assert result.values == {}
        assert "허용 범위" in (result.review[0].reason or "")

    def test_si_creatinine_without_a_unit_is_caught_by_bounds(self) -> None:
        result = extract(table(["크레아티닌", "80", "", ""]))
        assert result.values == {}
        assert "허용 범위" in (result.review[0].reason or "")

    def test_a_garbled_reference_does_not_flag_a_good_row(self) -> None:
        """참고치를 지어내도 멀쩡한 행이 검토로 밀리면 안 된다.

        `_EXPECTED_REFERENCE` 를 넉넉하게 잡은 이유가 이것이다. 2회차에서 중성지방
        참고치가 `0~20` 으로 나왔는데 값 69 는 정상이다.
        """
        result = extract(table(["트리글리세라이드", "69", "mg/dL", "정상: 0~20"]))
        assert result.values == {"triglyceride": 69.0}


class TestShortAbbreviationsAreDeliberatelyNarrow:
    """두 글자 약어는 한 글자만 틀려도 값이 다른 칸에 앉는다.

    관문은 이걸 못 잡는다 — 총콜레스테롤 188 과 중성지방 188 은 둘 다 정상 범위다.
    사전에서 막는 수밖에 없어서, 위험한 짝이 있는 약어는 넣지 않았다.
    """

    def test_bare_tc_is_not_accepted_as_total_cholesterol(self) -> None:
        """`TC` 는 `TG` 와 한 글자 차이다."""
        result = extract(table(["TC", "188", "mg/dL", "정상 (0~199)"]))
        assert result.values == {}
        assert result.unmatched == [["TC", "188", "mg/dL", "정상 (0~199)"]]

    def test_bare_ua_is_not_accepted_as_uric_acid(self) -> None:
        """`UA` 는 `UN`(urea nitrogen)과 한 글자 차이다 — 이 저장소가 실제로 당한 사고다."""
        result = extract(table(["UA", "12.0", "mg/dL", "정상"]))
        assert result.values == {}
        assert result.unmatched == [["UA", "12.0", "mg/dL", "정상"]]

    def test_the_spelled_out_names_still_work(self) -> None:
        result = extract(
            table(
                ["총콜레스테롤", "188", "mg/dL", "정상 (0~199)"],
                ["Uric Acid", "6.1", "mg/dL", "정상 (3.0~7.0)"],
                ["T-CHOL", "190", "mg/dL", "정상"],
            )
        )
        assert result.values["uric_acid"] == 6.1
        # `총콜레스테롤` 과 `T-CHOL` 이 같은 칸을 서로 다른 값으로 채우므로 둘 다 보류된다.
        assert "total_chol" not in result.values
        assert any("서로 다른 값" in (row.reason or "") for row in result.review)
