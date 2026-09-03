"""학습이 쓴 특징을 서빙이 실제로 만들 수 있는지 확인한다.

`design_row` 는 번들의 `numeric_features` 를 이름으로 조회하고 없으면 학습 시점의
중앙값을 넣는다. 그래서 서빙이 어떤 파생을 못 만들면 **예외가 아니라 조용한 오차**가
된다 — 사용자가 입력한 값이 결과에 하나도 반영되지 않는데 화면에는 숫자가 정상적으로
나온다.

실제로 그럴 자리가 있었다. 학습에서 `sbp`·`dbp` 를 빼고 맥압·평균동맥압으로 갈아
끼웠는데(`modeling/targets.py` 의 `SUBSTITUTED_MATERIALS`), 서빙의 `expand_features`
는 그 둘을 만들지 않았다. 그대로 두면 혈압을 입력해도 확률이 안 움직인다.

이 테스트는 특정 파생 이름을 나열하지 않는다. 번들이 요구하는 것 전부를 훑으므로
다음에 새 파생을 켤 때도 같은 실수를 잡는다.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from app.services.risk import expand_features, load_bundle

BUNDLE_DIR = Path(__file__).resolve().parents[3] / "modeling" / "artifacts" / "models"

#: 특징 이름이지만 입력이 아니라 상태 표시인 것. `expand_features` 가 항상 만든다.
STATE_FEATURES = {"srh_missing"}

#: 모든 검사값·문항을 채운 요청. 이걸로도 못 만드는 특징이 있으면 서빙에 구멍이다.
FULL_PAYLOAD: dict[str, Any] = {
    "age": 54.0,
    "sex": "M",
    "bmi": 26.0,
    "self_rated_health": 3.0,
    "height_cm": 173.0,
    "waist_cm": 92.0,
    "smoking_status": "former",
    "alcohol_days_per_year": 52.0,
    "moderate_min_per_week": 150.0,
    "vigorous_min_per_week": 60.0,
    "sedentary_min_per_day": 480.0,
    "sleep_hours": 7.0,
    "sbp": 132.0,
    "dbp": 84.0,
    "fasting_glucose": 98.0,
    "hba1c": 5.6,
    "total_chol": 195.0,
    "hdl": 48.0,
    "ldl": 118.0,
    "triglyceride": 145.0,
    "ast": 26.0,
    "alt": 31.0,
    "ggt": 34.0,
    "uric_acid": 6.1,
    "creatinine": 0.95,
    "hemoglobin": 14.8,
    "albumin": 4.3,
    "urine_acr": 12.0,
}


def _bundles() -> list[tuple[str, Any]]:
    if not BUNDLE_DIR.is_dir():
        pytest.skip(f"서빙 번들이 없다: {BUNDLE_DIR}")
    loaded = [
        (path.stem, load_bundle(json.loads(path.read_text(encoding="utf-8"))))
        for path in sorted(BUNDLE_DIR.glob("risk_*.json"))
    ]
    if not loaded:
        pytest.skip(f"서빙 번들이 없다: {BUNDLE_DIR}")
    return loaded


def test_every_numeric_feature_is_computable() -> None:
    """번들이 요구하는 수치 특징을 서빙이 전부 만들 수 있어야 한다."""
    holes: list[str] = []
    for name, model in _bundles():
        computed = expand_features(FULL_PAYLOAD, model.expansion)
        for column in model.numeric:
            if column in STATE_FEATURES:
                continue
            if computed.get(column) is None:
                holes.append(f"{name}.{column}")
    assert not holes, (
        f"학습은 썼는데 서빙이 못 만드는 특징: {sorted(set(holes))}. "
        "`expand_features` 에 계산을 추가하라 — 지금은 조용히 중앙값으로 채워진다"
    )


def test_substituted_materials_are_gone_from_bundles() -> None:
    """갈아 끼운 원재료가 번들에 남아 있으면 갈아 끼우기가 안 된 것이다.

    `sbp`·`dbp` 와 맥압·평균동맥압이 같이 들어 있으면 완전 공선이라 분할만 흩뜨리고
    (26번 문서 §0.2) 단조 제약도 원값 쪽으로 우회된다.
    """
    for name, model in _bundles():
        numeric = set(model.numeric)
        if not ({"pulse_pressure", "mean_arterial_pressure"} & numeric):
            continue
        leftover = sorted({"sbp", "dbp"} & numeric)
        assert not leftover, f"{name}: 파생과 원재료가 같이 있다 — {leftover}"


def test_blood_pressure_derivation_matches_training_formula() -> None:
    """맥압·평균동맥압 식이 학습 쪽과 같아야 한다."""
    computed = expand_features({"sbp": 132.0, "dbp": 84.0}, "ratios")
    assert computed["pulse_pressure"] == pytest.approx(48.0)
    assert computed["mean_arterial_pressure"] == pytest.approx(84.0 + 48.0 / 3.0)


def test_blood_pressure_derivation_needs_both_values() -> None:
    """한쪽만 들어오면 만들지 않는다. 학습 때도 그 행은 결측이었다."""
    for payload in ({"sbp": 132.0}, {"dbp": 84.0}, {}):
        computed = expand_features(payload, "ratios")
        assert "pulse_pressure" not in computed
        assert "mean_arterial_pressure" not in computed
