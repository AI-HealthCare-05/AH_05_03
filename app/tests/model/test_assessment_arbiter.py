"""엔진 중재 계약 — 검사값을 넣으면 답하는 엔진이 실제로 바뀌는가.

무엇을 고정하려는 테스트인가
----------------------------
ADR-009 가 "검사값을 넣었을 때 결과가 실제로 바뀌는 계약을 골든 픽스처로 고정할 수
있다"를 채택 이유의 하나로 들었다. 그 픽스처가 여기다.

중재 규칙은 지금까지 **글로만** 존재했다. `risk.py` 의 `judge()` 독스트링이 세 단계
우선순위를 문장으로 다 적어 두었지만 실행하는 코드가 없었고, 실제 판단은 데모 화면의
클라이언트 JS 가 했다. 문서에만 있는 규칙은 조용히 어긋난다 — 아무도 어긋난 걸 모른다.

이 파일이 잡으려는 회귀는 다섯이다.

1. 측정값이 있는데 ML 확률이 정본으로 남는 것 (가장 비싼 오류)
2. 엔진이 다르면 등급 체계도 달라지는 것 ("주의"가 카드마다 다른 뜻이 되는 것)
3. ML 이 측정과 같은 최고 등급을 내는 것
4. 밀려난 값을 지워서 화면이 근거를 잃는 것
5. ML 번들에 있는 질환이 중재 표에서 누락돼 카드가 통째로 사라지는 것

대부분 `arbitrate()` 가 순수 함수라 번들 없이 돈다. 번들이 필요한 것만 skip 을 건다.
"""

from typing import Any

import pytest

from app.dtos.assessment_summary import AssessmentSummaryRequest
from app.services.assessment import (
    INSUFFICIENT,
    SPECS,
    arbitrate,
    assess,
    grade_from_judgement,
    grade_from_medical,
    grade_from_percentile,
    level_str,
    summarize,
)
from app.services.prediction import DISPLAY_ORDER
from app.services.suspects import KNOWN_LEVELS
from chronic_disease_engine.schemas import RiskLevel

LEVELS = {level.value for level in RiskLevel}

# 필수 5개만. 검사값이 하나도 없는 상태를 만든다.
#
# `dict[str, Any]` 로 못 박는 이유는 `**BASE` 로 풀 때다. 주석을 안 달면 mypy 가
# `dict[str, object]` 로 추론하고, `object` 는 `Literal["M", "F"]` 같은 좁은 타입에
# 못 들어가서 필드마다 `arg-type` 오류가 난다. `prediction_apis` 쪽도 같은 이유로
# 같은 주석을 달고 있다.
BASE: dict[str, Any] = {"age": 54, "sex": "M", "height_cm": 173.0, "weight_kg": 78.0, "self_rated_health": 3}

# 같은 사람에게 검진결과지 한 장을 얹는다. 모든 값이 기준을 넘도록 골랐다 —
# 엔진이 바뀌는지를 보려는 것이지 정상값 판정을 보려는 게 아니다.
LABS: dict[str, Any] = {
    **BASE,
    "sbp": 148.0,
    "dbp": 94.0,
    "waist_cm": 95.0,
    "fasting_glucose": 118.0,
    "hba1c": 6.1,
    "total_chol": 245.0,
    "hdl": 38.0,
    "ldl": 160.0,
    "triglyceride": 210.0,
    "creatinine": 1.1,
    "urine_acr": 45.0,
    "ast": 42.0,
    "alt": 55.0,
    "ggt": 90.0,
    "uric_acid": 7.6,
    "hemoglobin": 12.1,
}


def _domain(risk: str, **extra: Any) -> dict[str, Any]:
    return {
        "category": "x",
        "risk_level": risk,
        "sub_status": "s",
        "display_label": "l",
        "reason": "r",
        "input_values": {},
        "criteria_reference": "c",
        "recommendation": "rec",
        "flags": [],
        "missing_fields": [],
        "disclaimer": "d",
        **extra,
    }


