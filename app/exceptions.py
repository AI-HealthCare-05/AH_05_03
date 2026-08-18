"""도메인 예외.

HTTPException이 아니라 Exception을 상속한다. 서비스 계층이 FastAPI로부터
자유로워져 앱 없이 단위 테스트가 되고, 같은 예외를 ai_worker가 재사용할 수도
있다. HTTP로의 변환은 app/apis/exception_handlers.py가 담당한다.

클래스명은 전부 Error로 끝나야 한다 (ruff N818).
"""

from app.core.errors import DEFAULT_MESSAGE, ERROR_STATUS, ErrorCode


class AppError(Exception):
    error_code: ErrorCode = ErrorCode.INTERNAL_ERROR

    def __init__(
        self,
        message: str | None = None,
        *,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.error_code = type(self).error_code
        self.status_code = status_code or ERROR_STATUS[self.error_code]
        self.message = message or DEFAULT_MESSAGE[self.error_code]
        self.headers = headers
        super().__init__(self.message)


# --- auth ----------------------------------------------------------------
class AuthRequiredError(AppError):
    error_code = ErrorCode.AUTH_REQUIRED

    def __init__(self, message: str | None = None) -> None:
        # RFC 6750 클라이언트를 위해 헤더를 유지한다.
        super().__init__(message, headers={"WWW-Authenticate": "Bearer"})


class CredentialsInvalidError(AppError):
    error_code = ErrorCode.CREDENTIALS_INVALID


class EmailAlreadyRegisteredError(AppError):
    error_code = ErrorCode.EMAIL_ALREADY_REGISTERED


class TokenInvalidError(AppError):
    error_code = ErrorCode.TOKEN_INVALID


class TokenExpiredError(AppError):
    error_code = ErrorCode.TOKEN_EXPIRED


class TokenRevokedError(AppError):
    error_code = ErrorCode.TOKEN_REVOKED


class TokenReuseDetectedError(AppError):
    error_code = ErrorCode.TOKEN_REUSE_DETECTED


class TokenStoreUnavailableError(AppError):
    error_code = ErrorCode.SERVICE_UNAVAILABLE


class OriginNotAllowedError(AppError):
    error_code = ErrorCode.ORIGIN_NOT_ALLOWED


# --- account -------------------------------------------------------------
class AccountNotFoundError(AppError):
    error_code = ErrorCode.ACCOUNT_NOT_FOUND


class AccountSuspendedError(AppError):
    error_code = ErrorCode.ACCOUNT_SUSPENDED


class AccountClosedError(AppError):
    error_code = ErrorCode.ACCOUNT_CLOSED


# --- subscription --------------------------------------------------------
class SubscriptionNotFoundError(AppError):
    error_code = ErrorCode.SUBSCRIPTION_NOT_FOUND


class SubscriptionInactiveError(AppError):
    error_code = ErrorCode.SUBSCRIPTION_INACTIVE


class PlanChangeNotAllowedError(AppError):
    error_code = ErrorCode.PLAN_CHANGE_NOT_ALLOWED
