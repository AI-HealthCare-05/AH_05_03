"""만성질환 위험도 예측 엔드포인트.

**인증을 요구하고 계정 단위로 속도를 제한한다.** 저장은 하지 않는다 — 요청 본문의
건강정보는 응답을 만든 뒤 버려지며 DB·Redis·로그에 남기지 않는다. docs/adr/0002 의
"건강정보를 서버에 저장하지 않는다"를 지키는 방식이 여기서는 무상태 계산이다.

인증을 붙인 경위: 전에는 무인증이었다. 저장이 없으니 개인정보 위험은 낮지만 공개
엔드포인트가 건강 수치를 본문으로 받고 있었고, `docs/adr/0009` §10 이 이 경로를
`/api/v1` 에 공개하는 선행조건으로 인증·레이트리밋을 걸었다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core import config
from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dependencies.services import get_rate_limiter
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.predictions import RiskPredictionData, RiskPredictionRequest
from app.exceptions import AppError
from app.models import ServiceAccount
from app.services.prediction import build_prediction
from app.services.rate_limit import RateLimiter
from app.services.risk import RiskModelRegistry, registry

prediction_router = APIRouter(prefix="/predictions", tags=["predictions"])


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
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> ApiResponse[RiskPredictionData]:
    await limiter.hit(
        "predict",
        str(account.id),
        config.PREDICTION_RATE_LIMIT,
        config.PREDICTION_RATE_WINDOW_SECONDS,
    )
    if not models.available:
        raise ModelUnavailableError(
            "위험도 모델이 적재되지 않았습니다. modeling/export_model.py 실행 후 모델 파일을 마운트하세요."
        )

    data = build_prediction(payload, models)
    return ApiResponse(
        data=data,
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

    # 2단계 발병 궤적의 기준 위험표. **여기 없으면 카드가 조용히 궤적을 안 낸다** —
    # 파일이 빠져도 예측은 정상으로 보이고 `trajectory_status` 만 `unavailable` 이 된다.
    # 배포 점검이 그 결손을 눈으로 확인할 수 있어야 한다 (docs/41 §4.2).
    trajectory = models.trajectory
    return ApiResponse(
        data={
            "model_dir": str(models.directory),
            "trajectory": {
                "available": trajectory.available,
                "created_at": trajectory.created_at,
                "source": trajectory.source,
                "targets": sorted(trajectory.targets),
                # 검증(`validate_trajectory.py`)을 돌렸는지. 표만 있고 근거가 없으면
                # 화면의 `evidence` 블록이 빈다.
                "targets_with_evidence": sorted(key for key in trajectory.targets if trajectory.evidence(key)),
            },
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