def _condition(**extra: Any) -> dict[str, Any]:
    return {
        "target": "t",
        "probability": 0.4,
        "peer_percentile": 55.0,
        "peer_group": "50대 남성",
        "medical": {"level": "낮음", "rate": 0.12, "basis": "진단 기준 충족"},
        "model_auroc": 0.8,
        "tier": "basic",
        "judgement": None,
        "threshold_source": "학회",
        **extra,
    }


def _by_key(verdicts: list[Any]) -> dict[str, Any]:
    return {v.key: v for v in verdicts}


# ---------------------------------------------------------------------------
# 1. 우선순위 — 순수 함수라 번들이 없어도 돈다
# ---------------------------------------------------------------------------


def test_rule_wins_when_it_has_an_answer() -> None:
    """규칙이 답하면 ML 확률은 정본이 아니다."""
    verdicts = _by_key(arbitrate({"hypertension": _domain("HIGH")}, {"htn": _condition()}))
    assert verdicts["htn"].engine == "E1"
    assert verdicts["htn"].risk_level == "HIGH"
    assert verdicts["htn"].superseded_by == "E1"


def test_ml_answers_only_when_rule_is_silent() -> None:
    """규칙이 INSUFFICIENT_DATA 면 답하지 않은 것으로 친다."""
    verdicts = _by_key(arbitrate({"hypertension": _domain(INSUFFICIENT)}, {"htn": _condition()}))
    assert verdicts["htn"].engine == "E2"
    # ML 이 정본이므로 밀려난 것이 없다.
    assert verdicts["htn"].superseded_by is None


def test_threshold_check_beats_probability_when_no_rule_domain() -> None:
    """규칙 엔진에 대응 영역이 없는 질환은 임계값 대조가 그 자리를 메운다."""
    judgement = {
        "met": True,
        "checked": [
            {"label": "총콜레스테롤", "unit": "mg/dL", "value": 245.0, "threshold": 240, "op": ">=", "met": True}
        ],
        "source": "한국지질동맥경화학회",
        "definition": "총콜레스테롤 240 이상",
    }
    verdicts = _by_key(arbitrate({}, {"hyperchol": _condition(judgement=judgement)}))
    assert verdicts["hyperchol"].engine == "E2"
    assert verdicts["hyperchol"].risk_level == "HIGH"
    # 확률이 아니라 대조가 정본이다.
    assert verdicts["hyperchol"].superseded_by == "E2"
    assert verdicts["hyperchol"].reference["probability"] == 0.4
    # **엔진은 E2 지만 측정이다.** 이걸 놓치면 의심 패널이 카드와 다른 말을 한다.
    assert verdicts["hyperchol"].measured is True


def test_measured_flag_separates_the_two_kinds_of_e2() -> None:
    """`E2` 안의 둘을 `measured` 가 가른다 — 대조는 측정, 확률은 아니다.

    엔진 코드로 갈랐을 때 실측 140 프로파일에서 카드와 패널이 서로 다른 말을 한
    경우가 12 건, 기준을 넘은 항목이 패널에서 자리채움에 밀린 경우가 25 건이었다.
    """
    judged = _by_key(
        arbitrate(
            {},
            {
                "low_hdl": _condition(
                    judgement={
                        "met": False,
                        "checked": [
                            {
                                "label": "HDL 콜레스테롤",
                                "unit": "mg/dL",
                                "value": 62.0,
                                "threshold": 40,
                                "op": "<",
                                "met": False,
                            }
                        ],
                        "source": "한국지질동맥경화학회",
                        "definition": "HDL 40 미만",
                    }
                )
            },
        )
    )
    assert judged["low_hdl"].engine == "E2"
    assert judged["low_hdl"].measured is True, "검사값을 대조했으면 기준 이내여도 측정이다"

    probability_only = _by_key(arbitrate({}, {"dm": _condition()}))
    assert probability_only["dm"].engine == "E2"
    assert probability_only["dm"].measured is False, "확률만으로 낸 판정은 측정이 아니다"


