from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.core.errors import ErrorCode
from app.dependencies.security import get_access_token_payload
from app.dtos.auth import LoginRequest, RefreshRequest, SignUpData, SignUpRequest, TokenPairData
from app.dtos.envelope import ApiResponse, error_responses
from app.services.auth import AuthService

auth_router = APIRouter(prefix="/auth", tags=["auth"])


@auth_router.post(
    "/signup",
    status_code=status.HTTP_201_CREATED,
    response_model=ApiResponse[SignUpData],
    responses=error_responses(ErrorCode.EMAIL_ALREADY_REGISTERED),
    summary="서비스 계정 생성",
)
async def signup(
    request: SignUpRequest,
    auth_service: Annotated[AuthService, Depends(AuthService)],
) -> ApiResponse[SignUpData]:
    account = await auth_service.signup(request)
    return ApiResponse(data=SignUpData.model_validate(account), message="회원가입이 완료되었습니다.")


@auth_router.post(
    "/login",
    response_model=ApiResponse[TokenPairData],
    responses=error_responses(
        ErrorCode.CREDENTIALS_INVALID,
        ErrorCode.ACCOUNT_SUSPENDED,
        ErrorCode.ACCOUNT_CLOSED,
        ErrorCode.SERVICE_UNAVAILABLE,
    ),
    summary="로그인과 토큰 발급",
)
async def login(
    request: LoginRequest,
    auth_service: Annotated[AuthService, Depends(AuthService)],
) -> ApiResponse[TokenPairData]:
    account = await auth_service.authenticate(request)
    tokens = await auth_service.login(account)
    return ApiResponse(data=tokens, message="로그인이 완료되었습니다.")


@auth_router.post(
    "/refresh",
    response_model=ApiResponse[TokenPairData],
    responses=error_responses(
        ErrorCode.TOKEN_INVALID,
        ErrorCode.TOKEN_EXPIRED,
        ErrorCode.TOKEN_REVOKED,
        ErrorCode.TOKEN_REUSE_DETECTED,
        ErrorCode.ACCOUNT_NOT_FOUND,
        ErrorCode.ACCOUNT_SUSPENDED,
        ErrorCode.ACCOUNT_CLOSED,
        ErrorCode.SERVICE_UNAVAILABLE,
    ),
    summary="Access Token 갱신 (Refresh Token 회전)",
    description="인증=Refresh. Refresh Token은 요청 본문으로 전달한다.",
)
async def refresh(
    request: RefreshRequest,
    auth_service: Annotated[AuthService, Depends(AuthService)],
) -> ApiResponse[TokenPairData]:
    tokens = await auth_service.refresh(request.refresh_token)
    return ApiResponse(data=tokens, message="토큰이 갱신되었습니다.")


@auth_router.post(
    "/logout",
    response_model=ApiResponse[None],
    responses=error_responses(
        ErrorCode.AUTH_REQUIRED,
        ErrorCode.TOKEN_INVALID,
        ErrorCode.TOKEN_EXPIRED,
        ErrorCode.TOKEN_REVOKED,
        ErrorCode.SERVICE_UNAVAILABLE,
    ),
    summary="로그아웃",
)
async def logout(
    payload: Annotated[dict, Depends(get_access_token_payload)],
    auth_service: Annotated[AuthService, Depends(AuthService)],
) -> ApiResponse[None]:
    await auth_service.logout(payload)
    return ApiResponse[None](data=None, message="로그아웃되었습니다.")
