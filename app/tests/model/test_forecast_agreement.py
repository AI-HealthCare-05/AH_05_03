"""앞날 숫자를 언제 내고 언제 지우는가.

## 규칙이 한 곳에 있어야 하는 이유

이 판단이 예전에는 **서버와 화면 두 곳**에 있었다. 서버는 "이미 넘었으면 지운다",
화면은 "확진이면 안 그린다". 둘 다 너무 거칠어서, 판정과 어긋나지 않는 값까지 같이
버렸다 — 실측(대사증후군 프리셋)에서 비만 91%·지방간 66%·대사증후군 58% 가 통째로
사라졌고, 패널 제목이 "발병 예측" 인데 예측이 한 줄도 없었다.

## 지금 규칙

    trajectory(새로 생길)   이미 넘었으면 무조건 지운다. "지금 없다면" 이 전제다.
    prevalence(넘고 있을)   **측정과 모델이 서로 반대 방향일 때만** 지운다.

어긋남은 양방향이다.

    측정 '높음' + 모델 '낮음'    지질 넉 장이 차단된 고중성지방·낮은 HDL 이 여기 걸린다
    측정 '정상' + 모델 '높음'    규칙이 "기준 안" 이라 한 카드 밑에 74% 가 붙던 자리

`주의`(이 점수대의 50% 이상이 기준 초과) 를 경계로 둔다 — 측정이 "넘었다" 고 한
사람 옆에 절반도 안 되는 숫자가 서면 그 숫자가 배지와 다투는 것으로 읽힌다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.dtos.assessment_summary import AssessmentSummaryRequest
from app.services.assessment import assess, model_contradicts_measurement
from app.services.risk import RiskModelRegistry

MODEL_DIR = Path(__file__).resolve().parents[3] / "modeling" / "artifacts" / "models"

#: 지질·대사 지표가 두루 높은 사람. 여러 질환이 동시에 '높음' 으로 잡혀서 억제 규칙이
#: 실제로 갈리는 자리를 한 번에 볼 수 있다.
METABOLIC = {
    "age": 52,
    "sex": "M",
    "height_cm": 172.0,
    "weight_kg": 88.0,
    "waist_cm": 98.0,
    "self_rated_health": 3,
    "sbp": 138.0,
    "dbp": 88.0,
    "fasting_glucose": 112.0,
    "hba1c": 5.3,
    "total_chol": 180.0,
    "ldl": 105.0,
    "hdl": 38.0,
    "triglyceride": 210.0,
    "ast": 34.0,
    "alt": 46.0,
    "ggt": 62.0,
    "uric_acid": 5.2,
    "creatinine": 0.9,
    "hemoglobin": 15.0,
    "albumin": 4.4,
    "urine_acr": 8.0,
    "smoking_status": "never",
}


def _assess() -> tuple[list, list]:
    registry = RiskModelRegistry(MODEL_DIR)
    if not registry.available:
        pytest.skip(f"서빙 번들이 없다: {MODEL_DIR}")
    verdicts, _, _, _, suspects = assess(AssessmentSummaryRequest.model_validate(METABOLIC), registry)
    return verdicts, suspects


def _prevalence(verdict: object) -> object:
    return (getattr(verdict, "reference", None) or {}).get("prevalence_trajectory")


def test_agreeing_cards_keep_their_forecast() -> None:
    """모델이 판정과 같은 방향이면 이미 넘은 카드에도 5년 숫자를 남긴다.

    이 셋이 첫 판에서 통째로 사라졌던 자리다. 사라지면 패널에 숫자가 하나도 안 남는다.
    """
    verdicts, _ = _assess()
    by_key = {v.key: v for v in verdicts}
    for key in ("obesity", "fatty_liver", "mets"):
        verdict = by_key[key]
        assert verdict.risk_level in {"HIGH", "VERY_HIGH"}, f"{key} 는 이 입력에서 넘어야 한다"
        assert not model_contradicts_measurement(verdict), f"{key}: 모델이 같은 방향인데 모순으로 봤다"
        assert _prevalence(verdict) is not None, f"{key} 의 5년 숫자가 지워졌다"


def test_contradicting_cards_lose_their_forecast() -> None:
    """모델이 판정과 반대 방향이면 지운다.

    지질 하위유형은 라벨을 만드는 넉 장이 전부 차단돼(`modeling/targets.py`) 모델이
    낮은 값을 낸다. '높음' 배지 밑에 그 숫자가 붙으면 어느 쪽을 믿어야 하는지 모른다.
    """
    verdicts, _ = _assess()
    by_key = {v.key: v for v in verdicts}
    for key in ("hypertg", "low_hdl"):
        verdict = by_key[key]
        assert verdict.risk_level in {"HIGH", "VERY_HIGH"}
        assert model_contradicts_measurement(verdict), f"{key}: 모순인데 못 잡았다"
        assert _prevalence(verdict) is None, f"{key} 에 배지와 다투는 숫자가 남았다"


def test_onset_is_dropped_whenever_already_present() -> None:
    """ "지금 없다면" 이 전제이므로, 동의 여부와 무관하게 이미 넘으면 지운다."""
    verdicts, _ = _assess()
    for verdict in verdicts:
        if verdict.risk_level in {"HIGH", "VERY_HIGH"}:
            assert (verdict.reference or {}).get("trajectory") is None, verdict.key


def test_panel_and_cards_make_the_same_call() -> None:
    """의심 패널의 곡선은 판정 카드와 **같은 결정**을 따른다.

    패널의 곡선은 중재를 거치지 않은 `ConditionRisk` 에서 곧장 오므로, 옮겨 담지
    않으면 같은 질환이 위아래에서 다른 말을 한다.
    """
    verdicts, suspects = _assess()
    by_key = {v.key: v for v in verdicts}
    assert suspects, "의심 카드가 비었다"
    for card in suspects:
        verdict = by_key.get(card.target)
        assert verdict is not None, f"{card.target} 가 판정에 없다"
        if model_contradicts_measurement(verdict):
            assert card.prevalence_trajectory is None, f"{card.target}: 판정은 지웠는데 패널에 남았다"
        if verdict.risk_level in {"HIGH", "VERY_HIGH"}:
            assert card.onset_trajectory is None, f"{card.target}: 이미 넘었는데 발병 곡선이 남았다"


def test_top_three_carry_a_number_or_an_explainable_reason() -> None:
    """**이 규칙의 목적이다.** 급한 순 세 장에 5년 숫자가 실제로 붙는지.

    등급 순 상위 셋은 대개 이미 넘은 질환이라, 억제가 거칠면 패널이 통째로 빈다.
    첫 판이 그랬다 — 세 장 모두 "지금 넘었어요" 만 적혔다.

    **모든 칸에 숫자를 낼 수는 없다.** 지질 하위유형처럼 라벨 검사값이 통째로 차단된
    질환은 모델이 판정과 반대 방향을 가리켜서, 숫자를 내면 배지와 다툰다. 그래서
    보장하는 것은 "전부 숫자" 가 아니라 **"숫자이거나, 설명되는 빈칸"** 이다.
    """
    verdicts, suspects = _assess()
    by_key = {v.key: v for v in verdicts}
    assert suspects, "의심 카드가 비었다"

    numbered = [c for c in suspects if c.prevalence_trajectory is not None or c.onset_trajectory is not None]
    blank = [c for c in suspects if c not in numbered]

    # 빈칸은 반드시 설명이 있어야 한다 — 모델이 판정과 어긋났거나, 애초에 확률을
    # 표시하지 않기로 한 질환(ADR-009 §4)이거나.
    for card in blank:
        verdict = by_key[card.target]
        explained = model_contradicts_measurement(verdict) or verdict.risk_level == "INSUFFICIENT_DATA"
        assert explained, f"{card.name}: 이유 없이 숫자가 비었다"

    # 그리고 세 장이 **전부** 빈칸이면 패널이 제 일을 못 한다.
    assert numbered, f"세 장 모두 숫자가 없다: {[c.name for c in suspects]}"
