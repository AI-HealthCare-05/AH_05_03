from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.core import config
from app.core.errors import ErrorCode
from app.dependencies.security import get_access_token_payload, get_refresh_token_cookie, require_trusted_origin
from app.dtos.auth import AccessTokenData, LoginRequest, SignUpData, SignUpRequest
from app.dtos.envelope import ApiResponse, error_responses
from app.services.auth import AuthService, IssuedTokens

auth_router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(require_trusted_origin)])


def _set_refresh_cookie(response: Response, tokens: IssuedTokens) -> None:
    response.set_cookie(
        key=config.REFRESH_COOKIE_NAME,
        value=tokens.refresh_token,
        max_age=tokens.refresh_expires_in,
        path=config.REFRESH_COOKIE_PATH,
        secure=config.REFRESH_COOKIE_SECURE,
        httponly=True,
        samesite=config.REFRESH_COOKIE_SAMESITE,
    )


def _delete_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=config.REFRESH_COOKIE_NAME,
        path=config.REFRESH_COOKIE_PATH,
        secure=config.REFRESH_COOKIE_SECURE,
        httponly=True,
        samesite=config.REFRESH_COOKIE_SAMESITE,
    )


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
    response_model=ApiResponse[AccessTokenData],
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
    response: Response,
    auth_service: Annotated[AuthService, Depends(AuthService)],
) -> ApiResponse[AccessTokenData]:
    account = await auth_service.authenticate(request)
    tokens = await auth_service.login(account)
    _set_refresh_cookie(response, tokens)
    return ApiResponse(data=tokens.access, message="로그인이 완료되었습니다.")


@auth_router.post(
    "/refresh",
    response_model=ApiResponse[AccessTokenData],
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
    description="Refresh Token은 Secure HttpOnly 쿠키로만 전달하며 매번 회전한다.",
)
async def refresh(
    response: Response,
    raw_refresh_token: Annotated[str, Depends(get_refresh_token_cookie)],
    auth_service: Annotated[AuthService, Depends(AuthService)],
) -> ApiResponse[AccessTokenData]:
    tokens = await auth_service.refresh(raw_refresh_token)
    _set_refresh_cookie(response, tokens)
    return ApiResponse(data=tokens.access, message="토큰이 갱신되었습니다.")


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
    response: Response,
    payload: Annotated[dict, Depends(get_access_token_payload)],
    auth_service: Annotated[AuthService, Depends(AuthService)],
) -> ApiResponse[None]:
    await auth_service.logout(payload)
    _delete_refresh_cookie(response)
    return ApiResponse[None](data=None, message="로그아웃되었습니다.")
