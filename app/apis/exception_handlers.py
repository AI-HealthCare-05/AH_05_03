from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core import config, default_logger
from app.core.errors import DEFAULT_MESSAGE, STATUS_FALLBACK_CODE, ErrorCode
from app.dtos.envelope import ErrorResponse
from app.exceptions import AppError


def _render(
    error_code: ErrorCode,
    message: str,
    status_code: int,
    headers: dict[str, str] | None = None,
    details: list[dict[str, Any]] | None = None,
) -> ORJSONResponse:
    body = ErrorResponse(
        error_code=error_code,
        message=message,
        details=details if config.API_ERROR_INCLUDE_DETAILS else None,
    )
    return ORJSONResponse(
        body.model_dump(mode="json", exclude_none=True),
        status_code=status_code,
        headers=headers,
    )


async def app_error_handler(request: Request, exc: Exception) -> ORJSONResponse:
    assert isinstance(exc, AppError)
    return _render(exc.error_code, exc.message, exc.status_code, exc.headers)


async def http_exception_handler(request: Request, exc: Exception) -> ORJSONResponse:
    """라우터가 올리는 404·405와 HTTPBearer의 401을 봉투로 바꾼다.

    fastapi.HTTPException이 아니라 starlette 쪽에 등록해야 한다. 전자는
    후자의 서브클래스라, 라우터가 직접 올리는 예외를 잡지 못한다.
    """
    assert isinstance(exc, StarletteHTTPException)
    code = STATUS_FALLBACK_CODE.get(exc.status_code, ErrorCode.INTERNAL_ERROR)
    message = exc.detail if isinstance(exc.detail, str) and exc.detail else DEFAULT_MESSAGE[code]
    # HTTPBearer의 WWW-Authenticate를 잃지 않도록 헤더를 보존한다.
    return _render(code, message, exc.status_code, getattr(exc, "headers", None))


async def validation_exception_handler(request: Request, exc: Exception) -> ORJSONResponse:
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


async def unhandled_exception_handler(request: Request, exc: Exception) -> ORJSONResponse:
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
