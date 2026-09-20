from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response, status

from app.core import config
from app.core.errors import ErrorCode
from app.dependencies.services import get_rate_limiter
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.guardians import CivilMajorityInvalidationData, CivilMajorityInvalidationRequest
from app.services.guardians import GuardianService
from app.services.ops_recovery_policy import ops_recovery_client_identity
from app.services.rate_limit import RateLimiter

ops_recovery_router = APIRouter(prefix="/ops", tags=["ops-recovery"])


@ops_recovery_router.post(
    "/civil-majority-invalidations",
    response_model=ApiResponse[CivilMajorityInvalidationData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        ErrorCode.OPS_RECOVERY_FORBIDDEN,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.VALIDATION_ERROR,
        ErrorCode.RATE_LIMITED,
        ErrorCode.SERVICE_UNAVAILABLE,
    ),
    summary="개발·스테이징 전용 성년 전환 복구. 프로덕션에서는 거절한다",
)
async def create_civil_majority_invalidation(
    req: CivilMajorityInvalidationRequest,
    request: Request,
    response: Response,
    service: Annotated[GuardianService, Depends(GuardianService)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
    x_ops_recovery_key: Annotated[str, Header(alias="X-Ops-Recovery-Key")] = "",
) -> ApiResponse[CivilMajorityInvalidationData]:
    client_host = ops_recovery_client_identity(
        peer_host=request.client.host if request.client is not None else "unknown",
        x_forwarded_for=request.headers.get("x-forwarded-for"),
    )
    await limiter.hit(
        "ops-civil-majority",
        client_host,
        config.OPS_RECOVERY_RATE_LIMIT,
        config.OPS_RECOVERY_RATE_WINDOW_SECONDS,
    )
    await limiter.hit(
        "ops-civil-majority",
        "global",
        config.OPS_RECOVERY_RATE_LIMIT,
        config.OPS_RECOVERY_RATE_WINDOW_SECONDS,
    )
    data = await service.invalidate_civil_majority(req, recovery_key=x_ops_recovery_key)
    response.headers["Location"] = f"/api/v1/ops/civil-majority-invalidations/{data.id}"
    return ApiResponse(data=data, message="성년 전환 이력을 무효화했습니다. 기존 이벤트는 삭제하지 않습니다.")
