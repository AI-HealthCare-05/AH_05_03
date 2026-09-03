"""혈압 방향 계약 — 번들이 선언한 방향대로 움직이는지 확인한다.

`docs/23_multi_disease_model_design.md` §8 항목 7 의 표시 회귀 테스트에 속한다.

### 왜 필요했나

원래 번들은 `sbp`·`dbp` 를 그대로 특징으로 썼다. 그러면 방향 제약을 걸 방법이 없다 —
`sbp` 를 고정하고 `dbp` 만 올리면 맥압이 줄어 위험이 내려가는 게 임상적으로 맞고,
둘을 함께 올리면 위험이 올라가는 게 맞다. 한 변수의 방향이 다른 변수의 상태에 따라
뒤집히므로 단조 제약으로 표현할 수 없다.

실측한 증상은 42 검사(나이 3 × 성별 2 × 혈압 7구간) 기준 **번들 16 개에서 위반 106 건**
이었다. `dlp` 15 건에 최대 낙폭 10.39%p, `fatty_liver` 10.17%p, `anemia` 13 건.

### 무엇을 바꿨나

`modeling/targets.py` 의 `SUBSTITUTED_MATERIALS` 가 `sbp`·`dbp` 를 빼고 맥압·평균동맥압
으로 갈아 끼운다. 갈아 끼우고 나서야 방향에 제약을 걸 수 있다.

### 방향을 이 파일에 적지 않는 이유

**번들의 `monotone` 필드를 읽는다.** 방향은 학습이 정하고(`train_multi.MONOTONE` 과
`MONOTONE_OVERRIDES`) 번들에 실려 온다. 여기에 표를 또 두면 갈라진다 — 실제로 갈라졌다.
평균동맥압을 전 타깃 +1 로 걸었다가 빈혈에서 −1 로 뒤집었는데, 그때 테스트가 예외를
모르면 옳은 모델을 떨어뜨린다.

빈혈이 왜 −1 인가: 빈혈은 혈액 점도를 낮추고 말초저항을 떨어뜨려 **평균동맥압을 낮춘다.**
맥압은 반대로 넓어진다. +1 로 강제했더니 AUROC 가 0.7216 → 0.7059 로 떨어졌고,
−1 로 고치니 0.7223 이 됐다 — 원래보다도 높다.

### 복합 경로를 모든 타깃에 강제하지 않는 이유

맥압과 평균동맥압의 방향이 서로 반대인 타깃(빈혈)에서는 혈압 쌍이 함께 오를 때 둘이
서로 밀어서 합이 단조가 아니다. 그건 버그가 아니라 두 제약의 결과다. 그래서 복합 경로
검사는 **두 방향이 같은 부호일 때만** 적용한다.
"""

import json
from pathlib import Path
from typing import Any, NamedTuple

import pytest

from app.services.risk import load_bundle

BUNDLE_DIR = Path(__file__).resolve().parents[3] / "modeling" / "artifacts" / "models"

PULSE = "pulse_pressure"
MEAN_ARTERIAL = "mean_arterial_pressure"
BP_RAW = ("sbp", "dbp")

#: 확률 단위 허용 오차. 순수 파이썬 채점의 오차 바닥이 2e-05 이고(30번 문서 §5.3)
#: 화면은 소수 둘째 자리 %(=1e-04)까지만 보여준다. 그보다 작은 어긋남은 표시되지 않는다.
TOLERANCE = 1e-4

#: 정상에서 고혈압까지 가는 임상 진행 경로. 맥압과 평균동맥압이 **둘 다** 단조로 증가한다.
CLINICAL_PROGRESSION: tuple[tuple[int, int], ...] = (
    (105, 65),
    (110, 70),
    (120, 80),
    (130, 85),
    (140, 90),
    (150, 95),
    (160, 100),
    (180, 110),
)

BASE: dict[str, Any] = {"bmi": 26.0, "self_rated_health": 3}


class Bundle(NamedTuple):
    name: str
    model: Any
    monotone: dict[str, int]


