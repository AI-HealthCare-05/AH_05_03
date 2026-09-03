"""질환별 위험도 응답을 만드는 한 곳.

**동기 라우터와 비동기 워커가 이 함수 하나를 공유해야 한다.** 원래 이 로직은
`app/apis/v1/prediction_routers.py` 의 핸들러 안에 인라인으로 있었다. 그대로 두고
워커에서 다시 쓰면 두 벌이 되고, 두 벌이 되는 순간 **같은 입력에 같은 답이 나온다는
보장이 사라진다** — 사용자가 예측 버튼을 두 번 눌렀을 때 동기 경로와 큐 경로의 숫자가
다르면 그건 설명할 수 없는 동작이다.

`docs/adr/0009` §1 이 질환별 독립 모델을 유지하는 근거로 "서빙이 JSON 계수와 순수
파이썬 내적이라 예측이 안 흔들린다"를 들었다. 경로를 하나 더 만들면서 그 성질을 깨지
않으려면 채점하는 코드가 하나여야 한다.
"""

from __future__ import annotations

from typing import Any

from app.dtos.predictions import (
    ConditionRisk,
    MedicalRisk,
    ModelAccuracy,
    OnsetTrajectory,
    PrevalenceTrajectory,
    RiskFactor,
    RiskPredictionData,
    RiskPredictionRequest,
    RuleAnchor,
    SuspectCard,
    ThresholdJudgement,
)
from app.services.risk import RiskModelRegistry, peer_cell
from app.services.suspects import rank_suspects
from app.services.trajectory import TRAJECTORY_TARGETS, prevalence_curve, project_condition

# 화면에 반드시 함께 보여야 하는 문구. docs/20_prediction_inputs_and_levers.md 8절.
DISCLAIMERS = [
    "의료 진단이 아닙니다. 수치가 높게 나오면 재측정 후 의료기관 상담을 권합니다.",
    "미국 공개 데이터(NHANES·BRFSS·Framingham)로 학습했으며 한국인 보정을 하지 않았습니다.",
    "카드의 확률은 발병 예측이 아니라 현재 측정 기준을 넘을 가능성입니다. "
    "발병 궤적은 지금 수치가 유지된다는 가정 아래의 추정이며 함께 적힌 주의를 같이 보세요.",
    "입력한 값은 저장하지 않습니다.",
]

TOP_FACTOR_COUNT = 4

# 카드 순서. 레지스트리에 있는 것 중 여기 적힌 것만, 이 순서로 내보낸다.
# 알파벳 순으로 두면 빈혈이 맨 위에 오고 당뇨가 중간에 묻힌다.
DISPLAY_ORDER = (
    "dm",
    "htn",
    "dlp",
    "hyperchol",
    "hypertg",
    "low_hdl",
    "mets",
    "ckd",
    "fatty_liver",
    "anemia",
)

# 비교 집단 표시 문구. 모델 참조표의 연령 구간과 같아야 한다.
PEER_AGE_LABELS = {
    "19_30": "20대",
    "30_40": "30대",
    "40_50": "40대",
    "50_60": "50대",
    "60_70": "60대",
    "70_200": "70대 이상",
}


def peer_group_label(age: int, sex: str) -> str:
    _, band = peer_cell(age, sex).split(":")
    return f"{PEER_AGE_LABELS.get(band, band)} {'남성' if sex == 'M' else '여성'}"


def score_conditions(
    payload: RiskPredictionRequest, models: RiskModelRegistry
) -> tuple[list[ConditionRisk], str, dict[str, Any]]:
    """**1단계.** 질환 카드 한 벌과, 2단계가 쓸 tier·특징 사전.

    호출자가 `models.available` 을 먼저 확인해야 한다 — 여기서는 예외를 던지지 않는다.
    라우터는 503 으로, 워커는 작업 실패로 다르게 처리해야 하므로 판단을 밖에 남긴다.

    순위를 여기서 매기지 않는 이유가 있다. 통합 판정(`assessment.assess`)은 규칙
    엔진의 판정까지 합쳐서 순위를 매겨야 하는데, 그 판정은 이 카드들이 나온 **뒤에**
    중재를 거쳐야 나온다. 그래서 채점과 순위를 갈라 두고 `rank_and_attach` 가
    두 경로에서 같은 규칙으로 순위를 매긴다.
    """
    features = payload.to_features()
    # 검사값을 냈으면 정밀형 번들을 쓴다. 그 질환의 정밀형이 없으면 레지스트리가
    # 알아서 일반형으로 내려가고, 응답의 tier 가 무엇을 썼는지 알려 준다.
    tier = "lab" if payload.labs_provided else "basic"

    conditions = []
    for target in [t for t in DISPLAY_ORDER if t in models.targets()]:
        model = models.get(target, tier)
        if model is None:
            continue

        # 확률과 기여도를 한 번의 트리 순회로 받는다. 따로 부르면 XGBoost 트리를
        # 두 번 걷고, 프로파일에서 그 두 번째가 요청 시간의 24% 였다.
        # 시드 앙상블이 아닌 번들은 합친 메서드가 없으므로 예전대로 두 번 부른다.
        scorer = getattr(model, "score_with_contributions", None)
        if scorer is not None:
            probability, ranked = scorer(features)
        else:
            probability = model.probability(features)
            ranked = model.contributions(features)

        percentile = model.peer_percentile(probability, payload.age, payload.sex)
        anchor = model.interpret(probability)
        judgement = model.judge(features)
        median = model.peer_median(payload.age, payload.sex)
        medical = model.medical_band(probability)
        # 2단계. 1단계가 의심한 질환(관문은 trajectory.gate)에만 앞으로의 누적 발병
        # 확률을 붙인다. 표 조회와 지수 몇 번이라 비용은 채점에 묻힌다.
        trajectory, trajectory_status = project_condition(
            target,
            probability,
            payload.age,
            payload.sex,
            medical_level=medical.get("level"),
            peer_percentile=percentile,
            judgement=judgement,
            config=models.trajectory,
        )
        factors = [RiskFactor(feature=name, contribution=round(value, 4)) for name, value in ranked[:TOP_FACTOR_COUNT]]
        conditions.append(
            ConditionRisk(
                target=target,
                description=model.description,
                name=model.name,
                tier=model.tier,  # type: ignore[arg-type]
                label_definition=model.definition,
                threshold_source=model.threshold_source,
                probability=round(probability, 4),
                medical=MedicalRisk(**medical),
                judgement=ThresholdJudgement(**judgement) if judgement else None,
                band=model.band(probability, percentile),  # type: ignore[arg-type]
                peer_group=peer_group_label(payload.age, payload.sex),
                peer_percentile=percentile,
                peer_median=round(median, 4) if median is not None else None,
                peer_ratio=(round(probability / median, 2) if median and median > 0 else None),
                alert=percentile is not None and percentile >= 90,
                model_auroc=round(model.holdout["auroc_nhanes"], 3),
                accuracy=ModelAccuracy(**model.accuracy()),
                rule_anchor=RuleAnchor(**anchor) if anchor else None,
                top_factors=factors,
                trajectory=OnsetTrajectory(**trajectory) if trajectory else None,
                trajectory_status=trajectory_status,  # type: ignore[arg-type]
            )
        )

    return conditions, tier, features