def test_known_targets_covers_threshold_judged_diseases() -> None:
    """`judge()` 가 기준 초과로 본 질환도 의심 후보에서 빠진다.

    예전에는 `known_targets` 가 규칙 엔진 **도메인**만 봐서, 대응 영역이 없는 지질
    하위유형 셋은 `HIGH` 여도 제외되지 않았다. 그런데 `MEASURED_WEIGHT` 에는 `HIGH`
    가 없어 순위 점수도 이를 못 받았고, 결국 조용히 ML 추정으로 떨어졌다.
    """
    from app.services.assessment import known_targets

    judgement = {
        "met": True,
        "checked": [{"label": "중성지방", "unit": "mg/dL", "value": 300.0, "threshold": 200, "op": ">=", "met": True}],
        "source": "한국지질동맥경화학회",
        "definition": "중성지방 200 이상",
    }
    verdicts = arbitrate({}, {"hypertg": _condition(judgement=judgement)})
    assert "hypertg" in known_targets(verdicts)

    # 확률만으로 높다고 한 것은 "아는 질환" 이 아니다 — 그건 의심이지 확진이 아니다.
    high_probability = _condition(medical={"level": "높음", "rate": 0.6, "basis": "진단 기준 충족"})
    assert known_targets(arbitrate({}, {"dm": high_probability})) == set()


def test_formula_owned_disease_does_not_fall_back_to_probability() -> None:
    """ADR-009 §4 — 대사증후군·신기능·지방간은 값이 없으면 확률로 대신하지 않는다."""
    verdicts = _by_key(
        arbitrate(
            {"kidney": _domain(INSUFFICIENT), "metabolic_syndrome": _domain(INSUFFICIENT)},
            {"ckd": _condition(), "mets": _condition()},
        )
    )
    for key in ("ckd", "mets"):
        assert verdicts[key].risk_level == INSUFFICIENT
        # 확률은 지우지 않는다. 판정에 쓰지 않을 뿐이다.
        assert verdicts[key].reference["probability"] == 0.4


def test_no_card_disappears() -> None:
    """아무도 답하지 못해도 칸은 남는다. '정보 부족'도 정보다."""
    verdicts = arbitrate({}, {})
    assert len(verdicts) == len(SPECS)
    assert all(v.risk_level == INSUFFICIENT for v in verdicts)


# ---------------------------------------------------------------------------
# 2. 등급 통일 — ADR-009 §5
# ---------------------------------------------------------------------------


def test_every_level_is_one_of_the_five() -> None:
    """엔진이 셋이어도 등급 체계는 하나다."""
    verdicts = arbitrate(
        {"hypertension": _domain("VERY_HIGH"), "diabetes": _domain(INSUFFICIENT)},
        {"htn": _condition(), "dm": _condition(medical={"level": "높음", "rate": 0.8, "basis": "b"})},
    )
    assert {v.risk_level for v in verdicts} <= LEVELS


@pytest.mark.parametrize("medical_level", ["낮음", "관심", "주의", "높음"])
def test_ml_never_reaches_the_top_grade(medical_level: str) -> None:
    """측정하지 않은 추정에 측정과 같은 배지를 주지 않는다."""
    level, _ = grade_from_medical({"level": medical_level, "rate": 0.9, "basis": "b"}, 99.0)
    assert level != "VERY_HIGH"
    assert level in LEVELS


def test_threshold_judgement_maps_to_high_not_very_high() -> None:
    """단일 임계값 통과는 1기·2기를 가르지 못한다. 상한이 HIGH 다."""
    assert grade_from_judgement({"met": True}) == "HIGH"
    assert grade_from_judgement({"met": False}) == "NORMAL"


def test_both_grade_mappings_are_swappable() -> None:
    """ADR-009 §5 원문 사상도 살아 있어야 한다 — 팀이 뒤집을 수 있는 결정이다."""
    medical = {"level": "낮음", "rate": 0.1, "basis": "b"}
    assert grade_from_medical(medical, 95.0)[0] == "NORMAL"
    # 같은 입력인데 백분위로 보면 HIGH 다. 두 사상이 실제로 다른 답을 낸다는 사실
    # 자체가 이 결정이 결정이라는 증거다.
    assert grade_from_percentile(medical, 95.0)[0] == "HIGH"
    assert grade_from_percentile(medical, None)[0] == INSUFFICIENT


