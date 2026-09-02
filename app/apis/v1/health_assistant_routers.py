"""건강 어시스턴트(봄이) 대화 라우터.

**외부 유료 API 를 부르는 경로다.** `dev_ocr_routers._guard` 와 같은 이유로
인증만으로는 부족하고 계정별 상한이 함께 있어야 한다 — 한 계정이 조용히
할당량을 태우는 것을 막는다. 이 저장소의 다른 v1 라우터가 예외 없이
`require_active_account` 를 거는 것과도 같은 규칙이다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core import config
from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dependencies.services import get_rate_limiter
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.health_assistant import (
    HealthAssistantChatRequest,
    HealthAssistantResponse,
)
from app.models.service_accounts import ServiceAccount
from app.services.health_assistant import HealthAssistantService
from app.services.rate_limit import RateLimiter

health_assistant_router = APIRouter(prefix="/health-assistant", tags=["health-assistant"])

_ERRORS = (
    ErrorCode.AUTH_REQUIRED,
    ErrorCode.TOKEN_INVALID,
    ErrorCode.TOKEN_EXPIRED,
    ErrorCode.RATE_LIMITED,
    ErrorCode.VALIDATION_ERROR,
    # 503 은 우리 쪽 사정(키 없음)만. 업스트림 실패는 502, 지연은 504 로 가른다.
    ErrorCode.LLM_UNAVAILABLE,
    ErrorCode.LLM_PROVIDER_FAILED,
    ErrorCode.LLM_TIMEOUT,
)


def get_health_assistant_service() -> HealthAssistantService:
    return HealthAssistantService()


@health_assistant_router.post(
    "/chat",
    response_model=ApiResponse[HealthAssistantResponse],
    responses=error_responses(*_ERRORS),
    summary="통합 건강 어시스턴트(봄이) 자연어 대화 및 기록 초안 추출",
)
async def chat_with_assistant(
    request: HealthAssistantChatRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
    service: Annotated[HealthAssistantService, Depends(get_health_assistant_service)],
) -> ApiResponse[HealthAssistantResponse]:
    await limiter.hit(
        "health-assistant",
        str(account.id),
        config.LLM_CHAT_RATE_LIMIT,
        config.LLM_CHAT_RATE_WINDOW_SECONDS,
    )
    data = await service.respond(request)
    return ApiResponse(data=data, message="건강 어시스턴트 응답을 처리했습니다.")
