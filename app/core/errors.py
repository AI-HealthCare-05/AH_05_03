"""오류 코드 정본.

docs/03_api_spec.md 2절은 오류 봉투에 `error_code`를 요구하는데, 7절 표는
초대·프로필·기기 7종만 정의한다. 인증·계정·구독 실패용 코드가 하나도 없어
여기서 신설한다. 명명은 7절과 같은 DOMAIN_CONDITION SCREAMING_SNAKE.
"""

from starlette import status

from app.core.utils.enums import StrEnum


class ErrorCode(StrEnum):
    # --- generic ---------------------------------------------------
    VALIDATION_ERROR = "VALIDATION_ERROR"
    NOT_FOUND = "NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    RATE_LIMITED = "RATE_LIMITED"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    # --- auth ------------------------------------------------------
    AUTH_REQUIRED = "AUTH_REQUIRED"
    CREDENTIALS_INVALID = "CREDENTIALS_INVALID"
    EMAIL_ALREADY_REGISTERED = "EMAIL_ALREADY_REGISTERED"
    TOKEN_INVALID = "TOKEN_INVALID"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"
    TOKEN_REVOKED = "TOKEN_REVOKED"
    TOKEN_REUSE_DETECTED = "TOKEN_REUSE_DETECTED"
    ORIGIN_NOT_ALLOWED = "ORIGIN_NOT_ALLOWED"
    # --- account ---------------------------------------------------
    ACCOUNT_NOT_FOUND = "ACCOUNT_NOT_FOUND"
    ACCOUNT_SUSPENDED = "ACCOUNT_SUSPENDED"
    ACCOUNT_CLOSED = "ACCOUNT_CLOSED"
    # --- subscription ----------------------------------------------
    SUBSCRIPTION_NOT_FOUND = "SUBSCRIPTION_NOT_FOUND"
    SUBSCRIPTION_INACTIVE = "SUBSCRIPTION_INACTIVE"
    PLAN_CHANGE_NOT_ALLOWED = "PLAN_CHANGE_NOT_ALLOWED"
    # --- household / invitation ------------------------------------
    HOUSEHOLD_NOT_FOUND = "HOUSEHOLD_NOT_FOUND"
    HOUSEHOLD_MEMBERSHIP_REQUIRED = "HOUSEHOLD_MEMBERSHIP_REQUIRED"
    INVITATION_NOT_FOUND = "INVITATION_NOT_FOUND"
    INVITATION_ALREADY_PENDING = "INVITATION_ALREADY_PENDING"
    INVITATION_SELF_NOT_ALLOWED = "INVITATION_SELF_NOT_ALLOWED"
    INVITATION_EXPIRED = "INVITATION_EXPIRED"
    INVITATION_STATE_CONFLICT = "INVITATION_STATE_CONFLICT"
    INVITATION_TOKEN_INVALID = "INVITATION_TOKEN_INVALID"
    INVITATION_TOKEN_REUSED = "INVITATION_TOKEN_REUSED"
    PROFILE_REFERENCE_ALREADY_USED = "PROFILE_REFERENCE_ALREADY_USED"


ERROR_STATUS: dict[ErrorCode, int] = {
    ErrorCode.VALIDATION_ERROR: status.HTTP_422_UNPROCESSABLE_CONTENT,
    ErrorCode.NOT_FOUND: status.HTTP_404_NOT_FOUND,
    ErrorCode.METHOD_NOT_ALLOWED: status.HTTP_405_METHOD_NOT_ALLOWED,
    ErrorCode.RATE_LIMITED: status.HTTP_429_TOO_MANY_REQUESTS,
    ErrorCode.SERVICE_UNAVAILABLE: status.HTTP_503_SERVICE_UNAVAILABLE,
    ErrorCode.INTERNAL_ERROR: status.HTTP_500_INTERNAL_SERVER_ERROR,
    ErrorCode.AUTH_REQUIRED: status.HTTP_401_UNAUTHORIZED,
    ErrorCode.CREDENTIALS_INVALID: status.HTTP_401_UNAUTHORIZED,
    ErrorCode.EMAIL_ALREADY_REGISTERED: status.HTTP_409_CONFLICT,
    ErrorCode.TOKEN_INVALID: status.HTTP_401_UNAUTHORIZED,
    ErrorCode.TOKEN_EXPIRED: status.HTTP_401_UNAUTHORIZED,
    ErrorCode.TOKEN_REVOKED: status.HTTP_401_UNAUTHORIZED,
    ErrorCode.TOKEN_REUSE_DETECTED: status.HTTP_401_UNAUTHORIZED,
    ErrorCode.ORIGIN_NOT_ALLOWED: status.HTTP_403_FORBIDDEN,
    # 행은 지워지지 않으므로 "일어날 수 없는" 경로다. 404 대신 401을 주어
    # 재인증을 유도하고, sub의 존재 여부도 노출하지 않는다.
    ErrorCode.ACCOUNT_NOT_FOUND: status.HTTP_401_UNAUTHORIZED,
    ErrorCode.ACCOUNT_SUSPENDED: status.HTTP_403_FORBIDDEN,
    ErrorCode.ACCOUNT_CLOSED: status.HTTP_403_FORBIDDEN,
    ErrorCode.SUBSCRIPTION_NOT_FOUND: status.HTTP_404_NOT_FOUND,
    ErrorCode.SUBSCRIPTION_INACTIVE: status.HTTP_409_CONFLICT,
    ErrorCode.PLAN_CHANGE_NOT_ALLOWED: status.HTTP_409_CONFLICT,
    ErrorCode.HOUSEHOLD_NOT_FOUND: status.HTTP_404_NOT_FOUND,
    ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED: status.HTTP_403_FORBIDDEN,
    ErrorCode.INVITATION_NOT_FOUND: status.HTTP_404_NOT_FOUND,
    ErrorCode.INVITATION_ALREADY_PENDING: status.HTTP_409_CONFLICT,
    ErrorCode.INVITATION_SELF_NOT_ALLOWED: status.HTTP_400_BAD_REQUEST,
    ErrorCode.INVITATION_EXPIRED: status.HTTP_410_GONE,
    ErrorCode.INVITATION_STATE_CONFLICT: status.HTTP_409_CONFLICT,
    ErrorCode.INVITATION_TOKEN_INVALID: status.HTTP_403_FORBIDDEN,
    ErrorCode.INVITATION_TOKEN_REUSED: status.HTTP_409_CONFLICT,
    ErrorCode.PROFILE_REFERENCE_ALREADY_USED: status.HTTP_409_CONFLICT,
}