def test_level_str_folds_the_vendor_enum() -> None:
    """벤더 엔진은 enum 을, lab_staging 은 문자열을 낸다. 경계에서 접는다."""
    assert level_str(RiskLevel.HIGH) == "HIGH"
    assert level_str("HIGH") == "HIGH"
    # str(enum) 은 파이썬 3.11 에서 "RiskLevel.HIGH" 다. 그걸 막는 것이 이 함수다.
    assert "RiskLevel" not in level_str(RiskLevel.HIGH)


# ---------------------------------------------------------------------------
# 3. 표 자체의 무결성
# ---------------------------------------------------------------------------


def test_every_ml_bundle_has_a_seat() -> None:
    """번들에 있는 질환이 중재 표에 없으면 카드가 통째로 사라진다."""
    seated = {spec.ml_target for spec in SPECS if spec.ml_target}
    assert set(DISPLAY_ORDER) <= seated, f"중재 표에 자리 없는 번들: {set(DISPLAY_ORDER) - seated}"


def test_disease_keys_are_unique() -> None:
    keys = [spec.key for spec in SPECS]
    assert len(keys) == len(set(keys))


def test_summary_does_not_invent_a_total_score() -> None:
    """벤더 엔진이 '영역을 하나의 종합 점수로 합치지 않는다'를 설계 원칙으로 못 박았다."""
    summary = summarize(arbitrate({"hypertension": _domain("HIGH")}, {}))
    assert "score" not in summary
    assert summary["highest_level"] == "HIGH"
    assert summary["needs_attention"] == ["htn"]


# ---------------------------------------------------------------------------
# 4. 입력 어댑터 — 두 엔진이 같은 값을 다른 이름으로 받는다
# ---------------------------------------------------------------------------


def test_rule_profile_renames_without_losing_values() -> None:
    request = AssessmentSummaryRequest(**LABS)
    profile = request.to_rule_profile()
    assert profile["systolic_bp"] == 148.0
    assert profile["total_cholesterol"] == 245.0
    assert profile["hdl_c"] == 38.0
    assert profile["triglycerides"] == 210.0
    # ML 전용 값은 규칙 쪽으로 넘기지 않는다.
    assert "self_rated_health" not in profile
    # 이름이 같은 값은 그대로 간다.
    assert profile["hemoglobin"] == 12.1


def test_prediction_request_roundtrip_survives_revalidation() -> None:
    """계산 필드 `bmi` 가 딸려 나가면 부모가 `extra="forbid"` 로 거부한다.

    큐 경로에서 이미 한 번 겪은 실패다 (docs/35 §8). 같은 함정이 여기에도 있다.
    """
    request = AssessmentSummaryRequest(**LABS)
    ml = request.to_prediction_request()
    assert ml.sbp == 148.0
    assert ml.bmi == request.bmi
    assert ml.labs_provided > 0
    # 규칙 전용 필드가 ML 쪽으로 새지 않는다.
    assert not hasattr(ml, "has_diabetes")


def test_smoking_former_is_not_counted_as_current() -> None:
    """규칙 엔진의 `smoking` 은 현재 흡연 여부를 묻는다."""
    assert AssessmentSummaryRequest(**BASE, smoking_status="former").to_rule_profile()["smoking"] is False
    assert AssessmentSummaryRequest(**BASE, smoking_status="current").to_rule_profile()["smoking"] is True


# ---------------------------------------------------------------------------
# 5. 실제 엔진으로 끝까지 — 번들이 있을 때만
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def models() -> Any:
    from app.services.risk import registry

    registry.refresh()
    if not registry.available:
        pytest.skip("모델 번들이 없다. modeling/artifacts/models_ensemble/ 확인")
    return registry


def _assess(payload: dict[str, Any], models: Any) -> dict[str, Any]:
    from app.services.assessment import assess

    verdicts, _, _, _, _ = assess(AssessmentSummaryRequest(**payload), models)
    return _by_key(verdicts)


def _assess_full(payload: dict[str, Any], models: Any) -> tuple[Any, ...]:
    from app.services.assessment import assess

    return assess(AssessmentSummaryRequest(**payload), models)


