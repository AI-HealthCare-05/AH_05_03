import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dtos.chat_session import (
    ChatMessageCreateRequest,
    ChatMessageListData,
    ChatMessageResponse,
    ChatSessionCreateRequest,
    ChatSessionListData,
    ChatSessionResponse,
)
from app.dtos.envelope import ApiResponse, error_responses
from app.models.service_accounts import ServiceAccount
from app.services.chat_session_service import ChatSessionService

chat_session_router = APIRouter(prefix="/chat-sessions", tags=["chat-sessions"])

_AUTH_ERRORS = (
    ErrorCode.AUTH_REQUIRED,
    ErrorCode.TOKEN_INVALID,
    ErrorCode.TOKEN_EXPIRED,
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.CHAT_SESSION_NOT_FOUND,
)


@chat_session_router.post(
    "",
    response_model=ApiResponse[ChatSessionResponse],
    responses=error_responses(*_AUTH_ERRORS),
    summary="가족 프로필 대화 세션 생성",
)
async def create_chat_session(
    request: ChatSessionCreateRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChatSessionService, Depends(ChatSessionService)],
) -> ApiResponse[ChatSessionResponse]:
    session = await service.create_session(
        account=account,
        profile_id=request.profile_id,
        title=request.title,
    )
    return ApiResponse(
        data=ChatSessionResponse.model_validate(session),
        message="대화 세션을 생성했습니다.",
    )


@chat_session_router.get(
    "",
    response_model=ApiResponse[ChatSessionListData],
    responses=error_responses(*_AUTH_ERRORS),
    summary="가족 프로필 대화 세션 목록 조회",
)
async def list_chat_sessions(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChatSessionService, Depends(ChatSessionService)],
    profile_id: Annotated[str | None, Query(description="가족 프로필 식별자 필터")] = None,
    limit: Annotated[int, Query(ge=1, le=100, description="조회 개수")] = 50,
) -> ApiResponse[ChatSessionListData]:
    sessions = await service.list_sessions(account=account, profile_id=profile_id, limit=limit)
    return ApiResponse(
        data=ChatSessionListData(
            items=[ChatSessionResponse.model_validate(s) for s in sessions],
            total=len(sessions),
        ),
        message="대화 세션 목록을 조회했습니다.",
    )


@chat_session_router.get(
    "/{session_id}",
    response_model=ApiResponse[ChatSessionResponse],
    responses=error_responses(*_AUTH_ERRORS),
    summary="대화 세션 단건 상세 조회",
)
async def get_chat_session(
    session_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChatSessionService, Depends(ChatSessionService)],
) -> ApiResponse[ChatSessionResponse]:
    session = await service.get_session(account=account, session_id=session_id)
    return ApiResponse(
        data=ChatSessionResponse.model_validate(session),
        message="대화 세션을 조회했습니다.",
    )


@chat_session_router.delete(
    "/{session_id}",
    response_model=ApiResponse[None],
    responses=error_responses(*_AUTH_ERRORS),
    summary="대화 세션 삭제 (소프트 딜리트)",
)
async def delete_chat_session(
    session_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChatSessionService, Depends(ChatSessionService)],
) -> ApiResponse[None]:
    await service.delete_session(account=account, session_id=session_id)
    return ApiResponse(data=None, message="대화 세션을 삭제했습니다.")


@chat_session_router.get(
    "/{session_id}/messages",
    response_model=ApiResponse[ChatMessageListData],
    responses=error_responses(*_AUTH_ERRORS),
    summary="대화 세션 메시지 이력 조회",
)
async def list_chat_messages(
    session_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChatSessionService, Depends(ChatSessionService)],
    limit: Annotated[int, Query(ge=1, le=200, description="조회할 메시지 개수")] = 100,
) -> ApiResponse[ChatMessageListData]:
    messages = await service.list_messages(account=account, session_id=session_id, limit=limit)
    return ApiResponse(
        data=ChatMessageListData(
            session_id=session_id,
            items=[ChatMessageResponse.model_validate(m) for m in messages],
        ),
        message="메시지 목록을 조회했습니다.",
    )


@chat_session_router.post(
    "/{session_id}/messages",
    response_model=ApiResponse[ChatMessageResponse],
    responses=error_responses(*_AUTH_ERRORS),
    summary="대화 세션 메시지 단건 추가",
)
async def create_chat_message(
    session_id: uuid.UUID,
    request: ChatMessageCreateRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ChatSessionService, Depends(ChatSessionService)],
) -> ApiResponse[ChatMessageResponse]:
    message = await service.add_message(
        account=account,
        session_id=session_id,
        role=request.role,
        content=request.content,
    )
    return ApiResponse(
        data=ChatMessageResponse.model_validate(message),
        message="메시지를 추가했습니다.",
    )