DEFAULT_MESSAGE: dict[ErrorCode, str] = {
    ErrorCode.VALIDATION_ERROR: "입력값을 확인해 주세요.",
    ErrorCode.NOT_FOUND: "요청하신 경로를 찾을 수 없습니다.",
    ErrorCode.METHOD_NOT_ALLOWED: "허용되지 않은 요청 방식입니다.",
    ErrorCode.RATE_LIMITED: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
    ErrorCode.SERVICE_UNAVAILABLE: "일시적으로 서비스를 이용할 수 없습니다.",
    ErrorCode.INTERNAL_ERROR: "일시적인 오류가 발생했습니다.",
    ErrorCode.AUTH_REQUIRED: "로그인이 필요합니다.",
    ErrorCode.CREDENTIALS_INVALID: "이메일 또는 비밀번호가 올바르지 않습니다.",
    ErrorCode.EMAIL_ALREADY_REGISTERED: "이미 사용중인 이메일입니다.",
    ErrorCode.TOKEN_INVALID: "유효하지 않은 토큰입니다.",
    ErrorCode.TOKEN_EXPIRED: "토큰이 만료되었습니다. 다시 로그인해 주세요.",
    ErrorCode.TOKEN_REVOKED: "만료되었거나 무효화된 토큰입니다. 다시 로그인해 주세요.",
    ErrorCode.TOKEN_REUSE_DETECTED: "이미 사용된 토큰입니다. 보안을 위해 다시 로그인해 주세요.",
    ErrorCode.ORIGIN_NOT_ALLOWED: "허용되지 않은 출처의 인증 요청입니다.",
    ErrorCode.ACCOUNT_NOT_FOUND: "계정을 찾을 수 없습니다. 다시 로그인해 주세요.",
    ErrorCode.ACCOUNT_SUSPENDED: "이용이 정지된 계정입니다.",
    ErrorCode.ACCOUNT_CLOSED: "해지된 계정입니다.",
    ErrorCode.SUBSCRIPTION_NOT_FOUND: "구독 정보를 찾을 수 없습니다.",
    ErrorCode.SUBSCRIPTION_INACTIVE: "활성 상태의 구독이 아닙니다.",
    ErrorCode.PLAN_CHANGE_NOT_ALLOWED: "이미 사용 중인 플랜입니다.",
    ErrorCode.HOUSEHOLD_NOT_FOUND: "가정을 찾을 수 없습니다.",
    ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED: "해당 가정의 활성 구성원만 수행할 수 있습니다.",
    ErrorCode.INVITATION_NOT_FOUND: "초대를 찾을 수 없습니다.",
    ErrorCode.INVITATION_ALREADY_PENDING: "동일한 대기 중 초대가 이미 있습니다.",
    ErrorCode.INVITATION_SELF_NOT_ALLOWED: "자기 자신에게는 초대를 보낼 수 없습니다.",
    ErrorCode.INVITATION_EXPIRED: "초대가 만료되었습니다.",
    ErrorCode.INVITATION_STATE_CONFLICT: "현재 상태에서는 초대를 처리할 수 없습니다.",
    ErrorCode.INVITATION_TOKEN_INVALID: "초대 링크가 유효하지 않습니다.",
    ErrorCode.INVITATION_TOKEN_REUSED: "이미 사용된 초대 링크입니다.",
    ErrorCode.PROFILE_REFERENCE_ALREADY_USED: "이미 사용된 프로필 연결 참조값입니다. 새 참조값으로 다시 시도해 주세요.",
}

# 프레임워크가 직접 올리는 오류(라우터 404·405, HTTPBearer 401)만 여기로 온다.
# 도메인 오류는 전부 AppError를 거치므로 이 표에 넣지 않는다.
STATUS_FALLBACK_CODE: dict[int, ErrorCode] = {
    status.HTTP_401_UNAUTHORIZED: ErrorCode.AUTH_REQUIRED,
    status.HTTP_404_NOT_FOUND: ErrorCode.NOT_FOUND,
    status.HTTP_405_METHOD_NOT_ALLOWED: ErrorCode.METHOD_NOT_ALLOWED,
    status.HTTP_422_UNPROCESSABLE_CONTENT: ErrorCode.VALIDATION_ERROR,
    status.HTTP_429_TOO_MANY_REQUESTS: ErrorCode.RATE_LIMITED,
    status.HTTP_503_SERVICE_UNAVAILABLE: ErrorCode.SERVICE_UNAVAILABLE,
}
