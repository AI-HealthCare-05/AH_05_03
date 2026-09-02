from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core import config, default_logger
from app.core.errors import DEFAULT_MESSAGE, STATUS_FALLBACK_CODE, ErrorCode
from app.dtos.envelope import ErrorResponse
from app.exceptions import AppError


# **`ORJSONResponse` 에서 옮겨 왔다.** FastAPI 가 deprecate 했다 — 이제는 반환 타입이
# 선언돼 있으면 Pydantic 이 직접 JSON 바이트를 만들어서 커스텀 클래스가 더 느리다.
# 예외 핸들러는 라우트가 아니라 Response 를 손으로 만드는 자리라 응답 클래스가 필요한데,
# 여기서 쓰는 값은 `model_dump(mode="json")` 을 거친 순수 dict 라 기본 `JSONResponse`
# 로 그대로 직렬화된다. 봉투 모양은 `test_envelope_contract.py` 가 잡고 있다.
def _render(
    error_code: ErrorCode,
    message: str,
    status_code: int,
    headers: dict[str, str] | None = None,
    details: list[dict[str, Any]] | None = None,
) -> JSONResponse:
    body = ErrorResponse(
        error_code=error_code,
        message=message,
        details=details if config.API_ERROR_INCLUDE_DETAILS else None,
    )
    return JSONResponse(
        body.model_dump(mode="json", exclude_none=True),
        status_code=status_code,
        headers=headers,
    )


async def app_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    # **5xx 는 원인을 남긴다.** 4xx 는 사용자가 잘못 보낸 것이라 로그가 필요 없지만,
    # 5xx 는 우리 쪽 사고다. 예전에는 여기서 아무것도 안 찍어서 `TokenStoreUnavailableError`
    # 가 503 으로 나가도 로그에 `POST /api/v1/auth/login 503` 한 줄뿐이었다 — 원인이
    # Redis 풀 고갈이라는 것을 알아내려고 같은 설정을 따로 재현해야 했다.
    #
    # `raise ... from err` 로 붙여 둔 원인을 함께 찍는다. 본문·헤더는 찍지 않는다
    # (비밀번호·토큰이 들어 있다 — docs/05_tech_architecture.md 7절 로그 규칙).
    if exc.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        cause = exc.__cause__
        default_logger.warning(
            "%s %s -> %d %s%s",
            request.method,
            request.url.path,
            exc.status_code,
            exc.error_code,
            f" · 원인 {type(cause).__name__}: {cause}" if cause else "",
        )
    return _render(exc.error_code, exc.message, exc.status_code, exc.headers)


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """라우터가 올리는 404·405와 HTTPBearer의 401을 봉투로 바꾼다.

    fastapi.HTTPException이 아니라 starlette 쪽에 등록해야 한다. 전자는
    후자의 서브클래스라, 라우터가 직접 올리는 예외를 잡지 못한다.
    """
    assert isinstance(exc, StarletteHTTPException)
    code = STATUS_FALLBACK_CODE.get(exc.status_code, ErrorCode.INTERNAL_ERROR)
    message = exc.detail if isinstance(exc.detail, str) and exc.detail else DEFAULT_MESSAGE[code]
    # HTTPBearer의 WWW-Authenticate를 잃지 않도록 헤더를 보존한다.
    return _render(code, message, exc.status_code, getattr(exc, "headers", None))


async def validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    # exc.errors()의 "input"에는 평문 비밀번호가 들어 있을 수 있다.
    # 절대 담지 않는다 (docs/05_tech_architecture.md 7절 로그 규칙).
    details: list[dict[str, Any]] = [
        {
            "field": ".".join(str(part) for part in err["loc"][1:]),
            "message": err["msg"],
            "type": err["type"],
        }
        for err in exc.errors()
    ]
    message = "; ".join(f"{d['field']}: {d['message']}" for d in details) or DEFAULT_MESSAGE[ErrorCode.VALIDATION_ERROR]
    return _render(
        ErrorCode.VALIDATION_ERROR,
        message,
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        details=details,
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    default_logger.exception("unhandled error: %s %s", request.method, request.url.path)
    return _render(
        ErrorCode.INTERNAL_ERROR,
        DEFAULT_MESSAGE[ErrorCode.INTERNAL_ERROR],
        status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


def register_exception_handlers(app: FastAPI) -> None:
    # AppError 하나만 걸면 Starlette의 MRO 탐색이 모든 서브클래스를 잡는다.
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
