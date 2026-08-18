from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel

from app.core.errors import DEFAULT_MESSAGE, ERROR_STATUS, ErrorCode

DataT = TypeVar("DataT")


class ApiResponse(BaseModel, Generic[DataT]):
    """docs/03_api_spec.md 2절 성공 응답 봉투."""

    data: DataT
    message: str = ""
    success: Literal[True] = True


class ErrorResponse(BaseModel):
    """docs/03_api_spec.md 2절 오류 응답 봉투."""

    error_code: ErrorCode
    message: str
    success: Literal[False] = False
    # 규격 외 필드. config.API_ERROR_INCLUDE_DETAILS가 True일 때만 채운다.
    # 422 응답에 필드 정보가 없으면 FE가 어느 입력이 틀렸는지 알 수 없다.
    details: list[dict[str, Any]] | None = None


def error_responses(*codes: ErrorCode) -> dict[int | str, dict[str, Any]]:
    """OpenAPI `responses=`에 넣을 오류 스키마를 만든다.

    model과 content를 함께 줘도 안전하다. FastAPI가 model로 스키마를 세운 뒤
    content를 deep merge한다.
    """
    grouped: dict[int, list[ErrorCode]] = {}
    for code in codes:
        grouped.setdefault(ERROR_STATUS[code], []).append(code)

    return {
        http_status: {
            "model": ErrorResponse,
            "description": " / ".join(code.value for code in group),
            "content": {
                "application/json": {
                    "examples": {
                        code.value: {
                            "value": {
                                "error_code": code.value,
                                "message": DEFAULT_MESSAGE[code],
                                "success": False,
                            }
                        }
                        for code in group
                    }
                }
            },
        }
        for http_status, group in grouped.items()
    }