def test_labs_actually_change_who_answers(models: Any) -> None:
    """이 파일의 본론. 같은 사람, 검진결과지 한 장 차이."""
    without = _assess(BASE, models)
    with_labs = _assess(LABS, models)

    # 검사값이 없으면 ML 이 답한다.
    assert without["htn"].engine == "E2"
    assert without["dm"].engine == "E2"
    # 넣으면 규칙으로 넘어간다.
    assert with_labs["htn"].engine == "E1"
    assert with_labs["dm"].engine == "E1"

    # 판정된 칸이 늘어난다. ADR-009 가 약속한 "0개면 4칸, 다 넣으면 7개 영역"의
    # 실제 값이 여기서 고정된다.
    answered_before = sum(1 for v in without.values() if v.risk_level != INSUFFICIENT)
    answered_after = sum(1 for v in with_labs.values() if v.risk_level != INSUFFICIENT)
    assert answered_after > answered_before


def test_anemia_no_longer_reassures_when_hemoglobin_is_low(models: Any) -> None:
    """`judge()` 독스트링이 예고한 바로 그 오류를 막는다.

        사용자가 혈색소 10.6 을 입력하면 답은 이미 나와 있는데, 빈혈 모델은 그 값을
        볼 수 없으므로 초록색 "낮음"을 띄운다. **답을 확정하는 값을 넣었는데 화면이
        안심시키는 것**이고, 이건 선별 제품에서 가장 비싼 종류의 오류다.

    남성 혈색소 12.1 은 WHO 기준(13.0) 미만이다. ML 확률은 이 값을 보지 못한다 —
    라벨 누출 차단이라 정당하고 바꾸지 않는다. 대신 중재가 정본을 옮긴다.
    """
    verdict = _assess(LABS, models)["anemia"]
    assert verdict.engine == "E1"
    assert verdict.risk_level == "CAUTION"
    assert verdict.superseded_by == "E1"
    # 밀려난 확률은 남아 있고, 그 값이 실제로 안심시키는 값이었다는 사실이 보인다.
    assert verdict.reference["medical_level"] == "낮음"


def test_metabolic_syndrome_counts_five_components(models: Any) -> None:
    """LABS 는 5요소를 전부 넘는다 — 허리 95 · TG 210 · HDL 38 · 혈압 148/94 · FPG 118."""
    verdict = _assess(LABS, models)["mets"]
    assert verdict.engine == "E3"
    assert verdict.risk_level == "VERY_HIGH"
    assert verdict.input_values["met_count"] == 5


def test_matrix_axis_carries_cardiovascular_disease(models: Any) -> None:
    """심혈관질환은 열세 칸에 없다. 매트릭스 축을 빼면 통째로 사라진다.

    규칙 엔진에도 ML 번들에도 심혈관 타깃이 없다. 그래서 `verdicts` 에는 자리가 없고
    `disease_risks` 만 낸다. 만성질환 서비스에서 이 축이 빠지면 설명이 안 된다.
    """
    verdicts, disease_risks, summary, _, _ = _assess_full(LABS, models)

    assert "cvd" not in {v.key for v in verdicts}
    assert "cvd_risk" in disease_risks
    assert disease_risks["cvd_risk"]["category"]
    assert level_str(disease_risks["cvd_risk"]["risk_level"]) in LEVELS
    # 두 축을 한 목록에 섞지 않는다.
    assert "matrix_needs_attention" in summary
    assert summary["matrix_total"] == len(disease_risks)


def test_matrix_contributors_carry_evidence(models: Any) -> None:
    """`contributors` 가 효과크기·출처·인과 여부를 싣는다. 이게 이 축의 값이다."""
    _, disease_risks, _, _, _ = _assess_full(LABS, models)

    contributors = [c for result in disease_risks.values() for c in result.get("contributors", [])]
    assert contributors, "LABS 는 여러 신호를 넘기므로 기여 항목이 있어야 한다"
    for item in contributors:
        assert item["source"], "출처 없는 기여는 검증할 수 없다"
        assert item["effect"], "효과크기 없는 기여는 크기를 모른다"
        assert 1 <= item["weight"] <= 3
        # `causal` 은 세 값이다 — True / False(따져보니 인과 아님) / None(안 따져봄).
        assert item["causal"] in (True, False, None)


