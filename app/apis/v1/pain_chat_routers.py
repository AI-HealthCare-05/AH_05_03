"""대화형 통증 기록 라우터. 인증·상한 근거는 `health_assistant_routers` 참조."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core import config
from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dependencies.services import get_rate_limiter
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.pain_chat import PainChatData, PainChatRequest
from app.models.service_accounts import ServiceAccount
from app.services.pain_chat import PainChatService
from app.services.rate_limit import RateLimiter

pain_chat_router = APIRouter(prefix="/pain-chat", tags=["pain-chat"])

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


def get_pain_chat_service() -> PainChatService:
    # `Depends(PainChatService)` 로 직접 걸면 FastAPI 가 생성자 인자(`llm_client`)를
    # 요청 필드로 해석해서 기동 자체가 실패한다. 팩토리로 감싼다.
    return PainChatService()


@pain_chat_router.post(
    "/messages",
    response_model=ApiResponse[PainChatData],
    responses=error_responses(*_ERRORS),
    summary="대화형 통증 기록 정보 추출",
)
async def send_pain_message(
    request: PainChatRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
    service: Annotated[PainChatService, Depends(get_pain_chat_service)],
) -> ApiResponse[PainChatData]:
    await limiter.hit(
        "pain-chat",
        str(account.id),
        config.LLM_CHAT_RATE_LIMIT,
        config.LLM_CHAT_RATE_WINDOW_SECONDS,
    )
    return ApiResponse(data=await service.respond(request.messages), message="통증 기록 초안을 업데이트했습니다.")
