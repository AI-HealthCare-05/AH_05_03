"""학습 데이터의 `bmi` 와 서빙이 계산하는 `bmi` 가 **같은 식**인지.

## 왜 테스트가 필요한가

BMI 는 두 곳에서 만들어진다.

    학습   `modeling/data/load_nhanes.py`  BMXWT / (BMXHT/100)² 를 계산해 넣는다
    서빙   `app/dtos/predictions.py`       사용자 키·체중으로 같은 식을 계산한다

두 곳에 같은 판단이 있으므로 한쪽만 바뀔 수 있다. 실제로 그런 적이 있다 —
2026-09-07 까지 학습 쪽은 NHANES 가 배포하는 `BMXBMI` 를 **그대로 받았다.** NCHS 는
반올림 전 원측정값으로 BMI 를 내고 우리는 이미 0.1 cm / 0.1 kg 으로 반올림된
`BMXHT`·`BMXWT` 로 계산하므로, 같은 사람에게 두 값이 달랐다.

실측(pooled 48,895행 중 둘 다 있는 44,815행)

    |차이| 최대            0.0500      ← 소수 둘째 자리 반올림 폭에 정확히 갇힌다
    |차이| 평균            0.0156
    |차이| > 0.05          1,886행 (4.21%)
    비만 라벨(≥25) 갈림      68행 (0.15%)

크기는 작지만 **비만 라벨이 BMI 로 정의된다.** 라벨은 `BMXBMI` 기준, 화면의 규칙
엔진은 계산한 BMI 기준으로 같은 사람을 다르게 부를 수 있었다. 학습 쪽을 서빙에
맞추고 이 테스트로 묶는다.

## 왜 데이터를 읽나

식만 비교하면 "코드가 같다" 는 것밖에 못 본다. 정작 틀렸던 것은 식이 아니라 **어느
컬럼을 받았는가** 였고, 그건 산출물을 봐야 잡힌다. pooled 는 저장소에 없으므로
(`.gitignore`) 없으면 건너뛴다 — CI 에서 조용히 통과하는 것은 받아들이고, 데이터를
다시 만드는 사람의 로컬에서 잡히게 둔다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

POOLED = Path(__file__).resolve().parents[3] / "modeling" / "data" / "processed" / "nhanes_pooled.csv"


def _serving_bmi(height_cm: float, weight_kg: float) -> float:
    """`RiskPredictionRequest.bmi` 를 부르지 않고 그 식을 그대로 쓴다.

    DTO 를 부르면 나이·성별까지 유효한 요청을 만들어야 해서 무엇을 재는지가 흐려진다.
    아래 `test_serving_property_uses_this_formula` 가 이 함수와 DTO 를 묶는다.
    """
    return round(weight_kg / (height_cm / 100) ** 2, 2)


def test_serving_property_uses_this_formula() -> None:
    """위 함수가 서빙 DTO 와 같은 답을 내는지. 이게 어긋나면 아래 테스트가 무의미하다."""
    from app.dtos.predictions import RiskPredictionRequest

    for height, weight in ((172.0, 82.0), (150.5, 45.3), (190.2, 110.7), (168.0, 79.5)):
        request = RiskPredictionRequest.model_validate(
            {"age": 40, "sex": "M", "height_cm": height, "weight_kg": weight, "self_rated_health": 3}
        )
        assert request.bmi == _serving_bmi(height, weight)


def test_training_bmi_matches_serving_formula_exactly() -> None:
    """학습 표의 `bmi` 가 키·체중에서 서빙과 같은 식으로 나왔는가. **오차 0 이어야 한다.**"""
    if not POOLED.is_file():
        pytest.skip(f"학습 표가 없다: {POOLED}")
    pd = pytest.importorskip("pandas")

    frame = pd.read_csv(POOLED, low_memory=False, usecols=["bmi", "height_cm", "weight_kg"])
    expected = (frame["weight_kg"] / (frame["height_cm"] / 100) ** 2).round(2)
    both = frame["bmi"].notna() & expected.notna()
    assert both.sum() > 0, "키·체중과 bmi 가 같이 있는 행이 없다 — 전처리가 깨졌다"

    # 커버리지도 같아야 한다. `BMXBMI` 를 받던 때는 한쪽만 있는 행이 생길 수 있었다.
    assert (frame["bmi"].notna() != expected.notna()).sum() == 0, "bmi 와 키·체중의 결측 자리가 다르다"

    worst = (frame["bmi"] - expected)[both].abs().max()
    assert worst == 0.0, (
        f"학습과 서빙이 다른 BMI 를 쓴다 (최대 차이 {worst}). `load_nhanes.py` 가 BMXBMI 를 다시 받고 있는지 확인하라."
    )