def test_two_axes_are_not_merged(models: Any) -> None:
    """같은 질환이 양쪽에 나올 수 있고 뜻이 다르다. 합치면 같은 재료를 두 번 센다."""
    verdicts, disease_risks, summary, _, _ = _assess_full(LABS, models)

    # 당뇨는 양쪽에 다 있다.
    assert "dm" in {v.key for v in verdicts}
    assert "dm_risk" in disease_risks
    # 그런데 요약의 두 목록은 서로 섞이지 않는다.
    assert not set(summary["needs_attention"]) & set(summary["matrix_needs_attention"])


def test_reference_carries_accuracy_and_anchor(models: Any) -> None:
    """AUROC 한 숫자만 남기면 화면이 그것을 '정확도'로 읽는다.

    사용자가 실제로 겪는 값은 경보 적중률·발견율이고 `ModelAccuracy` 가 담아 온다.
    """
    verdicts = _assess(BASE, models)
    ml_owned = [v for v in verdicts.values() if v.engine == "E2" and v.reference.get("probability") is not None]
    assert ml_owned, "검사값이 없으면 ML 이 답하므로 하나는 있어야 한다"

    accuracy = ml_owned[0].reference["accuracy"]
    assert accuracy is not None
    assert accuracy["headline_auroc"] > 0.5
    assert accuracy["grade"]
    assert accuracy["measured_on"] in ("미진단자", "전체")


def test_reference_carries_the_whole_medical_band(models: Any) -> None:
    """등급 문자열 하나가 아니라 묶음 전체를 싣는다.

    `medical_level` 만 내보내던 때가 있었다. 그것으로는 **게이지를 그릴 수 없고**
    "이 점수대 100명 중 몇 명" 도 못 쓴다 — 재료가 `rate`·`basis`·`baseline`·`lift`
    다. 예측 데모(`/api/demo`)는 그 값을 위해 `/predictions/risk` 를 따로 불렀는데,
    같은 입력을 두 번 보내면 두 답이 갈릴 수 있다. 데모를 판정 화면에 합치면서
    왕복을 하나로 두고 이 필드를 늘렸다.

    AGENTS.md 6번("DTO 필드를 더하면 그 값이 결과를 바꿔야 한다")의 반대 방향도
    같이 본다 — `medical_level` 이 이 묶음의 `level` 과 **같은 값**이어야 한다.
    다르면 화면의 배지와 게이지가 서로 다른 말을 한다.
    """
    verdicts = _assess(BASE, models)
    scored = [v for v in verdicts.values() if v.reference.get("probability") is not None]
    assert scored, "검사값이 없어도 ML 카드는 나온다"

    for verdict in scored:
        medical = verdict.reference["medical"]
        assert medical is not None, f"{verdict.key}: 등급 묶음이 없으면 자세히 보기가 게이지를 못 그린다"
        assert 0.0 <= medical["rate"] <= 1.0
        assert medical["basis"], f"{verdict.key}: 비율이 무슨 기준인지 없으면 숫자를 읽을 수 없다"
        assert isinstance(medical["anchored_on_rule_engine"], bool)
        assert medical["level"] == verdict.reference["medical_level"], (
            f"{verdict.key}: 배지({verdict.reference['medical_level']})와 게이지({medical['level']})가 다르다"
        )


def test_top_factors_survive_but_are_marked(models: Any) -> None:
    """기여도를 지우지 않는다. 다만 개선 조언으로 쓰면 안 된다는 사실이 계약에 있다."""
    from app.dtos.assessment_summary import VerdictReference

    verdicts = _assess(BASE, models)
    ml_owned = [v for v in verdicts.values() if v.reference.get("top_factors")]
    assert ml_owned

    note = VerdictReference.model_fields["top_factors"].description or ""
    assert "그대로 쓰면 안 된다" in note


