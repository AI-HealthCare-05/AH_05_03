"""패널 발병 라벨의 검열 계약 — `modeling/data/labels.py` 의 `add_incidence_labels`.

**왜 이 파일이 생겼나.** 지평 라벨(1·3·5년)을 만들면서 조용히 틀릴 수 있는 자리가
정확히 하나 생겼다 — **추적이 짧아 아직 안 걸린 사람을 음성으로 세는 것**이다. 그러면
발병률이 통째로 내려가고, 그 사고는 AUROC 를 봐서는 절대 안 잡힌다. 오히려 좋아 보인다
(양성이 줄면 쉬운 문제가 된다). `targets.py` 머리말이 라벨 누출에 대해 적은 것과 같은
종류의 함정이고, 그래서 같은 방식으로 테스트가 계약을 고정한다.

여기서 못 박는 것 넷.

1. 지평 안에서 진단이 뜨면 1
2. 지평 **뒤**의 관측이 "아직 못 들었다" 면 0 — 파동이 지평을 건너뛰어도 음성은 확정된다
   (자가보고 진단은 한 번 들으면 취소되지 않으므로)
3. 그 둘이 아니면 **NA** — 모르는 것을 0 으로 세지 않는다
4. 기준 시점에 이미 진단받은 사람은 위험군이 아니라 NA

마지막으로 **파동 간격이 지평보다 넓으면 그 지평은 비어야 한다.** 6년 간격 코호트
(Framingham)에서 1·3년 라벨이 나오면 그것은 데이터가 아니라 버그다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

MODELING = Path(__file__).resolve().parents[3] / "modeling"
for _extra in (MODELING, MODELING / "data"):
    if str(_extra) not in sys.path:
        sys.path.insert(0, str(_extra))

from labels import add_incidence_labels  # noqa: E402
from schema import LABELS, incidence_label  # noqa: E402
from splits import make_person_split  # noqa: E402


def panel(rows: list[tuple[str, int, bool | None]]) -> pd.DataFrame:
    """(사람, 조사연도, 당뇨 진단 자가보고) 세 칸짜리 최소 패널."""
    return pd.DataFrame(rows, columns=["subject_id", "survey_year", "dx_diabetes"])


def label_of(row: pd.Series, condition: str, horizon: int) -> bool | None:
    """라벨 하나를 파이썬 값으로. 결측은 `None`.

    `pandas` 의 `boolean` dtype 은 `numpy.bool_` 로 나오고 그건 `is True` 로 비교되지
    않는다. 세 값(참·거짓·모름)을 다루는 라벨이라 세 값을 그대로 견주고 싶어서
    여기서 한 번 바꾼다.
    """
    value = row[incidence_label(condition, horizon)]
    return None if pd.isna(value) else bool(value)


class TestHorizonLabels:
    def test_diagnosis_inside_the_horizon_is_positive(self) -> None:
        frame = add_incidence_labels(panel([("a", 2000, False), ("a", 2002, True)]))
        baseline = frame[frame["survey_year"] == 2000].iloc[0]

        # 2년 뒤에 떴으므로 3·5년 지평은 양성이다.
        assert label_of(baseline, "dm", 3) is True
        assert label_of(baseline, "dm", 5) is True

    def test_diagnosis_after_the_horizon_is_not_counted_early(self) -> None:
        """4년째 떴다면 **1년 지평은 양성이 아니다.** 그런데 음성도 아니다 —
        1년 시점의 관측이 없어서 그 사이에 들었는지 모른다."""
        frame = add_incidence_labels(panel([("a", 2000, False), ("a", 2004, True)]))
        baseline = frame[frame["survey_year"] == 2000].iloc[0]

        assert label_of(baseline, "dm", 1) is None
        assert label_of(baseline, "dm", 5) is True

    def test_later_clear_observation_confirms_a_negative_across_a_gap(self) -> None:
        """**이 테스트가 이 파일의 핵심이다.** 파동이 2000·2006 뿐이어도 2006년에
        "아직 못 들었다" 면 3년 지평도 음성이 확정된다. 이걸 NA 로 두면 쓸 수 있는
        음성을 버리게 되고, 반대로 관측 없이 0 으로 두면 발병률이 내려간다."""
        frame = add_incidence_labels(panel([("a", 2000, False), ("a", 2006, False)]))
        baseline = frame[frame["survey_year"] == 2000].iloc[0]

        assert label_of(baseline, "dm", 1) is False
        assert label_of(baseline, "dm", 3) is False
        assert label_of(baseline, "dm", 5) is False

    def test_short_followup_is_unknown_not_negative(self) -> None:
        """추적이 2년뿐인 사람의 5년 라벨은 **모른다**. 0 이 아니다."""
        frame = add_incidence_labels(panel([("a", 2000, False), ("a", 2002, False)]))
        baseline = frame[frame["survey_year"] == 2000].iloc[0]

        assert label_of(baseline, "dm", 1) is False
        assert label_of(baseline, "dm", 3) is None
        assert label_of(baseline, "dm", 5) is None

    def test_already_diagnosed_is_not_at_risk(self) -> None:
        frame = add_incidence_labels(panel([("a", 2000, True), ("a", 2006, True)]))
        baseline = frame[frame["survey_year"] == 2000].iloc[0]

        for horizon in (1, 3, 5):
            assert label_of(baseline, "dm", horizon) is None
        assert pd.isna(baseline["label_dm_incident"])

    def test_single_wave_subject_has_no_labels(self) -> None:
        frame = add_incidence_labels(panel([("a", 2000, False)]))
        baseline = frame.iloc[0]

        for horizon in (1, 3, 5):
            assert label_of(baseline, "dm", horizon) is None

    def test_contradictory_self_report_resolves_positive(self) -> None:
        """2년째 "들었다" → 6년째 "못 들었다". 자가보고는 이렇게 어긋날 수 있고,
        발병 라벨에서는 양성으로 둔다(`add_incidence_labels` 독스트링)."""
        frame = add_incidence_labels(panel([("a", 2000, False), ("a", 2002, True), ("a", 2006, False)]))
        baseline = frame[frame["survey_year"] == 2000].iloc[0]

        assert label_of(baseline, "dm", 3) is True


class TestWaveSpacing:
    @pytest.mark.parametrize(("spacing", "expected_empty"), [(6, (1, 3)), (2, (1,)), (1, ())])
    def test_horizons_finer_than_the_wave_spacing_produce_no_positives(
        self, spacing: int, expected_empty: tuple[int, ...]
    ) -> None:
        """**파동 간격이 지평보다 넓으면 그 지평에는 양성이 없다.**

        6년 간격(Framingham)은 1·3년을, 2년 간격(HRS·KLoSA)은 1년을 못 만든다.
        1년 간격(한국의료패널)만 셋을 다 만든다. 데이터 확보 순서를 정하는 사실이라
        코드가 아니라 여기 테스트에 남긴다.
        """
        rows: list[tuple[str, int, bool | None]] = []
        for index in range(40):
            person = f"p{index}"
            rows.append((person, 2000, False))
            # 절반은 다음 파동에서 진단을 받는다.
            rows.append((person, 2000 + spacing, index % 2 == 0))
        frame = add_incidence_labels(panel(rows))
        baseline = frame[frame["survey_year"] == 2000]

        for horizon in (1, 3, 5):
            positives = int(baseline[incidence_label("dm", horizon)].eq(True).sum())
            if horizon in expected_empty:
                assert positives == 0, f"{spacing}년 간격에서 {horizon}년 양성이 나왔다"
            elif horizon >= spacing:
                assert positives > 0, f"{spacing}년 간격인데 {horizon}년 양성이 없다"


class TestPersonSplit:
    """패널 분할은 **사람** 단위여야 한다 — `modeling/splits.py`.

    주기로 자르면 같은 사람이 학습과 홀드아웃 양쪽에 앉고, 모델이 그 사람을 외운 것을
    일반화로 착각한다. 지표만 보면 좋아 보여서 안 잡힌다.
    """

    def test_a_person_never_lands_on_both_sides(self) -> None:
        frame = pd.DataFrame({"subject_id": [f"p{i // 3}" for i in range(90)], "survey_year": [2000, 2001, 2002] * 30})
        split = make_person_split(frame["subject_id"])

        train = set(frame.loc[split.train_index, "subject_id"])
        holdout = set(frame.loc[split.holdout_index, "subject_id"])
        assert train & holdout == set()
        assert split.train_people + split.holdout_people == 30

    def test_the_same_person_keeps_its_side_when_waves_are_added(self) -> None:
        """새 파동이 들어와도 홀드아웃 구성이 안 흔들려야 전후 성능을 견줄 수 있다.
        해시로 자르는 이유가 이것이다."""
        people = [f"p{i}" for i in range(60)]
        first = pd.DataFrame({"subject_id": people})
        grown = pd.DataFrame({"subject_id": [*people, *people]})

        before = set(first.loc[make_person_split(first["subject_id"]).holdout_index, "subject_id"])
        after = set(grown.loc[make_person_split(grown["subject_id"]).holdout_index, "subject_id"])
        assert before == after

    def test_row_order_does_not_change_the_split(self) -> None:
        people = pd.Series([f"p{i}" for i in range(60)])
        forward = set(people[make_person_split(people).holdout_index])
        shuffled = people.sample(frac=1.0, random_state=7).reset_index(drop=True)
        backward = set(shuffled[make_person_split(shuffled).holdout_index])

        assert forward == backward

    def test_an_empty_side_is_refused(self) -> None:
        """빈 홀드아웃은 조용히 '전부 학습' 이 된다. 예외로 막는다."""
        with pytest.raises(ValueError):
            make_person_split(pd.Series(["a", "b"]), holdout_fraction=1e-9)


class TestSchemaRegistration:
    def test_every_horizon_label_is_in_the_canonical_list(self) -> None:
        """`conform()` 은 `LABELS` 밖의 칸을 **조용히 떨어뜨린다.** 이름을 만드는
        함수와 목록이 갈리면 학습은 "칸이 없다" 가 아니라 "전부 결측" 을 보게 된다."""
        frame = add_incidence_labels(panel([("a", 2000, False), ("a", 2006, True)]))
        produced = {column for column in frame.columns if column.startswith("label_")}

        assert produced <= set(LABELS), f"목록에 없는 라벨: {sorted(produced - set(LABELS))}"

    def test_missing_diagnosis_column_yields_all_missing(self) -> None:
        """진단 칸이 없는 자료(NHANES 단면 등)에서도 예외 없이 결측으로 채운다."""
        frame = add_incidence_labels(pd.DataFrame({"subject_id": ["a"], "survey_year": [2000]}))

        assert frame[incidence_label("stroke", 5)].isna().all()
