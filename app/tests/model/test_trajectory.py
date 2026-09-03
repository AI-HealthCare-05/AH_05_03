"""발병 궤적(2단계) 계약.

무엇을 고정하려는가
------------------
1. **표 만들기가 문서와 같다.** δ=0 이면 위험을 누적한 것이 [p(a+t) − p(a)] / [1 − p(a)]
   와 정확히 같아야 한다. 유병률이 내려가는 구간은 위험 0 이지 음수가 아니다.
2. **개인 곡선.** p=m 이면 동년배 곡선과 같고, p>m 이면 위, p<m 이면 아래다.
   어떤 입력이든 0~1 안에서 지평에 따라 내려가지 않는다.
3. **δ 는 올린다.** 초과사망 보정을 넣으면 같은 유병률 곡선에서 위험이 커진다.
4. **80세 상한.** 지평이 상한을 넘으면 잘리고 `truncated_at_age` 가 붙는다.
5. **관문 순서.** 궤적을 못 내는 질환 → 파일 없음 → 이미 기준 초과 → 나이 → 의심 여부.
6. **서빙 통합.** 실제 번들로 카드를 만들면 당뇨·고혈압·신기능에만 궤적이 붙고,
   지질 카드는 `not_applicable`, 검사값이 기준을 넘으면 `already_met` 이다.
7. **중재.** 규칙 엔진이 이미 HIGH 로 판정한 카드에서는 궤적이 지워지고 이유가 남는다.

DB 를 붙이지 않는다. 번들이 필요한 것만 skip 을 건다.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest

from app.dtos.predictions import RiskPredictionRequest
from app.services import trajectory as tj
from app.services.assessment import arbitrate
from app.services.risk import REPO_MODEL_DIR, RiskModelRegistry
from app.services.trajectory import (
    AGE_CAP,
    AGE_FLOOR,
    HORIZONS,
    TRAJECTORY_FILE,
    TRAJECTORY_TARGETS,
    TrajectoryConfig,
    baseline_from_prevalence,
    excess_rate,
    gate,
    project,
    relative_hazard,
)

BUNDLE_DIR = REPO_MODEL_DIR

BANDS = [
    {"age_from": 19, "age_to": 50, "per_year": 0.006},
    {"age_from": 50, "age_to": 65, "per_year": 0.010},
    {"age_from": 65, "age_to": 75, "per_year": 0.013},
    {"age_from": 75, "age_to": 200, "per_year": 0.018},
]

AGES = list(range(AGE_FLOOR, AGE_CAP + 1))


def _linear(age: float) -> float:
    """직선 유병률. 이동평균이 항등이라 수식을 정확히 검사할 수 있다."""
    return 0.02 + 0.008 * (age - AGE_FLOOR)


LINEAR = [_linear(a) for a in AGES]


def _direct(age: int, horizon: int) -> float:
    return (_linear(age + horizon) - _linear(age)) / (1.0 - _linear(age))


# ---------------------------------------------------------------------------
# 1. 표 만들기
# ---------------------------------------------------------------------------


def test_baseline_reproduces_direct_formula_without_correction() -> None:
    curve = baseline_from_prevalence(LINEAR, AGE_FLOOR)
    assert curve["age_from"] == AGE_FLOOR and curve["age_to"] == AGE_CAP
    assert len(curve["hazard"]) == len(curve["prevalence"]) - 1
    assert curve["mortality_corrected"] is False
    for age in (25, 45, 60):
        for horizon in HORIZONS:
            index = age - AGE_FLOOR
            cumulative = sum(curve["hazard"][index : index + horizon])
            assert 1.0 - math.exp(-cumulative) == pytest.approx(_direct(age, horizon), abs=1e-4), (age, horizon)


def test_baseline_never_negative_and_correction_raises() -> None:
    falling = [max(0.0, 0.4 - 0.01 * (a - 45)) for a in AGES]
    plain = baseline_from_prevalence(falling, AGE_FLOOR)
    assert all(h >= 0.0 for h in plain["hazard"])
    assert all(h == 0.0 for h in plain["hazard"]), "내려가는 구간은 위험 0 (하한도 0 에서 시작)"
    corrected = baseline_from_prevalence(falling, AGE_FLOOR, bands=BANDS)
    assert corrected["mortality_corrected"] is True
    assert all(b >= a for a, b in zip(plain["hazard"], corrected["hazard"], strict=True))
    assert sum(corrected["hazard"]) > sum(plain["hazard"])


def test_hazard_floor_holds_peak_after_forty() -> None:
    """유병률이 60세에서 평평해져도 위험은 50대 최댓값 아래로 내려가지 않는다."""
    plateau = [min(0.02 + 0.012 * (a - AGE_FLOOR), 0.5) for a in AGES]  # 59세쯤 0.5 에서 멈춘다
    floored = baseline_from_prevalence(plateau, AGE_FLOOR)
    raw = baseline_from_prevalence(plateau, AGE_FLOOR, hazard_floor_from_age=None)
    assert floored["hazard_floor_from_age"] == tj.HAZARD_FLOOR_FROM_AGE
    assert raw["hazard"][70 - AGE_FLOOR] == 0.0, "평평한 구간의 원 위험은 0"
    assert floored["hazard"][70 - AGE_FLOOR] == pytest.approx(max(raw["hazard"][40 - AGE_FLOOR : 60 - AGE_FLOOR]))
    tail = floored["hazard"][40 - AGE_FLOOR :]
    assert all(b >= a for a, b in zip(tail, tail[1:], strict=False))
    # 40세 전에는 손대지 않는다
    assert floored["hazard"][: 40 - AGE_FLOOR] == pytest.approx(raw["hazard"][: 40 - AGE_FLOOR])


def test_baseline_skips_missing_ages_and_stays_monotone() -> None:
    noisy: list[float | None] = [0.3 + 0.2 * math.sin(a) for a in AGES]
    noisy[10] = None
    noisy[11] = None
    curve = baseline_from_prevalence(noisy, AGE_FLOOR)
    values = curve["prevalence"]
    assert all(b >= a for a, b in zip(values, values[1:], strict=False))
    assert all(0.0 <= v < 1.0 for v in values)


# ---------------------------------------------------------------------------
# 2. 개인 곡선
# ---------------------------------------------------------------------------


def _baseline(bands: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    curve = baseline_from_prevalence(LINEAR, AGE_FLOOR, bands=bands or [])
    return {"M": curve, "F": curve}


def test_relative_hazard_definition() -> None:
    assert relative_hazard(0.2, 0.2) == pytest.approx(1.0)
    assert relative_hazard(0.5, 0.2) == pytest.approx(math.log(0.5) / math.log(0.8))
    assert relative_hazard(0.05, 0.2) < 1.0
    assert relative_hazard(0.0, 0.2) == 0.0
    assert relative_hazard(0.5, 0.0) == 1.0  # 기준이 0 이면 비교 불가
    assert relative_hazard(0.999999, 0.01) == tj.RELATIVE_HAZARD_CAP


def test_population_curve_when_probability_equals_reference() -> None:
    baseline = _baseline()
    reference = baseline["M"]["prevalence"][45 - AGE_FLOOR]
    curve = project(reference, 45, "M", baseline)
    assert curve is not None
    assert curve["relative_hazard"] == pytest.approx(1.0)
    assert curve["reference_prevalence"] == pytest.approx(reference, abs=1e-4)
    assert curve["onset_probability"] == curve["population_onset_probability"]
    for horizon, value in zip(curve["horizons_years"], curve["onset_probability"], strict=True):
        assert value == pytest.approx(_direct(45, horizon), abs=2e-4)


def test_personal_curve_sits_above_or_below_population() -> None:
    baseline = _baseline(BANDS)
    reference = baseline["F"]["prevalence"][52 - AGE_FLOOR]
    above = project(min(0.95, reference * 2.5), 52, "F", baseline)
    below = project(reference * 0.4, 52, "F", baseline)
    assert above is not None and below is not None
    for hi, pop, lo in zip(
        above["onset_probability"], above["population_onset_probability"], below["onset_probability"], strict=True
    ):
        assert hi > pop > lo
    assert above["mortality_corrected"] is True


@pytest.mark.parametrize("p_now", [0.0, 0.01, 0.2, 0.6, 0.99, 1.0])
@pytest.mark.parametrize("age", [19, 33, 50, 64, 75])
def test_projection_is_monotone_and_bounded(p_now: float, age: int) -> None:
    curve = project(p_now, age, "M", _baseline(BANDS))
    assert curve is not None
    values = curve["onset_probability"]
    assert all(0.0 <= v <= 1.0 for v in values)
    assert all(b >= a for a, b in zip(values, values[1:], strict=False))


def test_missing_sex_or_age_outside_table_gives_none() -> None:
    baseline = _baseline()
    assert project(0.3, 45, "X", baseline) is None
    assert project(0.3, 18, "M", baseline) is None
    assert project(0.3, 81, "M", baseline) is None
    assert project(0.3, 45, "M", {}) is None
    # 성별 표가 없고 `all` 만 있으면 그걸 쓴다
    assert project(0.3, 45, "X", {"all": baseline["M"]}) is not None


# ---------------------------------------------------------------------------
# 3. 상한
# ---------------------------------------------------------------------------


def test_horizons_truncate_at_age_cap() -> None:
    """지평이 5·10년이라 **75세가 마지막 경계**다.

    표가 80세에서 끝나므로 76세는 5년 뒤가 이미 자료 밖이고, 그때는 궤적을 내지
    않는다. 없는 자료를 외삽해 숫자를 만드는 것보다 "이 나이대는 낼 수 없다" 가 낫다.
    """
    baseline = _baseline()
    at_70 = project(0.3, 70, "M", baseline)
    assert at_70 is not None
    assert at_70["horizons_years"] == [5, 10]
    assert at_70["truncated_at_age"] is None

    at_75 = project(0.3, 75, "M", baseline)
    assert at_75 is not None
    assert at_75["horizons_years"] == [5], "75세는 5년만 자료 안에 든다"
    assert at_75["truncated_at_age"] == AGE_CAP

    assert project(0.3, 76, "M", baseline) is None, "76세는 5년 뒤가 이미 표 밖이다"


# ---------------------------------------------------------------------------
# 4. δ 조회와 파일
# ---------------------------------------------------------------------------


def test_excess_rate_lookup() -> None:
    assert excess_rate(BANDS, 30.0) == 0.006
    assert excess_rate(BANDS, 50.0) == 0.010  # 하한 포함
    assert excess_rate(BANDS, 64.9) == 0.010
    assert excess_rate(BANDS, 90.0) == 0.018  # 표 밖 → 마지막 구간
    assert excess_rate([], 40.0) == 0.0
    assert excess_rate([{"age_from": 19, "age_to": 200, "per_year": -0.01}], 40.0) == 0.0  # 음수는 0


def test_config_loads_and_missing_file_is_unavailable(tmp_path: Path) -> None:
    assert TrajectoryConfig.load(tmp_path).available is False
    assert TrajectoryConfig.load(None).available is False
    baseline = _baseline()
    (tmp_path / TRAJECTORY_FILE).write_text(
        json.dumps({"targets": {"dm": {"excess_mortality": BANDS, "baseline": baseline, "evidence": {"x": 1}}}}),
        encoding="utf-8",
    )
    config = TrajectoryConfig.load(tmp_path)
    assert config.available
    assert config.bands("dm") == BANDS
    assert config.baseline("dm")["M"]["hazard"] == baseline["M"]["hazard"]
    assert config.baseline("htn") == {}
    assert config.evidence("dm") == {"x": 1}
    assert config.evidence("htn") is None
    (tmp_path / TRAJECTORY_FILE).write_text("not json", encoding="utf-8")
    assert TrajectoryConfig.load(tmp_path).available is False


# ---------------------------------------------------------------------------
# 5. 관문
# ---------------------------------------------------------------------------


def _gate(target: str = "dm", **overrides: Any) -> str:
    config = overrides.pop("config", TrajectoryConfig({"targets": {"dm": {}, "htn": {}, "ckd": {}}}))
    params: dict[str, Any] = {
        "medical_level": "관심",
        "peer_percentile": 50.0,
        "judgement_met": False,
        "age": 45.0,
        "config": config,
    }
    params.update(overrides)
    return gate(target, **params)


def test_gate_order() -> None:
    assert _gate("dlp") == tj.STATUS_NOT_APPLICABLE
    assert _gate("anemia", medical_level="높음") == tj.STATUS_NOT_APPLICABLE
    assert _gate(config=None) == tj.STATUS_UNAVAILABLE
    assert _gate(config=TrajectoryConfig(None)) == tj.STATUS_UNAVAILABLE
    assert _gate(judgement_met=True, medical_level="높음") == tj.STATUS_ALREADY_MET
    assert _gate(age=76.0, medical_level="높음") == tj.STATUS_AGE_OUT_OF_RANGE
    assert _gate(age=75.0, medical_level="높음") == tj.STATUS_PROJECTED
    assert _gate(medical_level="낮음", peer_percentile=50.0) == tj.STATUS_BELOW_GATE
    assert _gate(medical_level="낮음", peer_percentile=70.0) == tj.STATUS_PROJECTED
    assert _gate(medical_level="낮음", peer_percentile=None) == tj.STATUS_BELOW_GATE
    for level in ("관심", "주의", "높음"):
        assert _gate(medical_level=level, peer_percentile=10.0) == tj.STATUS_PROJECTED


def test_every_trajectory_target_is_a_served_disease() -> None:
    from app.services.prediction import DISPLAY_ORDER

    assert set(TRAJECTORY_TARGETS) <= set(DISPLAY_ORDER)
    assert not set(TRAJECTORY_TARGETS) & set(tj.EXCLUDED_TARGETS)
    assert set(TRAJECTORY_TARGETS) | set(tj.EXCLUDED_TARGETS) == set(DISPLAY_ORDER)


# ---------------------------------------------------------------------------
# 6. 서빙 통합 — 실제 번들
# ---------------------------------------------------------------------------

SUSPECT: dict[str, Any] = {
    "age": 56,
    "sex": "M",
    "height_cm": 172.0,
    "weight_kg": 96.0,
    "self_rated_health": 4,
    "waist_cm": 108.0,
    "smoking_status": "current",
}


def _registry() -> RiskModelRegistry:
    if not BUNDLE_DIR.is_dir() or not list(BUNDLE_DIR.glob("risk_*.json")):
        pytest.skip(f"서빙 번들이 없다: {BUNDLE_DIR}")
    registry = RiskModelRegistry(BUNDLE_DIR)
    if not registry.trajectory.available:
        pytest.skip(f"{TRAJECTORY_FILE} 이 없다. `python modeling/fit_trajectory.py` 를 먼저 실행하라.")
    return registry


def test_served_table_covers_every_target_and_sex() -> None:
    registry = _registry()
    for key in TRAJECTORY_TARGETS:
        baseline = registry.trajectory.baseline(key)
        for sex in ("M", "F"):
            curve = baseline[sex]
            assert curve["age_from"] == AGE_FLOOR and curve["age_to"] == AGE_CAP
            assert len(curve["hazard"]) == AGE_CAP - AGE_FLOOR
            assert all(h >= 0.0 for h in curve["hazard"])
            assert curve["mortality_corrected"] is True
            # 표가 평평하면 궤적이 전부 0 이다 — 만들다 만 파일을 잡는다.
            assert sum(curve["hazard"][30 - AGE_FLOOR : 70 - AGE_FLOOR]) > 0.05, (key, sex)


def test_served_cards_carry_trajectory_only_where_it_applies() -> None:
    from app.services.prediction import build_prediction

    registry = _registry()
    data = build_prediction(RiskPredictionRequest(**SUSPECT), registry)
    by_target = {c.target: c for c in data.conditions}

    projected = [key for key in TRAJECTORY_TARGETS if by_target[key].trajectory_status == tj.STATUS_PROJECTED]
    assert projected, {k: by_target[k].trajectory_status for k in TRAJECTORY_TARGETS}
    for key in projected:
        card = by_target[key]
        assert card.trajectory is not None
        values = card.trajectory.onset_probability
        assert len(values) == len(card.trajectory.horizons_years) == len(HORIZONS)
        assert all(0.0 <= v <= 1.0 for v in values)
        assert all(b >= a for a, b in zip(values, values[1:], strict=False))
        assert values[-1] > values[0], f"{key}: 10년 확률이 1년과 같다 — 표가 평평하다"
        assert card.trajectory.mortality_corrected is True
        assert card.trajectory.caveats and card.trajectory.evidence
        # 의심 카드는 동년배보다 위에 있어야 말이 된다
        assert card.trajectory.relative_hazard >= 1.0
        assert values[-1] >= card.trajectory.population_onset_probability[-1]
    for key in tj.EXCLUDED_TARGETS:
        if key in by_target:
            assert by_target[key].trajectory is None
            assert by_target[key].trajectory_status == tj.STATUS_NOT_APPLICABLE


def test_labs_over_threshold_suppress_trajectory() -> None:
    from app.services.prediction import build_prediction

    registry = _registry()
    payload = RiskPredictionRequest(**SUSPECT, fasting_glucose=140.0, hba1c=7.1)
    data = build_prediction(payload, registry)
    dm = next(c for c in data.conditions if c.target == "dm")
    assert dm.judgement is not None and dm.judgement.met
    assert dm.trajectory is None
    assert dm.trajectory_status == tj.STATUS_ALREADY_MET


def test_low_risk_profile_stays_below_gate() -> None:
    from app.services.prediction import build_prediction

    registry = _registry()
    payload = RiskPredictionRequest(
        age=24, sex="F", height_cm=165.0, weight_kg=52.0, self_rated_health=1, waist_cm=66.0, smoking_status="never"
    )
    data = build_prediction(payload, registry)
    statuses = {c.target: c.trajectory_status for c in data.conditions if c.target in TRAJECTORY_TARGETS}
    assert set(statuses.values()) <= {tj.STATUS_BELOW_GATE, tj.STATUS_PROJECTED}
    assert tj.STATUS_BELOW_GATE in statuses.values(), statuses


def test_registry_reloads_trajectory_file(tmp_path: Path) -> None:
    if not BUNDLE_DIR.is_dir():
        pytest.skip("서빙 번들이 없다")
    source = next(iter(sorted(BUNDLE_DIR.glob("risk_dm*.json"))), None)
    if source is None:
        pytest.skip("서빙 번들이 없다")
    (tmp_path / source.name).write_text(source.read_text(encoding="utf-8"), encoding="utf-8")

    registry = RiskModelRegistry(tmp_path)
    assert registry.trajectory.available is False
    assert registry.refresh(now=0.0) is False

    (tmp_path / TRAJECTORY_FILE).write_text(
        json.dumps({"targets": {"dm": {"baseline": _baseline()}}}), encoding="utf-8"
    )
    later = registry.STAT_INTERVAL_SECONDS + 1.0
    assert registry.refresh(now=later) is True, "궤적 파일이 새로 생겼는데 다시 읽지 않았다"
    assert registry.trajectory.available is True
    assert registry.trajectory.baseline("dm")["M"]["age_from"] == AGE_FLOOR


# ---------------------------------------------------------------------------
# 7. 중재
# ---------------------------------------------------------------------------


def _condition(status: str = tj.STATUS_PROJECTED) -> dict[str, Any]:
    return {
        "probability": 0.31,
        "medical": {"level": "관심"},
        "peer_percentile": 82.0,
        "judgement": None,
        "trajectory": {"horizons_years": [1, 2, 3, 5, 10], "onset_probability": [0.01, 0.02, 0.03, 0.06, 0.12]},
        "trajectory_status": status,
    }


def test_arbitrate_drops_trajectory_when_disease_already_present() -> None:
    high = arbitrate({"diabetes": {"risk_level": "HIGH"}}, {"dm": _condition()})
    dm = next(v for v in high if v.key == "dm")
    assert dm.superseded_by == "E1"
    assert dm.reference["trajectory"] is None
    assert dm.reference["trajectory_status"] == tj.STATUS_ALREADY_PRESENT

    caution = arbitrate({"diabetes": {"risk_level": "CAUTION"}}, {"dm": _condition()})
    dm = next(v for v in caution if v.key == "dm")
    assert dm.reference["trajectory"] is not None, "전당뇨는 아직 당뇨가 아니다 — 궤적이 남아야 한다"
    assert dm.reference["trajectory_status"] == tj.STATUS_PROJECTED

    silent = arbitrate({}, {"dm": _condition()})
    dm = next(v for v in silent if v.key == "dm")
    assert dm.reference["trajectory"] is not None


def test_arbitrate_withholds_trajectory_where_ml_probability_is_not_shown() -> None:
    """신기능은 검사값 없이는 ML 확률을 표시하지 않는다(ADR-009 §4). 궤적도 같이 내린다."""
    silent = arbitrate({"kidney": {"risk_level": "INSUFFICIENT_DATA"}}, {"ckd": _condition()})
    ckd = next(v for v in silent if v.key == "ckd")
    assert ckd.risk_level == "INSUFFICIENT_DATA"
    assert ckd.reference["trajectory"] is None
    assert ckd.reference["trajectory_status"] == tj.STATUS_WITHHELD

    # 검사값이 있어 공식이 NORMAL 로 답하면 "지금 없다면 앞으로" 가 성립한다 — 궤적을 남긴다.
    decided = arbitrate({"kidney": {"risk_level": "NORMAL"}}, {"ckd": _condition()})
    ckd = next(v for v in decided if v.key == "ckd")
    assert ckd.superseded_by == "E3"
    assert ckd.reference["trajectory"] is not None
    assert ckd.reference["trajectory_status"] == tj.STATUS_PROJECTED