def test_partial_metabolic_count_can_still_confirm() -> None:
    """3개가 이미 해당이면 나머지를 몰라도 판정이 뒤집히지 않는다."""
    from app.services.lab_staging import evaluate_metabolic_syndrome

    confirmed = evaluate_metabolic_syndrome({"sex": "M", "waist_cm": 95, "triglycerides": 180, "hdl_c": 35})
    assert confirmed["risk_level"] == RiskLevel.HIGH.value
    assert confirmed["missing_fields"]  # 못 읽은 칸이 있는데도 판정이 섰다

    # 반대쪽. 3개가 비해당이면 남은 2개가 다 해당이어도 3개에 못 미친다.
    excluded = evaluate_metabolic_syndrome({"sex": "F", "waist_cm": 70, "triglycerides": 90, "hdl_c": 65})
    assert excluded["risk_level"] == RiskLevel.NORMAL.value

    # 어느 쪽도 아니면 세는 것까지만 하고 판정하지 않는다.
    partial = evaluate_metabolic_syndrome({"sex": "F", "waist_cm": 90, "triglycerides": 200})
    assert partial["risk_level"] == INSUFFICIENT
    assert partial["input_values"]["met_count"] == 2


def test_suspect_panel_shares_the_card_badge_and_name(models: Any) -> None:
    """의심 패널과 판정 카드가 **같은 등급·같은 이름**을 쓴다.

    실측(52세 남 · 118/74 · 이상지질 프리셋)에서 고혈압 하나가 카드에서 "정상",
    패널에서 "정상 범위" 로 나왔다. `SuspectCard.level` 은 순위 점수를 만든 재료라
    규칙 5단계와 의학 4단계(낮음·관심·주의·높음)가 섞여 들어오기 때문이다.

    이름도 같은 종류로 갈라져 있었다 — `ckd` 가 카드에서 "만성콩팥병", 패널에서
    번들 이름인 "신기능 확인 필요". 사용자가 두 이름을 다른 질환으로 읽었다.

    둘 다 `assess()` 가 표시 직전에 `SPECS` 로 덮어서 닫는다.
    """
    request = AssessmentSummaryRequest.model_validate(
        {
            "age": 52,
            "sex": "M",
            "height_cm": 172,
            "weight_kg": 70,
            "waist_cm": 84,
            "self_rated_health": 3,
            "sbp": 118,
            "dbp": 74,
            "fasting_glucose": 92,
            "hba1c": 5.3,
            "total_chol": 268,
            "ldl": 178,
            "hdl": 34,
            "triglyceride": 260,
            "creatinine": 0.9,
            "hemoglobin": 15.0,
        }
    )
    verdicts, _, _, _, suspects = assess(request, models)
    assert suspects, "검사값이 있으면 의심 후보가 나온다"

    by_key = {verdict.key: verdict for verdict in verdicts}
    for card in suspects:
        verdict = by_key[card.target]
        assert card.risk_level == verdict.risk_level, (
            f"{card.target}: 패널 배지({card.risk_level})와 카드 배지({verdict.risk_level})가 다르다"
        )
        assert card.name == verdict.name, f"{card.target}: 패널 이름({card.name})과 카드 이름({verdict.name})이 다르다"


def test_confirmed_disease_does_not_come_back_as_a_suspect(models: Any) -> None:
    """이미 기준을 넘은 질환은 "의심" 자리에 올리지 않는다.

    사용자가 이미 아는 것을 다시 띄우면 화면의 가장 좋은 자리를 버린다. `arbitrated`
    경로의 `KNOWN_LEVELS` 필터가 그 일을 하는데, 2026-09-04~09-07 사이에는
    `RANK_SOURCE = "ml_probability"` 라 그 필터가 같이 꺼져 있었다 —
    실측 120 프로필에서 확진이 패널에 21%(74/360) 들어왔다.
    """
    # 지질 넉 장이 기준을 크게 넘는다 → 이상지질·고LDL·고중성지방·낮은HDL 확진.
    request = AssessmentSummaryRequest.model_validate(
        {
            "age": 58,
            "sex": "M",
            "height_cm": 170,
            "weight_kg": 78,
            "self_rated_health": 3,
            "total_chol": 290,
            "ldl": 200,
            "hdl": 30,
            "triglyceride": 340,
        }
    )
    verdicts, _, _, _, suspects = assess(request, models)
    confirmed = {v.key for v in verdicts if v.measured and level_str(v.risk_level) in KNOWN_LEVELS}
    assert confirmed, "이 입력이면 확진이 나온다"

    picked = {card.target for card in suspects}
    assert not (picked & confirmed), f"확진이 의심 자리에 올라왔다: {sorted(picked & confirmed)}"