def rank_and_attach(
    conditions: list[ConditionRisk],
    payload: RiskPredictionRequest,
    models: RiskModelRegistry,
    tier: str,
    features: dict[str, Any],
    *,
    verdicts: dict[str, dict[str, Any]] | None = None,
    known: set[str] | None = None,
) -> list[SuspectCard]:
    """**1단계 → 2단계.** 의심 상위 세 개를 고르고 그 셋에만 곡선을 붙인다.

    열 장 전부에 붙이면 채점이 늘어나는데 화면이 읽는 것은 상위 세 장이다. 이것이
    비용이 다른 두 단계 사이에 라우팅을 두는 자리다.

    실측(2026-09-03, 컨테이너 안 중앙값 40 회): 1 단계만 9.9ms → 상위 3 장에 유병
    곡선까지 15.4ms → 열 장 전부 33.0ms. 관문이 예측 단계의 53% 를 덜어낸다.
    아끼는 대상은 **유병 곡선**이다 — 발병 궤적은 `trajectory.gate` 의 첫 질문에서
    일곱 타깃이 즉시 빠지므로 1 단계 루프 안에서 이미 싸다.

    `verdicts` 가 있으면 **규칙 엔진의 측정 기반 판정이 ML 추정보다 먼저** 쓰인다.
    `known` 은 이미 확진된 질환이라 후보에서 빠진다.
    """
    suspects = rank_suspects([c.model_dump() for c in conditions], float(payload.age), verdicts=verdicts, known=known)
    by_target = {c.target: c for c in conditions}
    for suspect in suspects:
        card = by_target.get(suspect["target"])
        model = models.get(suspect["target"], tier) if card else None
        if model is not None:

            def score_at(value: float, scorer: Any = model) -> float:
                return float(scorer.probability({**features, "age": float(value)}))

            curve = prevalence_curve(score_at, float(payload.age), irreversible=suspect["target"] in TRAJECTORY_TARGETS)
            if curve:
                suspect["prevalence_trajectory"] = curve
        if card is not None and card.trajectory is not None:
            suspect["onset_trajectory"] = card.trajectory.model_dump()
    return [
        SuspectCard(
            **{
                **s,
                "prevalence_trajectory": (
                    PrevalenceTrajectory(**s["prevalence_trajectory"]) if s["prevalence_trajectory"] else None
                ),
                "onset_trajectory": (OnsetTrajectory(**s["onset_trajectory"]) if s["onset_trajectory"] else None),
            }
        )
        for s in suspects
    ]


def build_prediction(
    payload: RiskPredictionRequest,
    models: RiskModelRegistry,
    known: set[str] | None = None,
    verdicts: dict[str, dict[str, Any]] | None = None,
) -> RiskPredictionData:
    """1단계 + 2단계를 한 번에. `/predictions/risk` 와 큐 워커가 쓴다.

    그 두 경로는 규칙 엔진을 부르지 않으므로 `verdicts` 가 비고 순위는 ML 등급만으로
    매겨진다. 통합 판정은 `score_conditions` → 중재 → `rank_and_attach` 로 따로
    조립해 규칙 판정을 순위에 넣는다.
    """
    conditions, tier, features = score_conditions(payload, models)
    top_suspects = rank_and_attach(conditions, payload, models, tier, features, verdicts=verdicts, known=known)

    provided = len(payload.model_dump(exclude_none=True)) - 2  # height/weight -> bmi 하나로 센다
    return RiskPredictionData(
        bmi=payload.bmi,
        conditions=conditions,
        top_suspects=top_suspects,
        disclaimers=DISCLAIMERS,
        inputs_provided=provided,
        inputs_total=len(RiskPredictionRequest.model_fields),
    )
