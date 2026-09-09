"""만성염증 카드가 지켜야 하는 것.

## 왜 이 질환만 규칙이 하나 더 있나

고감도 CRP 는 세 구간(AHA/CDC 2003)으로 심혈관 위험을 읽는데, **10 mg/L 를 넘으면
그 자를 쓰지 않는다.** 감염·외상·수술 뒤에는 일시적으로 이만큼 오르고, AHA 는 그
구간을 위험 등급이 아니라 "2주 뒤 재측정" 으로 본다. 측정자의 9.5% 가 여기 걸린다.

이 규칙이 두 곳에 걸려 있다.

    학습   `label_chronic_inflammation` 이 >10 을 **결측**으로 둔다. 양성으로 두면
           모델이 만성염증이 아니라 감기를 맞힌다.
    서빙   `lab_staging.evaluate_inflammation` 이 등급 대신 재측정 안내를 낸다.

둘 중 하나만 지켜지면 조용히 틀린다 — 그래서 양쪽을 같이 고정한다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.dtos.assessment_summary import AssessmentSummaryRequest
from app.services.assessment import DiseaseVerdict, assess
from app.services.lab_staging import evaluate_inflammation
from app.services.risk import RiskModelRegistry

MODEL_DIR = Path(__file__).resolve().parents[3] / "modeling" / "artifacts" / "models"

BASE = {
    "age": 52,
    "sex": "M",
    "height_cm": 172.0,
    "weight_kg": 88.0,
    "self_rated_health": 4,
    "sbp": 128.0,
    "dbp": 82.0,
    "fasting_glucose": 104.0,
}


def _models() -> RiskModelRegistry:
    registry = RiskModelRegistry(MODEL_DIR)
    if "inflammation" not in registry.targets():
        pytest.skip(f"만성염증 번들이 없다: {MODEL_DIR}")
    return registry


def _card(extra: dict[str, float]) -> DiseaseVerdict:
    verdicts, *_ = assess(AssessmentSummaryRequest.model_validate({**BASE, **extra}), _models())
    return next(v for v in verdicts if v.key == "inflammation")


def test_bands_follow_aha_thresholds() -> None:
    """<1 낮음 · 1~3 보통 · >3 높음. 경계값은 아래쪽 구간에 든다."""
    assert evaluate_inflammation({"crp": 0.9})["sub_status"] == "낮음"
    assert evaluate_inflammation({"crp": 1.0})["sub_status"] == "보통"
    assert evaluate_inflammation({"crp": 3.0})["sub_status"] == "보통", "3.0 은 '초과' 가 아니라 '이하' 다"
    assert evaluate_inflammation({"crp": 3.1})["sub_status"] == "높음"


def test_acute_band_refuses_to_grade() -> None:
    """10 초과는 등급이 아니라 재측정 안내다.

    여기서 `HIGH` 를 내면 감기 걸린 사람에게 심혈관 고위험이라고 말하게 된다.
    """
    acute = evaluate_inflammation({"crp": 15.0})
    assert acute["risk_level"] == "INSUFFICIENT_DATA"
    assert "급성" in acute["sub_status"]
    assert "2주" in acute["recommendation"]
    assert acute["flags"], "왜 등급을 안 냈는지 화면이 읽을 문구가 있어야 한다"


def test_measured_value_beats_the_model() -> None:
    """CRP 를 넣으면 규칙 엔진이 정본이고 ML 확률은 참고로 내려간다."""
    card = _card({"crp": 4.2})
    assert card.engine == "E1"
    assert card.risk_level == "HIGH"
    assert card.superseded_by == "E1"
    assert card.reference.get("probability") is not None, "밀려나도 지우지 않는다"


def test_model_answers_when_crp_is_missing() -> None:
    """**이 카드의 존재 이유다.** CRP 는 국가건강검진에 없어서 대부분 비어 있다."""
    card = _card({})
    assert card.engine == "E2"
    assert card.risk_level in {"NORMAL", "CAUTION", "HIGH"}
    assert card.reference.get("probability") is not None
    assert card.reference.get("model_target") == "inflammation"


def test_acute_reason_survives_the_fallback_to_ml() -> None:
    """급성 구간에서 규칙이 물러나도 그 이유는 카드에 남는다.

    규칙 엔진이 침묵하면 중재가 ML 로 넘어가는데, 그때 도메인이 남긴 flags 를
    안 옮기면 CRP 15 를 넣은 사람이 "2주 뒤 재측정" 을 영영 못 본다. 실측으로
    사라지고 있었다.
    """
    card = _card({"crp": 15.0})
    assert card.engine == "E2", "규칙이 등급을 안 냈으므로 ML 이 답한다"
    assert any("급성" in flag for flag in card.flags), card.flags


def test_crp_never_becomes_a_feature_of_its_own_model() -> None:
    """라벨을 만드는 값이 특징으로 들어가면 모델은 임계값만 다시 배운다."""
    registry = _models()
    for tier in ("basic", "lab"):
        model = registry.get("inflammation", tier)
        assert model is not None
        assert "crp" not in set(model.required) | set(model.optional)


def test_crp_is_not_a_feature_of_any_other_model() -> None:
    """다른 타깃의 특징으로도 넣지 않았다.

    학습 주기 둘(2011-2014)이 통째로 없고 국가건강검진 혈액 패널 밖이라 서빙에서
    대부분 결측이다. 넣으면 중앙값으로 대치될 뿐인데 학습에서는 신호처럼 보인다.
    """
    registry = _models()
    for model in registry.models.values():
        assert "crp" not in set(model.required) | set(model.optional), model.model_id
