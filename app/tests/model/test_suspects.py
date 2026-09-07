"""의심 상위 세 개 선별과 유병 궤적 계약.

무엇을 고정하려는가
------------------
1. **등급이 먼저다.** "낮음" 은 아무리 동년배보다 높아도 의심이 아니다(점수 0).
2. **근거 가중이 지질을 강등시킨다.** 같은 등급·같은 배수면 사망연계에서 검증된
   질환이 위로 간다. 이게 없으면 유병률이 높은 지질 카드가 상위를 독차지한다.
3. **고령에서 동년배배수의 무게가 준다.** 70대 고혈압 유병률이 67.5% 라 그 안에서는
   누구나 비슷하게 높고 백분위가 정보가 아니다.
4. **이미 아는 질환은 후보에서 빠진다.**
5. **항상 세 개가 나온다.** 후보가 모자라면 채우되 `suspected=False` 로 구분한다.
6. **비가역 질환의 유병 곡선은 내려가지 않는다.** GBDT 의 나이 계단이 만드는 인공물을
   접는다. 가역 질환은 접지 않는다 — 지질이 60대 이후 내려가는 것은 실제 현상이다.

DB 를 붙이지 않는다.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.dtos.predictions import RiskPredictionRequest
from app.services import suspects as sp
from app.services.risk import REPO_MODEL_DIR, RiskModelRegistry
from app.services.trajectory import TRAJECTORY_TARGETS, prevalence_curve

#: 모듈을 읽는 시점의 실제 기본값. 아래 autouse fixture 가 덮기 전에 잡아 둔다.
DEPLOYED_RANK_SOURCE = sp.RANK_SOURCE
DEPLOYED_RANK_POOL = sp.RANK_POOL


@pytest.fixture(autouse=True)
def arbitrated_ranking(monkeypatch: pytest.MonkeyPatch) -> None:
    """이 파일의 계약 대부분은 **중재 기반 순위**를 전제한다.

    `sp.RANK_SOURCE` 는 제품 결정이라 뒤집힐 수 있는데, 아래 계약들은 그 방식을
    골랐을 때 무엇이 보장되는지를 적어 둔 것이다. 전역 기본값이 바뀌었다고 계약이
    사라지면 되돌릴 때 무엇을 잃었는지 알 수 없으므로 여기서 고정한다.
    확률 순위 쪽 계약은 §7 에서 따로 건다.
    """
    monkeypatch.setattr(sp, "RANK_SOURCE", "arbitrated")


def card(target: str, level: str, ratio: float | None = 1.0, probability: float = 0.3) -> dict[str, Any]:
    return {
        "target": target,
        "name": target,
        "medical": {"level": level},
        "peer_ratio": ratio,
        "probability": probability,
        "trajectory_status": "below_gate",
    }


# ---------------------------------------------------------------------------
# 1. 순위 규칙
# ---------------------------------------------------------------------------


def test_level_gates_everything() -> None:
    """등급이 '낮음' 이면 배수가 아무리 커도 점수 0."""
    score, _ = sp.score_one(card("dm", "낮음", ratio=3.0), age=45)
    assert score == 0.0
    higher, _ = sp.score_one(card("dm", "관심", ratio=1.0), age=45)
    assert higher > score


def test_evidence_weight_demotes_lipid_cards() -> None:
    """같은 등급·같은 배수면 사망연계에서 검증된 카드가 위로 간다."""
    ranked = sp.rank_suspects(
        [card("low_hdl", "주의", 1.5), card("ckd", "주의", 1.5), card("dlp", "주의", 1.5)], age=45
    )
    assert [r["target"] for r in ranked][0] == "ckd"
    assert sp.EVIDENCE["ckd"] > sp.EVIDENCE["low_hdl"]
    # 지질 셋은 전부 0.4 여야 한다 — 27번·42번 문서의 사망연계 C 에서 유도한 값이다.
    assert {sp.EVIDENCE[k] for k in ("dlp", "hyperchol", "hypertg", "low_hdl")} == {0.4}


@pytest.mark.parametrize(
    ("age", "expected"),
    [(30, 3.0), (60, 3.0), (70, 2.0), (80, 1.0), (90, 1.0)],
)
def test_peer_lift_fades_with_age(age: float, expected: float) -> None:
    """60세까지는 배수를 그대로, 80세부터는 무시한다. 상한은 3배."""
    assert sp.lift_weight(5.0, age) == pytest.approx(expected)


def test_missing_peer_ratio_is_neutral() -> None:
    assert sp.lift_weight(None, 45) == 1.0
    assert sp.lift_weight(0.0, 45) == 1.0


# ---------------------------------------------------------------------------
# 2. 선별
# ---------------------------------------------------------------------------


def test_known_diseases_are_excluded() -> None:
    """규칙 엔진이 이미 '있다' 고 한 질환은 의심으로 다시 올리지 않는다."""
    cards = [card("dm", "높음", 2.0), card("htn", "주의", 1.5), card("ckd", "관심", 1.2), card("anemia", "관심", 1.1)]
    ranked = sp.rank_suspects(cards, age=50, known={"dm"})
    assert "dm" not in {r["target"] for r in ranked}
    assert ranked[0]["target"] == "htn"


def test_always_returns_three_and_flags_non_suspects() -> None:
    """후보가 모자라면 채우되 의심이 아님을 표시한다."""
    ranked = sp.rank_suspects([card(t, "낮음", 1.0) for t in ("dm", "htn", "ckd", "anemia")], age=40)
    assert len(ranked) == sp.TOP_N == 3
    assert all(r["suspected"] is False for r in ranked)
    assert all("의심 신호는 없" in r["reason"] for r in ranked)
    assert [r["rank"] for r in ranked] == [1, 2, 3]


def test_reason_mentions_weak_evidence() -> None:
    ranked = sp.rank_suspects([card("low_hdl", "주의", 1.5)], age=40, top_n=1)
    assert "연결이 약해" in ranked[0]["reason"]
    ranked = sp.rank_suspects([card("ckd", "주의", 1.5)], age=40, top_n=1)
    assert "근거가 확인된" in ranked[0]["reason"]


# ---------------------------------------------------------------------------
# 2b. 규칙 엔진 통합 — 측정이 추정을 이긴다
# ---------------------------------------------------------------------------


def verdict(engine: str, level: str, *, measured: bool) -> dict[str, Any]:
    """판정 한 줄. `measured` 는 **엔진 코드와 별개다** — 아래 두 테스트가 그 이유다."""
    return {"engine": engine, "risk_level": level, "measured": measured}


def test_measured_caution_outranks_estimated_high() -> None:
    """검사값으로 준 '주의' 가 확률로 추정한 '높음' 보다 위다.

    ADR-009 가 엔진 우선순위를 "경쟁이 아니라 순서" 로 못 박았고, 순위 점수도 같은
    판단을 따른다. 측정 3.0 > 추정 최대 2.0.
    """
    cards = [card("dm", "높음", 1.0), card("htn", "낮음", 1.0)]
    plain = sp.rank_suspects(cards, age=50, top_n=2)
    assert plain[0]["target"] == "dm", "판정이 없으면 ML 등급으로 매긴다"

    merged = sp.rank_suspects(cards, age=50, verdicts={"htn": verdict("E1", "CAUTION", measured=True)}, top_n=2)
    assert merged[0]["target"] == "htn", "규칙 엔진이 측정으로 준 주의가 위로 와야 한다"
    assert merged[0]["basis"] == "측정"
    assert merged[1]["basis"] == "예측"


def test_ml_probability_verdict_does_not_count_as_measured() -> None:
    """`E2` **확률** 은 측정 가중을 받지 않는다. 안 그러면 같은 확률을 두 번 센다."""
    cards = [card("dm", "관심", 1.0)]
    ranked = sp.rank_suspects(cards, age=50, verdicts={"dm": verdict("E2", "CAUTION", measured=False)}, top_n=1)
    assert ranked[0]["basis"] == "예측"
    assert ranked[0]["level"] == "관심"


def test_e2_threshold_judgement_counts_as_measured() -> None:
    """같은 `E2` 라도 `judge()` 의 직접 대조는 **측정**이다.

    엔진 코드로 갈랐을 때 난 일: 규칙 엔진에 대응 영역이 없는 지질 하위유형 셋은
    `judge()` 가 검사값을 기준과 대조해 판정하는데, 그게 `E2` 라는 이유로 추정
    취급됐다. 그 결과 카드는 "입력한 검사값은 기준 안에 있어요" 라고 하고 패널은
    같은 항목을 '관심' 으로 경고했다.
    """
    cards = [card("low_hdl", "관심", 1.0)]
    ranked = sp.rank_suspects(cards, age=50, verdicts={"low_hdl": verdict("E2", "NORMAL", measured=True)}, top_n=1)
    assert ranked[0]["basis"] == "측정"
    assert ranked[0]["score"] == 0.0, "측정이 '기준 이내' 라고 했으면 추정 등급이 이를 뒤집지 못한다"
    assert ranked[0]["suspected"] is False


def test_settled_cards_fill_last() -> None:
    """자리채움은 측정이 이미 답한 카드보다 **아직 안 잰** 카드를 먼저 쓴다.

    `low_hdl` 모델은 HDL 을 못 본다(라벨이라 차단). 그래서 HDL 81 인 사람도 확률이
    높게 나올 수 있고, 동점을 확률로만 깨면 "낮은 HDL 콜레스테롤" 이 자리채움 1 등이
    된다 — 바로 위 카드가 "기준 안에 있어요" 라고 한 항목을 다시 띄우는 것이다.
    """
    cards = [
        card("low_hdl", "낮음", 1.0, probability=0.44),  # 측정이 정상이라 답했지만 확률은 높다
        card("fatty_liver", "낮음", 1.0, probability=0.11),  # 잰 적 없는 카드
    ]
    ranked = sp.rank_suspects(cards, age=50, verdicts={"low_hdl": verdict("E2", "NORMAL", measured=True)}, top_n=2)
    assert [r["target"] for r in ranked] == ["fatty_liver", "low_hdl"]
    assert all(r["suspected"] is False for r in ranked), "둘 다 자리채움이다"


def test_reason_says_where_the_signal_came_from() -> None:
    measured = sp.rank_suspects(
        [card("ckd", "낮음", 1.0)], age=50, verdicts={"ckd": verdict("E3", "CAUTION", measured=True)}, top_n=1
    )
    assert "입력한 검사값으로" in measured[0]["reason"]
    estimated = sp.rank_suspects([card("ckd", "주의", 1.0)], age=50, top_n=1)
    assert "검사값 없이 추정한" in estimated[0]["reason"]


# ---------------------------------------------------------------------------
# 3. 유병 궤적
# ---------------------------------------------------------------------------


def test_prevalence_curve_reports_model_values_as_is() -> None:
    curve = prevalence_curve(lambda age: 0.1 + 0.01 * (age - 40), 40.0)
    assert curve is not None
    assert curve["current_probability"] == pytest.approx(0.1)
    assert curve["prevalence_probability"] == [pytest.approx(0.1 + 0.01 * h) for h in curve["horizons_years"]]
    assert curve["direction"] == "상승"
    assert curve["irreversible"] is False


def test_irreversible_curve_never_falls() -> None:
    """비가역 질환에서 내려가는 구간은 GBDT 인공물이라 접는다."""
    dip = lambda age: {40: 0.40, 41: 0.35, 42: 0.30, 43: 0.30, 45: 0.30, 50: 0.30}.get(int(age), 0.30)  # noqa: E731
    plain = prevalence_curve(dip, 40.0)
    folded = prevalence_curve(dip, 40.0, irreversible=True)
    assert plain is not None and folded is not None
    assert plain["direction"] == "하락"
    assert folded["prevalence_probability"] == [pytest.approx(0.40)] * len(folded["horizons_years"])
    assert folded["direction"] == "유지"
    assert folded["irreversible"] is True


def test_reversible_curve_may_fall() -> None:
    """지질이 60대 이후 내려가는 것은 치료 시작과 선행 사망이라는 실제 현상이다."""
    curve = prevalence_curve(lambda age: max(0.1, 0.6 - 0.02 * (age - 60)), 60.0)
    assert curve is not None
    assert curve["direction"] == "하락"
    assert any("좋아진다는 뜻이 아닙니다" in c for c in curve["caveats"])


def test_prevalence_truncates_at_age_cap() -> None:
    curve = prevalence_curve(lambda age: 0.2, 75.0)
    assert curve is not None
    assert curve["horizons_years"] == [5], "75세는 5년만 자료 안에 든다"
    assert curve["truncated_at_age"] == 80
    assert prevalence_curve(lambda age: 0.2, 76.0) is None


# ---------------------------------------------------------------------------
# 4. 서빙 통합
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
    if not REPO_MODEL_DIR.is_dir() or not list(REPO_MODEL_DIR.glob("risk_*.json")):
        pytest.skip(f"서빙 번들이 없다: {REPO_MODEL_DIR}")
    return RiskModelRegistry(REPO_MODEL_DIR)


def test_served_response_carries_three_suspects_with_curves() -> None:
    from app.services.prediction import build_prediction

    data = build_prediction(RiskPredictionRequest(**SUSPECT), _registry())
    assert len(data.top_suspects) == 3
    assert [s.rank for s in data.top_suspects] == [1, 2, 3]
    scores = [s.score for s in data.top_suspects]
    assert scores == sorted(scores, reverse=True), "순위가 점수 순이 아니다"

    for suspect in data.top_suspects:
        curve = suspect.prevalence_trajectory
        assert curve is not None, f"{suspect.target}: 유병 궤적이 없다"
        # 유병 궤적의 t=0 은 카드 확률과 같아야 한다 — 다르면 화면에 두 숫자가 생긴다.
        matching = next(c for c in data.conditions if c.target == suspect.target)
        assert curve.current_probability == pytest.approx(matching.probability, abs=1e-3)
        if suspect.target in TRAJECTORY_TARGETS:
            assert curve.irreversible is True
            values = curve.prevalence_probability
            assert all(b >= a for a, b in zip(values, values[1:], strict=False))


def test_known_disease_drops_out_of_suspects() -> None:
    """규칙 엔진이 이미 판정한 질환은 통합 판정의 의심 목록에서 빠진다."""
    from app.services.prediction import build_prediction

    registry = _registry()
    plain = build_prediction(RiskPredictionRequest(**SUSPECT), registry)
    first = plain.top_suspects[0].target
    without = build_prediction(RiskPredictionRequest(**SUSPECT), registry, known={first})
    assert first not in {s.target for s in without.top_suspects}
    assert len(without.top_suspects) == 3


# ---------------------------------------------------------------------------
# 7. 확률 순위 (`RANK_SOURCE = "ml_probability"`)
#
#    규칙 엔진을 순위에서 뺀 경로. 위 §1~§6 이 지키던 것 중 **무엇이 꺼지는지**를
#    같이 고정한다 — 되돌릴 때 무엇을 되찾는지가 여기 적혀 있어야 한다.
# ---------------------------------------------------------------------------


@pytest.fixture
def probability_ranking(monkeypatch: pytest.MonkeyPatch) -> None:
    """확률 순위 + **후보 제한 없음**. 순위 규칙 자체를 보는 시험들이 쓴다."""
    monkeypatch.setattr(sp, "RANK_SOURCE", "ml_probability")
    monkeypatch.setattr(sp, "RANK_POOL", "all")


@pytest.fixture
def trajectory_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    """지금 배포되는 조합. 확률 순위 + 비가역 3종 안에서만."""
    monkeypatch.setattr(sp, "RANK_SOURCE", "ml_probability")
    monkeypatch.setattr(sp, "RANK_POOL", "trajectory")


def test_default_rank_source_is_the_recorded_product_decision() -> None:
    """지금 배포되는 기본값. 바꾸려면 이 줄을 같이 고쳐야 한다.

    **2026-09-07 에 `arbitrated` + `all` 로 되돌렸다.** 9/4 에 `ml_probability` 로
    바꾼 근거는 "확률만으로 열 질환을 세우면 곡선이 하나도 안 붙는다"(0/3)였는데,
    그건 `ml_probability + all` 의 문제였고 `arbitrated` 에는 해당하지 않았다.
    같은 프로필 120개로 세 방식을 재니 이렇게 갈렸다.

    | | `ml_prob`+`trajectory` | `ml_prob`+`all` | `arbitrated`+`all` |
    |---|---:|---:|---:|
    | 뽑힌 집합의 종류 | 1가지 | 15가지 | **20가지** |
    | 5·10년 곡선 붙은 카드 | 68% | 13% | 54% |
    | 확진(HIGH+) 유입 | 21% | 47% | **0%** |
    | 측정 정상인데 1순위 | 28% | 7% | **0%** |

    **같은 날 한 번 더 바꿨다 — `verdict`.** `arbitrated` 로도 카드와 패널이 갈렸다.
    당뇨 프리셋(공복혈당 148 · HbA1c 7.2)에서 카드 1·2위가 패널에 아예 없었다 —
    확진 제외가 당뇨병을, ML 번들 유무가 비만을 뺐기 때문이다. 제목이 "먼저 볼 세
    가지" 라 사용자는 "가장 급한 셋" 으로 읽는데 내용이 달랐다.

    `verdict` 는 카드 등급으로 세우고 같은 등급 안에서만 `arbitrated` 점수로 가른다.
    프로필 120개에서 **패널 등급이 카드 상위 3등급과 어긋난 경우 0건**, 뽑힌 셋
    42가지, 자리채움 0%.

    **대가는 곡선이다.** 5·10년 발병 곡선이 54% → 4% 로 떨어진다. 확진에는 "지금
    없다면 앞으로" 가 성립하지 않는데(궤적의 전제), 등급 순으로 세우면 맨 위가
    확진이라 그렇다. "가장 급한 셋" 과 "시계열이 붙는 셋" 은 서로 다른 목록이다.

    아래 `test_trajectory_pool_keeps_only_curve_capable_targets` 는 지우지 않는다 —
    `trajectory` 풀의 성질 자체는 그대로이고, 되돌릴 때 그 계약이 필요하다.
    """
    assert DEPLOYED_RANK_SOURCE == "verdict"
    assert DEPLOYED_RANK_POOL == "all"


def test_trajectory_pool_keeps_only_curve_capable_targets(trajectory_pool: None) -> None:
    """**뽑힌 셋이 전부 5년 곡선을 가질 수 있어야 한다.**

    확률만으로 열 질환을 세우면 유병률이 높은 이상지질·지방간·대사증후군이 올라오는데
    셋 다 발병 궤적이 없는 질환이라 2단계가 통째로 빈다(2026-09-04 실측 3/3).
    """
    cards = [
        card("dlp", "주의", probability=0.64),
        card("fatty_liver", "주의", probability=0.58),
        card("mets", "주의", probability=0.45),
        card("htn", "주의", probability=0.41),
        card("dm", "관심", probability=0.12),
        card("ckd", "낮음", probability=0.06),
    ]
    ranked = sp.rank_suspects(cards, age=52)
    assert [r["target"] for r in ranked] == ["htn", "dm", "ckd"]


def test_trajectory_pool_matches_the_trajectory_module(trajectory_pool: None) -> None:
    """후보 집합의 정본은 `trajectory.TRAJECTORY_TARGETS` 하나다. 여기 복사본을 두지 않는다."""
    cards = [card(t, "주의", probability=0.5) for t in ("dm", "htn", "ckd", "dlp", "anemia")]
    ranked = sp.rank_suspects(cards, age=52)
    assert {r["target"] for r in ranked} == set(TRAJECTORY_TARGETS)


def test_probability_ranking_orders_by_probability(probability_ranking: None) -> None:
    """확률 내림차순. 등급·근거가중·동년배배수를 보지 않는다."""
    cards = [
        card("ckd", "높음", ratio=3.0, probability=0.11),
        card("low_hdl", "낮음", ratio=1.0, probability=0.62),
        card("dm", "관심", ratio=1.0, probability=0.41),
    ]
    ranked = sp.rank_suspects(cards, age=52)
    assert [r["target"] for r in ranked] == ["low_hdl", "dm", "ckd"]
    assert ranked[0]["score"] == pytest.approx(0.62)


def test_probability_ranking_ignores_rule_engine_verdicts(probability_ranking: None) -> None:
    """측정으로 '주의' 를 받아도 순위가 올라가지 않는다 — 중재 경로와 갈리는 지점."""
    cards = [card("dm", "낮음", probability=0.20), card("low_hdl", "낮음", probability=0.55)]
    verdicts = {"dm": {"risk_level": "CAUTION", sp.MEASURED_FLAG: True}}
    ranked = sp.rank_suspects(cards, age=52, verdicts=verdicts)
    assert [r["target"] for r in ranked[:2]] == ["low_hdl", "dm"]


def test_probability_ranking_keeps_known_diseases(probability_ranking: None) -> None:
    """확진 질환도 후보에 남는다. 확률만 본다는 정의의 직접적인 결과다."""
    cards = [card("htn", "높음", probability=0.81), card("dm", "관심", probability=0.30)]
    ranked = sp.rank_suspects(cards, age=52, known={"htn"})
    assert ranked[0]["target"] == "htn"


def test_probability_ranking_reason_names_the_model(probability_ranking: None) -> None:
    """왜 뽑혔는지를 '검사값 없이 추정' 이라고 말하면 안 된다 — 검사값이 있을 수 있다."""
    ranked = sp.rank_suspects([card("dm", "주의", probability=0.44)], age=52)
    assert ranked[0]["basis"] == "확률"
    assert "예측 모델이 매긴 확률" in ranked[0]["reason"]


def test_probability_ranking_marks_low_grade_cards_as_not_suspected(probability_ranking: None) -> None:
    """확률은 0 이 되지 않으므로 등급으로 의심 여부를 가른다."""
    ranked = sp.rank_suspects([card("dm", "낮음", probability=0.44)], age=52)
    assert ranked[0]["suspected"] is False
