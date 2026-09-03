"""예측 작업 큐 엔드포인트. 사용자가 버튼을 누르면 여기로 들어와 Redis 에 쌓인다.

동기 경로(`POST /predictions/risk`)를 대체하지 않는다. 둘이 나란히 있고 화면이 고른다.

- **동기** — 즉시 답이 필요할 때. 왕복 26~29ms 로 제일 빠르다
- **비동기** — 워커가 순차 처리한다. 큐 깊이·워커 수·재시도를 관측할 수 있다

`docs/adr/0009` §7 은 예측을 동기로 정했고 그 판단은 지금도 유효하다. 이 경로를 만든
이유는 **큐와 워커 구조를 실제로 세워서 재고 배우기 위한 것**이고, 어느 쪽을 제품
기본으로 쓸지는 부하 측정 뒤에 정한다. `docs/35_prediction_queue_and_workers.md` 참조.

요청 본문은 Redis 해시에 TTL 과 함께 들어가고 채점이 끝나면 즉시 삭제된다
(ADR-010 §6). 응답에는 `job_id` 만 나가므로 폴링하는 쪽이 건강 수치를 다시 보낼 필요가 없다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from redis.asyncio import Redis

from app.apis.v1.prediction_routers import ModelUnavailableError, get_registry
from app.core import config
from app.core.errors import ErrorCode
from app.core.jobs import PredictionJobStore
from app.core.redis.client import get_redis
from app.dependencies.security import require_active_account
from app.dependencies.services import get_rate_limiter
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.prediction_jobs import PredictionJobAccepted, PredictionJobState
from app.dtos.predictions import RiskPredictionRequest
from app.exceptions import AppError
from app.models import ServiceAccount
from app.services.rate_limit import RateLimiter
from app.services.risk import RiskModelRegistry

prediction_job_router = APIRouter(prefix="/predictions/jobs", tags=["predictions"])


class JobNotFoundError(AppError):
    error_code = ErrorCode.NOT_FOUND
    status_code = status.HTTP_404_NOT_FOUND


def get_store(redis: Annotated[Redis, Depends(get_redis)]) -> PredictionJobStore:
    return PredictionJobStore(redis)


@prediction_job_router.post(
    "",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ApiResponse[PredictionJobAccepted],
    responses=error_responses(ErrorCode.VALIDATION_ERROR, ErrorCode.SERVICE_UNAVAILABLE),
    summary="예측 작업을 큐에 넣는다 (비동기)",
    description=(
        "본문 검증은 여기서 끝낸다 — 잘못된 입력이 큐에 들어가면 워커가 반복해서 실패한다.\n\n"
        f"작업 해시는 {config.PREDICTION_JOB_TTL_SECONDS}초 뒤 사라지고, 채점이 끝나면 "
        "요청 본문은 즉시 삭제된다. 결과는 `GET /predictions/jobs/{job_id}` 로 받는다."
    ),
)
async def enqueue_prediction(
    payload: RiskPredictionRequest,
    store: Annotated[PredictionJobStore, Depends(get_store)],
    models: Annotated[RiskModelRegistry, Depends(get_registry)],
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> ApiResponse[PredictionJobAccepted]:
    # 동기 경로보다 조인다. 큐는 한 계정이 채우면 **다른 사용자의 작업이 밀린다** —
    # 무상태 계산인 동기 경로와 달리 남에게 피해가 간다.
    await limiter.hit(
        "predict-job",
        str(account.id),
        config.PREDICTION_JOB_RATE_LIMIT,
        config.PREDICTION_JOB_RATE_WINDOW_SECONDS,
    )

    # **모델 적재를 여기서 확인한다.** 안 하면 202 를 주고 워커가 세 번 재시도한 뒤
    # 실패시키는데, 재배달이 `PREDICTION_JOB_RECLAIM_IDLE_MS`(60초) 간격이라
    # 사용자가 3 분을 기다린 끝에 실패를 본다. 동기 경로는 같은 상황에서 즉시 503 이다.
    # 두 경로가 같은 조건에서 다르게 답하면 안 된다.
    if not models.available:
        raise ModelUnavailableError("위험도 모델이 적재되지 않았습니다. modeling/artifacts/models 마운트를 확인하세요.")

    # 검증은 생산자에서 끝낸다. `RiskPredictionRequest` 가 이미 범위·타입을 막았으므로
    # 이 지점을 통과한 본문은 워커에서 스키마 때문에 실패하지 않는다.
    #
    # **`include` 로 선언 필드만 담는 이유가 있다.** 맨 `model_dump()` 는 `computed_field`
    # 인 `bmi` 까지 넣는데, DTO 가 `extra="forbid"` 라서 워커가 그걸 되검증할 때
    # "선언에 없는 키"로 거부한다. 실제로 첫 판이 그렇게 실패했다 — 큐를 건너
    # 되검증하는 경로에서만 드러나는 문제라 동기 경로에는 증상이 없었다.
    job_id = await store.enqueue(payload.model_dump(exclude_none=True, include=set(RiskPredictionRequest.model_fields)))
    return ApiResponse(
        data=PredictionJobAccepted(
            job_id=job_id,
            status="queued",
            poll_after_ms=200,
            expires_in_seconds=config.PREDICTION_JOB_TTL_SECONDS,
        ),
        message="예측 작업을 큐에 넣었습니다.",
    )


@prediction_job_router.get(
    "/{job_id}",
    response_model=ApiResponse[PredictionJobState],
    responses=error_responses(ErrorCode.NOT_FOUND),
    summary="예측 작업 상태와 결과",
    description=(
        "`status` 가 `succeeded` 면 `result` 에 동기 경로와 **같은 모양의** 응답이 담긴다.\n\n"
        "`queued` · `running` 이면 `poll_after_ms` 뒤에 다시 조회한다. 작업 해시는 TTL 이 있어 "
        "만료 후에는 404 다 — 결과를 오래 보관하지 않는다."
    ),
)
async def read_prediction_job(
    job_id: str,
    store: Annotated[PredictionJobStore, Depends(get_store)],
    account: Annotated[ServiceAccount, Depends(require_active_account)],
) -> ApiResponse[PredictionJobState]:
    # 조회도 인증을 요구한다. `job_id` 가 128 비트라 추측은 불가능하지만, 결과에는
    # 질환별 판정이 담기므로 공개로 둘 이유가 없다. 계정 소유 검사는 하지 않는다 —
    # 작업 해시에 계정 식별자를 넣지 않기로 했기 때문이다(ADR-010 §6). 무작위
    # job_id 를 아는 것 자체가 접근 자격이고, 그 위에 로그인을 한 겹 더 얹는다.
    _ = account

    fields = await store.read(job_id)
    if fields is None:
        raise JobNotFoundError("해당 예측 작업을 찾을 수 없거나 보관 기간이 지났습니다.")
    return ApiResponse(
        data=PredictionJobState.from_fields(job_id, fields),
        message="작업 상태를 조회했습니다.",
    )
