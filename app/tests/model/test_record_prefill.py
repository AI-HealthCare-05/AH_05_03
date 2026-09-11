"""남긴 기록 → 판정 입력 계약 — `app/services/record_prefill.py`.

**왜 이 파일이 생겼나.** 이 경로가 조용히 틀릴 자리가 다섯이고, 다섯 다 화면에서는
정상으로 보인다.

1. **식후 혈당이 공복혈당 칸에 들어간다.** 식후 2시간은 정상인도 140 을 넘어서
   그 사람은 당뇨(126 이상)로 판정된다. 이 파일에서 가장 무거운 단정이다.
2. **오래된 값이 이긴다.** 정렬이 빠지면 석 달 전 혈압이 어제 혈압을 덮는다.
3. **이름 오독이 통과한다.** `크레아틴` 은 `크레아티닌` 이 아니다 — 검진표 경로가
   이미 막고 있고(`ocr_measurements`), 손기록 경로도 같은 사전을 써야 한다.
4. **옛 필드 이름으로 저장된 기록이 빠진다.** writer 를 통일하기 전 기록이 남는다.
5. **통증 다이어리가 섞여 들어온다.** 판정 모델의 입력이 아니다.

전부 "값이 없다" 또는 "값이 있다" 로만 보여서 지표로는 안 잡힌다.
"""

from __future__ import annotations

from typing import Any

from app.services import record_prefill


def record(record_type: str, recorded_at: str, payload: dict[str, Any], record_id: str = "r") -> dict[str, Any]:
    return {"id": record_id, "record_type": record_type, "recorded_at": recorded_at, "payload": payload}


def fields(items: list[record_prefill.PrefilledValue]) -> dict[str, float]:
    return {item.field: item.value for item in items}


class TestGlucoseTiming:
    def test_fasting_glucose_is_taken(self) -> None:
        got = record_prefill.build(
            [record("blood_glucose", "2026-09-10T07:00:00+09:00", {"valueMgDl": 104, "timing": "fasting"})]
        )

        assert fields(got)["fasting_glucose"] == 104
        # 폼의 `is_fasting` 도 같이 켜야 한다. 비어 있으면 임계값이 다르게 적용된다.
        assert fields(got)["is_fasting"] == 1.0

    def test_post_meal_glucose_is_refused(self) -> None:
        """**이 단정이 이 파일의 핵심이다.** 식후 188 을 공복 칸에 넣으면 당뇨 판정이다."""
        got = record_prefill.build(
            [record("blood_glucose", "2026-09-10T13:00:00+09:00", {"valueMgDl": 188, "timing": "after_meal"})]
        )

        assert "fasting_glucose" not in fields(got)
        assert "is_fasting" not in fields(got)

    def test_unknown_timing_is_refused(self) -> None:
        """모르는 것을 공복으로 가정하지 않는다."""
        got = record_prefill.build([record("blood_glucose", "2026-09-10T13:00:00+09:00", {"valueMgDl": 99})])

        assert "fasting_glucose" not in fields(got)

    def test_korean_timing_is_accepted(self) -> None:
        got = record_prefill.build(
            [record("blood_glucose", "2026-09-10T07:00:00+09:00", {"valueMgDl": 101, "timing": "공복"})]
        )

        assert fields(got)["fasting_glucose"] == 101


class TestRecency:
    def test_the_newest_record_wins_per_field(self) -> None:
        got = record_prefill.build(
            [
                record("blood_pressure", "2026-09-10T10:00:00+09:00", {"systolicMmHg": 128}, "new"),
                record("blood_pressure", "2026-06-08T10:00:00+09:00", {"systolicMmHg": 142}, "old"),
            ]
        )

        assert fields(got)["sbp"] == 128
        # 값이 언제 것인지 같이 나와야 한다 — 화면이 그걸 보여줘야 오늘의 답인지 알 수 있다.
        by_field = {item.field: item for item in got}
        assert by_field["sbp"].measured_at.startswith("2026-09-10")
        assert by_field["sbp"].record_id == "new"

    def test_input_order_does_not_decide(self) -> None:
        """호출자가 정렬해 주기를 기대하지 않는다. 정렬이 빠지면 오래된 값이 이긴다."""
        newest = record("body_measurement", "2026-09-10T08:00:00+09:00", {"weightKg": 78.4}, "new")
        oldest = record("body_measurement", "2026-01-02T08:00:00+09:00", {"weightKg": 85.0}, "old")

        forward = fields(record_prefill.build([oldest, newest]))
        backward = fields(record_prefill.build([newest, oldest]))
        assert forward == backward == {"weight_kg": 78.4}


