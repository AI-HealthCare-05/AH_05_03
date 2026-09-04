"""참조표 백분위의 표시 회귀 테스트.

`docs/23_multi_disease_model_design.md` §8 항목 7이 이번 릴리스의 최우선 테스트로
지목한 것 중 "연령 경계에서 백분위 절벽이 없다"를 고정한다.

절벽이 실제로 있었다. 참조 셀이 10년 단위라 29 세와 30 세가 다른 표를 읽었고,
당뇨 남성 BMI 26 에서 확률은 1.51% 로 소수점까지 같은데 백분위가 70.0 에서 20.0 으로
떨어졌다. 사용자가 아무것도 바꾸지 않았는데 생일 하나에 등급이 뒤집힌다.

DB 픽스처를 쓰지 않는다. 참조표 조회는 순수 계산이고, 여기서 DB 를 붙이면
컨테이너가 꺼져 있을 때 이 회귀를 못 잡는다.
"""

import json
from pathlib import Path

import pytest

from app.services.risk import (
    PEER_AGE_BANDS,
    PEER_AGE_EDGES,
    BaseRiskModel,
    load_bundle,
    peer_band_center,
    peer_cell,
)

BUNDLE_DIR = Path(__file__).resolve().parents[3] / "modeling" / "artifacts" / "models"

#: 경계를 통과할 때 허용하는 백분위 변화. 23번 문서는 5%p 를 기준으로 적었고
#: 보간을 넣은 뒤 실측은 0.1%p 이하다. 회귀를 빨리 잡으려고 기준을 조인다.
BOUNDARY_TOLERANCE_PP = 1.0

#: 경계 양옆으로 이만큼 떨어진 나이를 비교한다. 정수 나이만 들어오므로
#: 0.01 은 "같은 사람인데 생일만 지났다"에 해당한다.
EPSILON_YEARS = 0.01


def _bundles() -> list[tuple[str, BaseRiskModel]]:
    if not BUNDLE_DIR.is_dir():
        pytest.skip(f"서빙 번들이 없다: {BUNDLE_DIR}")
    loaded = []
    for path in sorted(BUNDLE_DIR.glob("risk_*.json")):
        bundle = json.loads(path.read_text(encoding="utf-8"))
        loaded.append((path.stem, load_bundle(bundle)))
    if not loaded:
        pytest.skip(f"서빙 번들이 없다: {BUNDLE_DIR}")
    return loaded


#: 첫 구간의 아래 끝과 마지막 구간의 위 끝은 경계가 아니다.
INNER_BOUNDARIES = [float(edge) for edge in PEER_AGE_EDGES[1:-1]]


def test_peer_bands_match_the_reference_keys() -> None:
    """`PEER_AGE_BANDS` 가 번들의 참조표 키와 어긋나면 보간이 조용히 꺼진다."""
    for name, model in _bundles():
        labels = {key.split(":", 1)[-1] for key in model.reference}
        assert labels <= set(PEER_AGE_BANDS), f"{name}: 모르는 구간 라벨 {labels - set(PEER_AGE_BANDS)}"


def test_top_band_center_is_capped() -> None:
    """마지막 구간은 상한이 열려 있다. 중앙값을 그대로 쓰면 135 세가 대표 연령이 된다."""
    assert peer_band_center("70_200") < 100
    assert peer_band_center("19_30") == pytest.approx(24.5)
    assert peer_band_center("50_60") == pytest.approx(55.0)


@pytest.mark.parametrize("sex", ["M", "F"])
@pytest.mark.parametrize("probability", [0.015, 0.05, 0.16, 0.28, 0.45, 0.7])
def test_no_percentile_cliff_at_age_boundaries(sex: str, probability: float) -> None:
    """같은 확률인데 생일 하나로 백분위가 뛰지 않는다.

    확률을 고정하는 것이 요점이다. 모델 자체가 나이에 반응해 확률이 바뀌는 것은
    정상이고, 여기서 잡으려는 것은 **참조표를 갈아타는 순간의 불연속**이다.
    """
    for name, model in _bundles():
        for boundary in INNER_BOUNDARIES:
            before = model.peer_percentile(probability, boundary - EPSILON_YEARS, sex)
            after = model.peer_percentile(probability, boundary + EPSILON_YEARS, sex)
            if before is None or after is None:
                continue
            assert peer_cell(boundary - EPSILON_YEARS, sex) != peer_cell(boundary + EPSILON_YEARS, sex)
            assert abs(after - before) <= BOUNDARY_TOLERANCE_PP, (
                f"{name} {sex} {boundary:.0f}세 경계에서 백분위가 "
                f"{before:.1f} → {after:.1f} 로 {abs(after - before):.1f}%p 뛴다"
            )


@pytest.mark.parametrize("sex", ["M", "F"])
def test_percentile_stays_monotone_in_probability(sex: str) -> None:
    """보간이 순서를 뒤집지 않는다. 확률이 높으면 백분위도 높아야 한다."""
    probabilities = [0.005, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 0.95]
    for name, model in _bundles():
        for age in (19, 29, 30, 45, 59, 60, 70, 85):
            values = [model.peer_percentile(p, age, sex) for p in probabilities]
            if any(value is None for value in values):
                continue
            for earlier, later in zip(values, values[1:], strict=False):
                assert earlier is not None and later is not None
                assert earlier <= later + 1e-9, f"{name} {sex} {age}세에서 백분위가 역전됐다"


@pytest.mark.parametrize("sex", ["M", "F"])
def test_percentile_stays_in_range(sex: str) -> None:
    """보간해도 0~100 을 벗어나지 않는다."""
    for name, model in _bundles():
        for age in range(19, 96):
            for probability in (0.0, 0.001, 0.5, 0.999, 1.0):
                value = model.peer_percentile(probability, age, sex)
                if value is None:
                    continue
                assert 0.0 <= value <= 100.0, f"{name} {sex} {age}세 p={probability} -> {value}"
