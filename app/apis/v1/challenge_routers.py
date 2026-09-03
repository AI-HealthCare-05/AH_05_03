import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app.core import config
from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dependencies.services import get_rate_limiter
from app.dtos.challenges import (
    ChallengeCheckRequest,
    ChallengeCheckResultData,
    ChallengeSettingsData,
    ChallengeSettingsRequest,
    ChallengeTodayData,
    GardenData,
    HouseholdGardenData,
)
from app.dtos.envelope import ApiResponse, error_responses
from app.models.service_accounts import ServiceAccount
from app.services.challenge import ChallengeService
from app.services.rate_limit import RateLimiter

challenge_router = APIRouter(prefix="/challenges", tags=["challenges"])

_AUTH_ERRORS = (
    ErrorCode.AUTH_REQUIRED,
    ErrorCode.TOKEN_INVALID,
    ErrorCode.TOKEN_EXPIRED,
    ErrorCode.TOKEN_REVOKED,
    ErrorCode.ACCOUNT_NOT_FOUND,
    ErrorCode.ACCOUNT_SUSPENDED,
    ErrorCode.ACCOUNT_CLOSED,
    ErrorCode.SERVICE_UNAVAILABLE,
)


@challenge_router.get(
    "/today",
    response_model=ApiResponse[ChallengeTodayData],
    responses=error_responses(*_AUTH_ERRORS),
    summary="오늘의 챌린지와 정원 상태",
)
async def get_today(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChallengeService, Depends(ChallengeService)],
) -> ApiResponse[ChallengeTodayData]:
    return ApiResponse(data=await service.today(account), message="오늘의 챌린지를 조회했습니다.")


@challenge_router.get(
    "/garden",
    response_model=ApiResponse[GardenData],
    responses=error_responses(*_AUTH_ERRORS),
    summary="내 나무 상태",
)
async def get_garden(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChallengeService, Depends(ChallengeService)],
) -> ApiResponse[GardenData]:
    return ApiResponse(data=await service.garden(account), message="나무 상태를 조회했습니다.")


@challenge_router.post(
    "/checks",
    response_model=ApiResponse[ChallengeCheckResultData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.CHALLENGE_NOT_FOUND, ErrorCode.RATE_LIMITED),
    summary="오늘 체크",
)
async def create_check(
    payload: ChallengeCheckRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChallengeService, Depends(ChallengeService)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> ApiResponse[ChallengeCheckResultData]:
    await limiter.hit(
        "challenge-check",
        str(account.id),
        config.CHALLENGE_CHECK_RATE_LIMIT,
        config.CHALLENGE_CHECK_RATE_WINDOW_SECONDS,
    )
    # 날짜를 받지 않는다. 오늘 자로만 기록되므로 지난 주를 소급해 채울 수 없다.
    result = await service.check(account, payload.challenge_id)
    message = "물을 주었습니다." if result.watered_now else "체크했습니다."
    return ApiResponse(data=result, message=message)


@challenge_router.delete(
    "/checks/{challenge_id}",
    response_model=ApiResponse[ChallengeCheckResultData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.CHALLENGE_NOT_FOUND, ErrorCode.RATE_LIMITED),
    summary="오늘 체크 해제",
)
async def delete_check(
    challenge_id: str,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChallengeService, Depends(ChallengeService)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> ApiResponse[ChallengeCheckResultData]:
    # 체크와 같은 창을 쓴다. 켰다 껐다를 반복하면 쓰기 비용은 똑같이 든다.
    await limiter.hit(
        "challenge-check",
        str(account.id),
        config.CHALLENGE_CHECK_RATE_LIMIT,
        config.CHALLENGE_CHECK_RATE_WINDOW_SECONDS,
    )
    return ApiResponse(data=await service.uncheck(account, challenge_id), message="체크를 해제했습니다.")


@challenge_router.get(
    "/households/{household_id}",
    response_model=ApiResponse[HouseholdGardenData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.HOUSEHOLD_NOT_FOUND),
    summary="가정 정원 — 나란한 나무와 순위",
)
async def get_household_garden(
    household_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChallengeService, Depends(ChallengeService)],
) -> ApiResponse[HouseholdGardenData]:
    return ApiResponse(
        data=await service.household_garden(household_id, account), message="가정 정원을 조회했습니다."
    )


@challenge_router.get(
    "/settings",
    response_model=ApiResponse[ChallengeSettingsData],
    responses=error_responses(*_AUTH_ERRORS),
    summary="챌린지 설정 — 모드 · 주간 목표 · 재는 날",
)
async def get_settings(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChallengeService, Depends(ChallengeService)],
) -> ApiResponse[ChallengeSettingsData]:
    return ApiResponse(data=await service.settings(account), message="챌린지 설정을 조회했습니다.")


@challenge_router.put(
    "/settings",
    response_model=ApiResponse[ChallengeSettingsData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.CHALLENGE_NOT_FOUND),
    summary="챌린지 설정 저장",
)
async def put_settings(
    payload: ChallengeSettingsRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChallengeService, Depends(ChallengeService)],
) -> ApiResponse[ChallengeSettingsData]:
    return ApiResponse(data=await service.save_settings(account, payload), message="챌린지 설정을 저장했습니다.")