class TestLabResultGoesThroughTheSameGate:
    def test_a_known_label_maps(self) -> None:
        got = record_prefill.build(
            [record("lab_result", "2026-09-09T09:00:00+09:00", {"testName": "당화혈색소", "value": "6.1", "unit": "%"})]
        )

        assert fields(got)["hba1c"] == 6.1

    def test_a_misread_label_is_refused(self) -> None:
        """`크레아틴` 은 `크레아티닌` 이 아니다 — 아예 다른 검사다.

        `ocr_measurements` 가 유사도 매칭을 쓰지 않기 때문에 막힌다. 손기록 경로가
        자체 사전을 갖게 되면 검진표에서는 막히고 여기서는 통과하는 오독이 생긴다.
        """
        got = record_prefill.build(
            [
                record(
                    "lab_result",
                    "2026-09-09T09:00:00+09:00",
                    {"testName": "크레아틴", "value": "0.88", "unit": "mg/dL"},
                )
            ]
        )

        assert fields(got) == {}

    def test_a_screening_sheet_maps_every_item(self) -> None:
        """**빠뜨렸던 자리다.** `lab_result` 만 태우고 `health_screening` 의 `items` 를
        무시해서, 검진표에서 읽은 21개 항목이 화면에는 다 보이는데 판정에는 한 칸도
        안 넘어갔다(2026-09-10 사용자 보고 — "데이터는 있는데 판정에서 안 보인다").

        참고치가 `judgment` 칸으로 오는 것도 여기서 못 박는다 — 자료마다 이름이 다르고,
        놓치면 참고치 관문이 조용히 꺼진다.
        """
        got = record_prefill.build(
            [
                record(
                    "health_screening",
                    "2026-08-28T09:00:00+09:00",
                    {
                        "screeningName": "건강검진",
                        "items": [
                            {"testName": "신장", "value": "171.0", "unit": "cm", "judgment": "-"},
                            {"testName": "체중", "value": "88.5", "unit": "kg", "judgment": "-"},
                            {"testName": "수축기 혈압(SBP)", "value": "144", "unit": "mmHg", "judgment": "< 120"},
                            {"testName": "공복혈당(FBS)", "value": "122", "unit": "mg/dL", "judgment": "70 ~ 99"},
                            {"testName": "총콜레스테롤", "value": "242", "unit": "mg/dL", "judgment": "< 200"},
                        ],
                    },
                )
            ]
        )

        assert fields(got)["height_cm"] == 171.0
        assert fields(got)["weight_kg"] == 88.5
        assert fields(got)["sbp"] == 144.0
        assert fields(got)["total_chol"] == 242.0
        # 검진표의 공복혈당은 이름 자체가 공복이라 `timing` 을 따로 볼 필요가 없다.
        assert fields(got)["fasting_glucose"] == 122.0
        assert fields(got)["is_fasting"] == 1.0

    def test_a_screening_sheet_still_refuses_a_misread_label(self) -> None:
        """검진표 경로에서도 사전이 같이 일한다. 한쪽만 느슨해지면 안 된다."""
        got = record_prefill.build(
            [
                record(
                    "health_screening",
                    "2026-08-28T09:00:00+09:00",
                    {"items": [{"testName": "크레아틴", "value": "0.88", "unit": "mg/dL"}]},
                )
            ]
        )

        assert fields(got) == {}

    def test_a_value_outside_the_dto_range_is_refused(self) -> None:
        got = record_prefill.build(
            [record("lab_result", "2026-09-09T09:00:00+09:00", {"testName": "당화혈색소", "value": "99", "unit": "%"})]
        )

        assert "hba1c" not in fields(got)


