"""요청 DTO 와 서빙 번들 사이의 입력 계약.

`veg_fruit_daily` 가 유령 입력이었다. DTO 는 받는데 번들 20개 어디에도 그 특징이
없어서 켜고 끈 결과 차이가 0.0%p 였다. 물어보면 사용자는 답이 반영된다고 믿는다.

같은 일이 다시 생기지 않게 두 방향을 고정한다.

- DTO 가 받는 항목은 어딘가 한 번은 쓰여야 한다 (유령 입력 금지)
- 번들이 요구하는 필수 입력은 DTO 가 받을 수 있어야 한다 (구멍 금지)

DB 를 붙이지 않는다 — 스키마 대조는 순수 계산이다.
"""

import json
from pathlib import Path

import pytest

from app.dtos.predictions import RiskPredictionRequest
from app.services.risk import BLOOD_PRESSURE_DERIVED, DERIVED_RATIOS

BUNDLE_DIR = Path(__file__).resolve().parents[3] / "modeling" / "artifacts" / "models"

#: 번들의 특징 이름으로는 안 나타나지만 계산 재료로 쓰이는 입력.
#: `weight_kg` 는 BMI 를 만들고 사라진다 — 번들에 `weight_kg` 는 없고 `bmi` 가 있다.
DERIVED_ONLY_INPUTS = {"weight_kg"}


def _bundle_names() -> set[str]:
    if not BUNDLE_DIR.is_dir():
        pytest.skip(f"서빙 번들이 없다: {BUNDLE_DIR}")
    names: set[str] = set()
    for path in BUNDLE_DIR.glob("risk_*.json"):
        bundle = json.loads(path.read_text(encoding="utf-8"))
        for key in ("numeric_features", "categorical_features", "required_inputs", "optional_inputs"):
            names |= set(bundle.get(key) or [])
    if not names:
        pytest.skip(f"서빙 번들이 없다: {BUNDLE_DIR}")
    return names


def _derived_materials(used: set[str]) -> set[str]:
    """번들이 쓰는 파생 특징의 재료 이름.

    `sbp`·`dbp` 가 여기 들어오는 이유가 있다. 학습에서 원값을 특징에서 빼고 맥압·
    평균동맥압으로 갈아 끼웠으므로(`modeling/targets.py` 의 `SUBSTITUTED_MATERIALS`)
    번들의 특징 목록에는 없지만 **입력으로는 여전히 받아야 한다.** 유령 입력이 아니다.
    """
    materials: set[str] = set()
    for derived, (numerator, denominator) in DERIVED_RATIOS.items():
        if derived in used:
            materials |= {numerator, denominator}
    for derived, (systolic, diastolic) in BLOOD_PRESSURE_DERIVED.items():
        if derived in used:
            materials |= {systolic, diastolic}
    if "egfr" in used:
        materials.add("creatinine")
    return materials


def test_no_ghost_inputs() -> None:
    """DTO 가 받는 항목이 채점에 한 번은 닿아야 한다.

    닿지 않으면 사용자가 답한 값이 조용히 버려진다. 새 입력을 추가할 때 학습·내보내기를
    빠뜨리면 여기서 걸린다.
    """
    used = _bundle_names()
    allowed = used | _derived_materials(used) | DERIVED_ONLY_INPUTS
    ghosts = sorted(name for name in RiskPredictionRequest.model_fields if name not in allowed)
    assert not ghosts, (
        f"DTO 는 받는데 어느 번들도 쓰지 않는 입력: {ghosts}. "
        "학습·내보내기에 넣거나 DTO 에서 빼라 — 받아만 두면 사용자를 속인다"
    )


def test_every_required_input_is_accepted() -> None:
    """번들이 필수로 요구하는 입력을 DTO 가 받을 수 있어야 한다."""
    if not BUNDLE_DIR.is_dir():
        pytest.skip(f"서빙 번들이 없다: {BUNDLE_DIR}")
    fields = set(RiskPredictionRequest.model_fields)
    # `bmi` 는 키·체중에서 계산하는 computed_field 라 model_fields 에 없다.
    accepted = fields | {"bmi"} | set(DERIVED_RATIOS) | {"srh_missing", "egfr"}
    for path in sorted(BUNDLE_DIR.glob("risk_*.json")):
        bundle = json.loads(path.read_text(encoding="utf-8"))
        missing = sorted(set(bundle.get("required_inputs") or []) - accepted)
        assert not missing, f"{path.stem} 의 필수 입력을 DTO 가 못 받는다: {missing}"


def test_to_features_drops_none_and_casts_bools() -> None:
    """선택 항목을 비우면 키가 아예 빠지고, 불리언은 수치로 간다."""
    request = RiskPredictionRequest(
        age=54,
        sex="M",
        height_cm=173.0,
        weight_kg=78.0,
        self_rated_health=3,
    )
    features = request.to_features()

    # 예전에는 `difficulty_walking=True` 로 불리언 변환을 봤는데 그 입력을 뺐다.
    # 남은 불리언 입력이 없으므로 여기서는 비운 항목이 빠지는 것만 본다.
    assert "waist_cm" not in features, "비운 선택 항목이 0 으로 채워지면 결측과 구분이 안 된다"
    assert "veg_fruit_daily" not in features
    assert features["sex"] == "M"
    # BMI 는 소수 둘째 자리까지 반올림해서 넘긴다. 학습 때도 같은 반올림을 거쳤다.
    assert features["bmi"] == pytest.approx(round(78.0 / (1.73**2), 2))
