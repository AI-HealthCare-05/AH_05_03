"""합병증 전망이 지켜야 하는 것.

이 표는 **판정 뒤에 붙는 사전**이다. 계산이 없으니 회귀가 날 자리도 적어 보이지만,
조용히 틀릴 수 있는 곳이 셋 있다.

    이름   사전이 질환 이름을 따로 들면 `SPECS` 와 두 벌이 된다. `ckd` 가
           "만성콩팥병"/"신기능 확인 필요" 로 갈렸던 것이 그 꼴이었다.
    등급   `NORMAL` 에 합병증을 띄우면 바로 위에서 낸 "기준 안에 있어요" 를
           스스로 뒤집는다. `INSUFFICIENT_DATA` 는 아직 아무 답도 못 한 칸이다.
    인과   중재시험이 실패한 고리(낮은 HDL·요산→신기능·CRP)를 "이것 때문에 저렇게
           된다" 로 쓰면 안 된다. 이 저장소가 매트릭스 쪽에서 이미 정한 규칙이다.

셋 다 사람 눈으로는 통과하고 화면에서만 드러난다. 여기서 고정한다.
"""

from __future__ import annotations

import pytest

from app.services.assessment import SPECS
from app.services.disease_complications import CATALOG, outlook_for, outlooks_for


class _Verdict:
    """`outlooks_for` 가 읽는 것만 흉내 낸다 — 키·이름·등급 셋."""

    def __init__(self, key: str, name: str, risk_level: str) -> None:
        self.key = key
        self.name = name
        self.risk_level = risk_level


def test_catalog_keys_are_all_real_diseases() -> None:
    """사전의 키는 전부 `SPECS` 에 있어야 한다.

    없는 키를 적어 두면 아무 판정에도 안 붙어서 **조용히 죽는다.** 오타 하나로
    비만 카드가 통째로 사라져도 테스트도 화면도 아무 말을 안 한다.
    """
    known = {spec.key for spec in SPECS}
    assert set(CATALOG) <= known, f"SPECS 에 없는 키: {sorted(set(CATALOG) - known)}"


def test_every_disease_has_an_outlook() -> None:
    """판정 열넷 전부에 할 말이 있어야 한다.

    빠진 칸이 있으면 그 질환만 "높음" 판정을 받고도 다음 장이 안 열린다. 사용자
    입장에서는 화면이 덜 만들어진 것으로 읽힌다.
    """
    missing = [spec.key for spec in SPECS if spec.key not in CATALOG]
    assert not missing, f"전망이 없는 질환: {missing}"


@pytest.mark.parametrize("level", ["CAUTION", "HIGH", "VERY_HIGH"])
def test_flagged_levels_get_a_card(level: str) -> None:
    entry = outlook_for("obesity", level)
    assert entry is not None
    assert entry["risk_level"] == level
    assert entry["lead"], "첫 줄이 비면 카드가 등급 없이 시작한다"


@pytest.mark.parametrize("level", ["NORMAL", "INSUFFICIENT_DATA"])
def test_settled_levels_get_nothing(level: str) -> None:
    """기준 안에 있거나 못 본 칸에는 합병증을 띄우지 않는다."""
    assert outlook_for("obesity", level) is None


def test_lead_differs_between_crossed_and_borderline() -> None:
    """넘은 것과 경계에 있는 것은 같은 문장으로 말할 수 없다."""
    crossed = outlook_for("mets", "VERY_HIGH")
    borderline = outlook_for("mets", "CAUTION")
    assert crossed is not None and borderline is not None
    assert crossed["lead"] != borderline["lead"]


def test_every_complication_carries_size_and_source() -> None:
    """크기 없는 합병증 목록은 겁주기이고, 출처 없는 크기는 검증할 수 없다."""
    for key, outlook in CATALOG.items():
        for complication in outlook.complications:
            assert complication.effect.strip(), f"{key}/{complication.label}: 크기 없음"
            assert complication.source.strip(), f"{key}/{complication.label}: 출처 없음"
            assert complication.organ.strip(), f"{key}/{complication.label}: 장기 없음"


