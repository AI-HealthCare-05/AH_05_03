"""만성질환 위험도 예측 엔드포인트.

인증을 요구하지 않고 아무것도 저장하지 않는다. 요청 본문의 건강정보는 응답을
만든 뒤 버려지며 DB·Redis·로그에 남기지 않는다. docs/adr/0002 의 "건강정보를
서버에 저장하지 않는다"를 지키는 방식이 여기서는 무상태 계산이다.

무인증 정책은 검토가 필요한 결정이다. 저장이 없으니 개인정보 위험은 낮지만,
공개 엔드포인트라 속도 제한이 필요하다. docs/03_api_spec.md 에 반영 전이다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.errors import ErrorCode
from app.dtos.envelope import ApiResponse, error_responses
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
from app.exceptions import AppError
from app.services.risk import RiskModelRegistry, registry

prediction_router = APIRouter(prefix="/predictions", tags=["predictions"])

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
    from app.services.risk import peer_cell

    _, band = peer_cell(age, sex).split(":")
    return f"{PEER_AGE_LABELS.get(band, band)} {'남성' if sex == 'M' else '여성'}"


class ModelUnavailableError(AppError):
    error_code = ErrorCode.SERVICE_UNAVAILABLE


def get_registry() -> RiskModelRegistry:
    # 모델 파일이 바뀌었으면 다시 읽는다. 재학습 후 컨테이너를 재시작하지
    # 않아도 새 계수가 반영된다.
    registry.refresh()
    return registry


@prediction_router.post(
    "/risk",
    response_model=ApiResponse[RiskPredictionData],
    responses=error_responses(ErrorCode.VALIDATION_ERROR, ErrorCode.SERVICE_UNAVAILABLE),
    summary="당뇨·고혈압 위험도 산출 (저장하지 않음)",
    description=(
        "필수 4개(나이·성별·키·몸무게·주관적 건강)만으로 동작한다. 선택 항목을 비우면 "
        "학습 시점 중앙값으로 대치하고 결측 지시자를 켠다.\n\n"
        "- 반환하는 `probability`는 **현재 측정 기준을 넘을 가능성**이며 발병 확률이 아니다.\n"
        "- `band`는 홀드아웃 분포의 백분위 기준이다. 임상 기준이 아니다.\n"
        "- `top_factors`는 로그오즈 기여도다. 개선 조언으로 그대로 쓰면 안 된다 "
        "(단면 데이터에서 금연·절주가 당뇨 위험을 올리는 방향으로 나온다).\n"
        "- 요청 본문은 응답 생성 후 폐기한다."
    ),
)
async def predict_risk(
    payload: RiskPredictionRequest,
    models: Annotated[RiskModelRegistry, Depends(get_registry)],
) -> ApiResponse[RiskPredictionData]:
    if not models.available:
        raise ModelUnavailableError(
            "위험도 모델이 적재되지 않았습니다. modeling/export_model.py 실행 후 모델 파일을 마운트하세요."
        )

    features = payload.to_features()
    # 검사값을 냈으면 정밀형 번들을 쓴다. 그 질환의 정밀형이 없으면 레지스트리가
    # 알아서 일반형으로 내려가고, 응답의 tier 가 무엇을 썼는지 알려 준다.
    tier = "lab" if payload.labs_provided else "basic"

    conditions = []
    for target in [t for t in DISPLAY_ORDER if t in models.targets()]:
        model = models.get(target, tier)
        if model is None:
            continue

        probability = model.probability(features)
        percentile = model.peer_percentile(probability, payload.age, payload.sex)
        anchor = model.interpret(probability)
        judgement = model.judge(features)
        median = model.peer_median(payload.age, payload.sex)
        factors = [
            RiskFactor(feature=name, contribution=round(value, 4))
            for name, value in model.contributions(features)[:TOP_FACTOR_COUNT]
        ]
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
    return ApiResponse(
        data=RiskPredictionData(
            bmi=payload.bmi,
            conditions=conditions,
            disclaimers=DISCLAIMERS,
            inputs_provided=provided,
            inputs_total=len(RiskPredictionRequest.model_fields),
        ),
        message="위험도를 산출했습니다. 입력값은 저장하지 않았습니다.",
    )


@prediction_router.get(
    "/model-info",
    responses=error_responses(ErrorCode.SERVICE_UNAVAILABLE),
    summary="적재된 위험도 모델 정보",
    description="모델 버전 확인과 배포 점검용. 계수는 노출하지 않는다.",
)
async def model_info(models: Annotated[RiskModelRegistry, Depends(get_registry)]) -> ApiResponse[dict]:
    if not models.available:
        raise ModelUnavailableError("위험도 모델이 적재되지 않았습니다.")

    return ApiResponse(
        data={
            "model_dir": str(models.directory),
            "models": [
                {
                    # target 은 질환, model_id 는 tier 까지 포함한 적재 키다.
                    # 같은 질환의 일반형·정밀형이 둘 다 있으므로 둘을 구분해야 한다.
                    "model_id": model.model_id,
                    "target": model.target,
                    "tier": model.tier,
                    "name": model.name,
                    "label_definition": model.definition,
                    "threshold_source": model.threshold_source,
                    "description": model.description,
                    "created_at": model.created_at,
                    "trained_rows": model.holdout.get("trained_rows"),
                    "required_inputs": model.required,
                    "optional_inputs": model.optional,
                    "holdout_auroc": round(model.holdout["auroc_nhanes"], 3),
                    "holdout_base_rate": round(model.holdout["base_rate_nhanes"], 3),
                    "bands": {k: round(v, 4) for k, v in model.bands.items()},
                    "limits": model.limits,
                }
                for model in models.models.values()
            ],
        },
        message="",
    )