def _bundles() -> list[Bundle]:
    if not BUNDLE_DIR.is_dir():
        pytest.skip(f"서빙 번들이 없다: {BUNDLE_DIR}")
    loaded = []
    for path in sorted(BUNDLE_DIR.glob("risk_*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        loaded.append(Bundle(path.stem, load_bundle(raw), raw.get("monotone") or {}))
    if not loaded:
        pytest.skip(f"서빙 번들이 없다: {BUNDLE_DIR}")
    return loaded


def _bp_bundles() -> list[Bundle]:
    """혈압 파생을 특징으로 쓰는 번들만."""
    return [b for b in _bundles() if PULSE in set(b.model.numeric) or MEAN_ARTERIAL in set(b.model.numeric)]


def _probability(bundle: Bundle, age: int, sex: str, systolic: float, diastolic: float) -> float:
    return bundle.model.probability({**BASE, "age": age, "sex": sex, "sbp": systolic, "dbp": diastolic})


def _sweep(bundle: Bundle, pairs: list[tuple[float, float]], age: int, sex: str) -> list[float]:
    return [_probability(bundle, age, sex, s, d) for s, d in pairs]


def _assert_monotone(values: list[float], direction: int, label: str) -> None:
    """`direction` 이 +1 이면 비감소, −1 이면 비증가여야 한다."""
    for index, (earlier, later) in enumerate(zip(values, values[1:], strict=False)):
        gap = (later - earlier) * direction
        assert gap >= -TOLERANCE, (
            f"{label}: {index}→{index + 1} 구간에서 방향이 뒤집혔다 "
            f"({earlier * 100:.2f}% → {later * 100:.2f}%, 선언 방향 {direction:+d})"
        )


def test_no_bundle_keeps_raw_blood_pressure() -> None:
    """`sbp`·`dbp` 원값을 특징으로 쓰는 번들이 없어야 한다.

    원값이 남아 있으면 파생과 완전 공선이 되어 제약 없는 쪽으로 단조 제약이 우회된다.
    실제로 우회했다 — 파생을 켠 첫 판에서 평균동맥압을 올리는데 확률이 내려갔다.
    """
    offenders = [
        f"{b.name}: {sorted(set(b.model.numeric) & set(BP_RAW))}"
        for b in _bundles()
        if set(b.model.numeric) & set(BP_RAW)
    ]
    assert not offenders, (
        f"원값 혈압이 특징에 남아 있다 — {offenders}. "
        "`modeling/artifacts/models_ensemble` 를 다시 내보내고 배포 위치로 복사했는지 확인하라"
    )


def test_every_bp_bundle_declares_its_directions() -> None:
    """혈압 파생을 쓰면 번들에 방향이 선언돼 있어야 한다.

    선언이 없으면 아래 방향 테스트가 조용히 건너뛴다. 새 타깃을 추가하고 내보내기를
    빠뜨렸을 때 여기서 걸린다.
    """
    missing = [
        f"{b.name}.{feature}"
        for b in _bp_bundles()
        for feature in (PULSE, MEAN_ARTERIAL)
        if feature in set(b.model.numeric) and feature not in b.monotone
    ]
    assert not missing, f"번들에 monotone 선언이 없다: {missing}"


@pytest.mark.parametrize("sex", ["M", "F"])
@pytest.mark.parametrize("age", [35, 54, 68])
def test_pulse_pressure_follows_declared_direction(sex: str, age: int) -> None:
    """평균동맥압을 고정하고 맥압만 움직인다. 혈관 경직 축이다."""
    mean_pressure = 93.3
    pairs = [(mean_pressure - pulse / 3.0 + pulse, mean_pressure - pulse / 3.0) for pulse in (30, 40, 50, 60, 70, 80)]
    for bundle in _bp_bundles():
        direction = bundle.monotone.get(PULSE)
        if not direction:
            continue
        _assert_monotone(_sweep(bundle, pairs, age, sex), direction, f"{bundle.name} {sex} {age}세 맥압")


@pytest.mark.parametrize("sex", ["M", "F"])
@pytest.mark.parametrize("age", [35, 54, 68])
def test_mean_arterial_pressure_follows_declared_direction(sex: str, age: int) -> None:
    """맥압을 고정하고 평균동맥압만 움직인다. 전체 혈압 부하 축이다."""
    pulse = 45.0
    pairs = [(value - pulse / 3.0 + pulse, value - pulse / 3.0) for value in (75, 85, 95, 105, 115, 125)]
    for bundle in _bp_bundles():
        direction = bundle.monotone.get(MEAN_ARTERIAL)
        if not direction:
            continue
        _assert_monotone(_sweep(bundle, pairs, age, sex), direction, f"{bundle.name} {sex} {age}세 평균동맥압")


@pytest.mark.parametrize("sex", ["M", "F"])
@pytest.mark.parametrize("age", [35, 54, 68])
def test_clinical_progression_follows_declared_direction(sex: str, age: int) -> None:
    """혈압 쌍이 임상 진행 경로대로 함께 오를 때.

    두 방향이 같은 부호인 번들만 검사한다. 부호가 갈리면(빈혈) 둘이 서로 밀어서
    합이 단조가 아닌 게 정상이다.
    """
    pairs = [(float(s), float(d)) for s, d in CLINICAL_PROGRESSION]
    checked = 0
    for bundle in _bp_bundles():
        pulse_direction = bundle.monotone.get(PULSE, 0)
        mean_direction = bundle.monotone.get(MEAN_ARTERIAL, 0)
        if pulse_direction == 0 or pulse_direction != mean_direction:
            continue
        checked += 1
        _assert_monotone(_sweep(bundle, pairs, age, sex), pulse_direction, f"{bundle.name} {sex} {age}세 임상 진행")
    assert checked > 0, "임상 진행 경로를 검사할 번들이 하나도 없다 — 방향 선언을 확인하라"