def test_empty_lists_explain_themselves() -> None:
    """합병증 목록을 비우려면 왜 비웠는지를 적어야 한다.

    빈 카드는 "아직 안 채운 화면" 으로 읽힌다. 낮은 HDL 이 유일하게 여기 해당하고,
    비운 이유가 곧 이 서비스가 연관과 인과를 어떻게 다루는지의 예시다.
    """
    for key, outlook in CATALOG.items():
        if not outlook.complications:
            assert outlook.caveat, f"{key}: 목록도 비고 설명도 없다"


def test_low_hdl_is_not_framed_as_a_cause() -> None:
    """낮은 HDL 에 합병증 목록을 달지 않는다.

    HDL 을 올리는 약이 심근경색을 줄이지 못했고(나이아신·CETP 억제제), 이 저장소의
    NHANES 사망 연계에서도 낮은 HDL 단독으로는 장기 사망을 못 갈랐다(C=0.506).
    `disease_risk_matrix` 가 같은 고리를 `causal=False` 로 적고 있어 여기서 뒤집으면
    한 화면이 두 말을 한다.
    """
    entry = outlook_for("low_hdl", "HIGH")
    assert entry is not None
    assert entry["complications"] == []
    assert "Harrell" in (entry["caveat"] or ""), "실측 근거를 지우면 주장만 남는다"


def test_failed_trials_are_marked_as_markers_not_causes() -> None:
    """중재시험이 실패한 고리는 `causal=False` 로 남는다.

    요산→신기능(CKD-FIX·PERL)과 CRP→관상동맥질환(멘델 무작위화)이 그것이다.
    """
    uric = CATALOG["uric_acid"]
    kidney = next(c for c in uric.complications if "콩팥" in c.label)
    assert kidney.causal is False

    crp = CATALOG["inflammation"]
    assert all(c.causal is not True for c in crp.complications if "관상동맥" in c.label)


def test_name_comes_from_the_verdict_not_the_catalog() -> None:
    """이름의 정본은 판정 하나다.

    `SPECS` 가 `ckd` 를 "신기능 확인 필요" 로 부르는 데에는 이유가 있다 — KDIGO 가
    3개월 지속을 요구해서 단면 1회 측정으로는 만성콩팥병이라 부를 수 없다. 사전이
    이름을 따로 들면 그 계약이 한쪽에서만 지켜진다.
    """
    verdicts = [_Verdict("ckd", "신기능 확인 필요", "HIGH")]
    assert outlooks_for(verdicts)[0]["name"] == "신기능 확인 필요"


def test_sorted_by_urgency_and_stable_within_a_level() -> None:
    """급한 순으로 정렬하되, 같은 등급 안에서는 판정이 온 차례를 그대로 둔다.

    그 차례가 `SPECS` 순서이고 바로 위 판정 축과 같아서, 사용자가 두 목록을 눈으로
    맞춰 읽을 수 있다.
    """
    verdicts = [
        _Verdict("dm", "당뇨병", "CAUTION"),
        _Verdict("htn", "고혈압", "VERY_HIGH"),
        _Verdict("obesity", "비만", "CAUTION"),
        _Verdict("liver", "간기능", "NORMAL"),
        _Verdict("mets", "대사증후군", "HIGH"),
    ]
    assert [e["key"] for e in outlooks_for(verdicts)] == ["htn", "mets", "dm", "obesity"]


def test_unknown_key_is_skipped_not_crashed() -> None:
    """사전에 없는 질환이 판정에 생겨도 화면이 죽지 않는다.

    `SPECS` 에 칸을 더하는 것과 여기에 글을 쓰는 것은 다른 사람이 다른 날 한다.
    """
    assert outlooks_for([_Verdict("new_disease", "새 질환", "HIGH")]) == []
