"""건강 어시스턴트(봄이) 대화 라우터.

**외부 유료 API 를 부르는 경로다.** `dev_ocr_routers._guard` 와 같은 이유로
인증만으로는 부족하고 계정별 상한이 함께 있어야 한다 — 한 계정이 조용히
할당량을 태우는 것을 막는다. 이 저장소의 다른 v1 라우터가 예외 없이
`require_active_account` 를 거는 것과도 같은 규칙이다.
"""

import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

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


@health_assistant_router.post(
    "/chat/stream",
    responses=error_responses(*_ERRORS),
    summary="같은 대화를 SSE 로 흘린다 — 글자가 오는 대로 보여 주기 위해",
)
async def stream_chat_with_assistant(
    request: HealthAssistantChatRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
    service: Annotated[HealthAssistantService, Depends(get_health_assistant_service)],
) -> StreamingResponse:
    """`text/event-stream`. 두 이벤트를 보낸다.

    - `delta` — `assistant_message` 의 **새로 온 부분만**.
    - `result` — 완성된 구조화 응답 한 벌. 기록 초안·빠른답장·응급 안내가 여기 있다.

    왜 둘로 가르나. 초안은 JSON 이 끝나야 유효해지고 안전 검증도 완성본에만 걸 수
    있다 — 덜 온 문장으로 응급 판정을 하면 "가슴이 아" 에서 119 를 띄우거나 반대로
    놓친다.

    `EventSource` 는 헤더를 못 붙이므로 프런트는 `fetch` + `ReadableStream` 으로
    읽는다. 그래야 `Authorization` 이 실린다 (`/dev/ocr/jobs/{id}/stream` 과 같은 규칙).
    """
    await limiter.hit(
        "health-assistant",
        str(account.id),
        config.LLM_CHAT_RATE_LIMIT,
        config.LLM_CHAT_RATE_WINDOW_SECONDS,
    )

    async def frames() -> AsyncIterator[str]:
        try:
            async for name, payload in service.stream(request):
                body = json.dumps(payload, ensure_ascii=False)
                yield f"event: {name}\ndata: {body}\n\n"
        except Exception as error:  # noqa: BLE001 - 이미 200 이라 프레임으로 알린다
            # 200 으로 열린 뒤에는 오류 봉투를 쓸 수 없다. 프런트가 읽을 수 있게
            # `error` 프레임으로 알리고 끊는다 — 조용히 끝나면 화면이 영영 기다린다.
            body = json.dumps({"message": str(error)}, ensure_ascii=False)
            yield f"event: error\ndata: {body}\n\n"

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # nginx 가 응답을 모아 두면 조각이 한꺼번에 나가 스트리밍이 뜻을 잃는다.
            "X-Accel-Buffering": "no",
        },
    )
