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

from app.dtos.predictions import (
    ConditionRisk,
    MedicalRisk,
    ModelAccuracy,
    RiskFactor,
    RiskPredictionData,
    RiskPredictionRequest,
    RuleAnchor,
    ThresholdJudgement,
)
from app.services.risk import RiskModelRegistry, peer_cell

# 화면에 반드시 함께 보여야 하는 문구. docs/20_prediction_inputs_and_levers.md 8절.
DISCLAIMERS = [
    "의료 진단이 아닙니다. 수치가 높게 나오면 재측정 후 의료기관 상담을 권합니다.",
    "미국 공개 데이터(NHANES·BRFSS·Framingham)로 학습했으며 한국인 보정을 하지 않았습니다.",
    "발병 예측이 아니라 현재 측정 기준을 넘을 가능성에 대한 선별 안내입니다.",
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


def build_prediction(payload: RiskPredictionRequest, models: RiskModelRegistry) -> RiskPredictionData:
    """질환별 카드 한 벌. 저장하지 않고 값만 돌려준다.

    호출자가 `models.available` 을 먼저 확인해야 한다 — 여기서는 예외를 던지지 않는다.
    라우터는 503 으로, 워커는 작업 실패로 다르게 처리해야 하므로 판단을 밖에 남긴다.
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
                medical=MedicalRisk(**model.medical_band(probability)),
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
            )
        )

    provided = len(payload.model_dump(exclude_none=True)) - 2  # height/weight -> bmi 하나로 센다
    return RiskPredictionData(
        bmi=payload.bmi,
        conditions=conditions,
        disclaimers=DISCLAIMERS,
        inputs_provided=provided,
        inputs_total=len(RiskPredictionRequest.model_fields),
    )