class TestLegacyFieldNames:
    def test_pre_unification_names_still_read(self) -> None:
        """writer 를 통일하기 전(2026-09-10) 저장된 기록도 읽는다.

        마이그레이션 대신 읽을 때 흡수한다 — 마이그레이션은 되돌릴 수 없다.
        """
        got = record_prefill.build(
            [record("blood_pressure", "2026-09-08T10:00:00+09:00", {"systolic": 142, "diastolic": 91})]
        )

        assert fields(got) == {"sbp": 142.0, "dbp": 91.0}

    def test_new_name_beats_old_when_it_is_newer(self) -> None:
        got = record_prefill.build(
            [
                record("blood_pressure", "2026-09-08T10:00:00+09:00", {"systolic": 142}, "legacy"),
                record("blood_pressure", "2026-09-10T10:00:00+09:00", {"systolicMmHg": 128}, "canonical"),
            ]
        )

        assert fields(got)["sbp"] == 128

    def test_challenge_measurements_pass_through(self) -> None:
        """챌린지는 처음부터 판정 칸 이름으로 저장한다(`TREND_SERIES`). 나머지를 이 모양으로
        수렴시킨 것이므로, 그 경로가 계속 도는지 같이 본다."""
        got = record_prefill.build(
            [record("blood_pressure", "2026-09-10T09:00:00+09:00", {"values": {"sbp": 131, "dbp": 85}})]
        )

        assert fields(got) == {"sbp": 131.0, "dbp": 85.0}


class TestExcluded:
    def test_pain_diary_never_contributes(self) -> None:
        """부위·강도는 판정 모델의 입력이 아니다. 이으면 모델이 안 보는 값을 사용자가 채운다."""
        got = record_prefill.build([record("pain", "2026-09-10T20:00:00+09:00", {"bodyArea": "무릎", "intensity": 6})])

        assert fields(got) == {}

    def test_assessment_snapshots_never_contribute(self) -> None:
        """이미 다른 길이 있다. 두 경로가 같은 칸을 채우면 어느 쪽이 이겼는지 설명할 수 없다."""
        got = record_prefill.build(
            [record("assessment", "2026-09-10T20:00:00+09:00", {"inputs": {"sbp": 118}, "bmi": 26})]
        )

        assert fields(got) == {}

    def test_medication_and_notes_never_contribute(self) -> None:
        got = record_prefill.build(
            [
                record("medication", "2026-09-10T09:00:00+09:00", {"medicationName": "메트포르민"}),
                record("note", "2026-09-10T09:00:00+09:00", {"text": "혈압 128"}),
            ]
        )

        assert fields(got) == {}

    def test_out_of_range_measurements_are_refused(self) -> None:
        """DTO 범위는 `AssessmentSummaryRequest` 한 곳에 산다. 여기 베껴 적지 않는다."""
        got = record_prefill.build([record("blood_pressure", "2026-09-10T10:00:00+09:00", {"systolicMmHg": 9999})])

        assert "sbp" not in fields(got)


class TestCanonicalWins:
    """**고친 값이 원본으로 되돌아가지 않는다** — `fields_for` 의 쌓는 순서.

    검진표는 두 겹으로 담긴다. OCR 이 읽은 행(`items`)과 판정 칸 이름으로 정리한
    맵(`values`). 사용자가 수치를 고치면 고친 값은 `values` 에만 들어가므로, 읽은
    행이 나중에 덮으면 화면에는 고친 값이 보이는데 판정은 원본으로 돌아간다.
    """

    def test_values_override_items(self) -> None:
        got = record_prefill.fields_for(
            "health_screening",
            {
                "items": [{"testName": "공복혈당", "value": 104, "unit": "mg/dL"}],
                "values": {"fasting_glucose": 96},
            },
        )
        assert got["fasting_glucose"] == 96

    def test_items_still_read_without_values(self) -> None:
        # 옛 기록에는 정본 맵이 없다. 그때는 읽은 행이 유일한 값이다.
        got = record_prefill.fields_for(
            "health_screening",
            {"items": [{"testName": "공복혈당", "value": 104, "unit": "mg/dL"}]},
        )
        assert got["fasting_glucose"] == 104

    def test_values_survive_alias_collision(self) -> None:
        # 옛 이름(`systolic`)이 정본 맵을 덮으면 안 된다 — 별칭이 가장 낮다.
        got = record_prefill.fields_for("blood_pressure", {"systolic": 150, "values": {"sbp": 128}})
        assert got["sbp"] == 128

    def test_out_of_range_values_are_dropped(self) -> None:
        # 정본 맵도 DTO 범위 관문을 탄다. 통과 못 하면 그냥 빠진다.
        got = record_prefill.fields_for("health_screening", {"values": {"sbp": 9000, "dbp": 88}})
        assert "sbp" not in got
        assert got["dbp"] == 88
