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


class OcrUnavailableError(AppError):
    """**우리 쪽 사정으로** 문서 인식을 못 할 때만. 브리지 꺼짐·API 키 없음 등.

    사용자가 잘못 올린 것(파일 없음·형식·용량)이나 외부 공급자 실패는 아래 형제
    예외를 쓴다. 전부 이 하나로 뭉쳐 있어서 .docx 한 번 올릴 때마다 5xx 알림이
    울렸고, 프런트도 사유를 구분하지 못해 "설정을 확인해 주세요" 만 보여 줬다.
    """

    error_code = ErrorCode.OCR_UNAVAILABLE


class OcrNoFileError(AppError):
    """첨부가 없다. 400 — 다시 시도해도 같으므로 5xx 로 두면 안 된다."""

    error_code = ErrorCode.OCR_NO_FILE


class OcrUnsupportedTypeError(AppError):
    """지원하지 않는 형식. 415 — 사용자가 파일을 바꾸면 해결된다."""

    error_code = ErrorCode.OCR_UNSUPPORTED_TYPE


class OcrFileTooLargeError(AppError):
    """파일당·합계 상한 초과. 413."""

    error_code = ErrorCode.OCR_FILE_TOO_LARGE


class OcrJobNotFoundError(AppError):
    """작업이 없거나 TTL 이 지났다. 404.

    둘을 구분해 알려 주지 않는 것은 그대로다 — 무작위 job_id 를 긁어 남의 작업
    존재 여부를 알아내는 것을 막는다. 상태 코드만 정직해진다.
    """

    error_code = ErrorCode.OCR_JOB_NOT_FOUND


class OcrProviderFailedError(AppError):
    """외부 공급자가 답을 못 줬다. 502 — 죽은 것은 우리가 아니라 업스트림이다."""

    error_code = ErrorCode.OCR_PROVIDER_FAILED


class OcrQueueUnavailableError(AppError):
    """Redis 큐가 순간적으로 응답하지 않는다. 공급자 실패와 구분되는 503."""

    error_code = ErrorCode.SERVICE_UNAVAILABLE


# --- llm 대화 -------------------------------------------------------------
class LlmUnavailableError(AppError):
    """우리 쪽 사정. 키가 없거나 기능이 꺼져 있다. 503."""

    error_code = ErrorCode.LLM_UNAVAILABLE


class LlmProviderFailedError(AppError):
    """공급자가 답을 못 줬다. 502 — 죽은 것은 우리가 아니라 업스트림이다.

    모델명 오류(404)·인증 실패·레이트리밋이 여기 모인다. 셋을 더 가르려면
    SDK 예외 타입에 기대야 하는데, 그건 `google-genai` 버전에 묶이므로
    원인 예외를 `__cause__` 로 남기고 상태 코드만 정직하게 둔다.
    """

    error_code = ErrorCode.LLM_PROVIDER_FAILED


class LlmTimeoutError(AppError):
    """제한 시간 안에 못 받았다. 504."""

    error_code = ErrorCode.LLM_TIMEOUT


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


# --- household / invitation ----------------------------------------------
class HouseholdNotFoundError(AppError):
    error_code = ErrorCode.HOUSEHOLD_NOT_FOUND


class HouseholdMembershipRequiredError(AppError):
    error_code = ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED


class HouseholdStateConflictError(AppError):
    error_code = ErrorCode.HOUSEHOLD_STATE_CONFLICT


class HouseholdHasOtherMembersError(AppError):
    error_code = ErrorCode.ACTIVE_MEMBERS_REMAIN


class MembershipStateConflictError(AppError):
    error_code = ErrorCode.MEMBERSHIP_STATE_CONFLICT


class InvitationNotFoundError(AppError):
    error_code = ErrorCode.INVITATION_NOT_FOUND


class InvitationAlreadyPendingError(AppError):
    error_code = ErrorCode.INVITATION_ALREADY_PENDING


class InvitationSelfNotAllowedError(AppError):
    error_code = ErrorCode.INVITATION_SELF_NOT_ALLOWED


class InvitationExpiredError(AppError):
    error_code = ErrorCode.INVITATION_EXPIRED


class InvitationStateConflictError(AppError):
    error_code = ErrorCode.INVITATION_STATE_CONFLICT


class InvitationTokenInvalidError(AppError):
    error_code = ErrorCode.INVITATION_TOKEN_INVALID


class InvitationTokenReusedError(AppError):
    error_code = ErrorCode.INVITATION_TOKEN_REUSED


class ProfileReferenceAlreadyUsedError(AppError):
    error_code = ErrorCode.PROFILE_REFERENCE_ALREADY_USED


class ProfileLinkNotFoundError(AppError):
    error_code = ErrorCode.PROFILE_LINK_NOT_FOUND


class ProfileLinkStateConflictError(AppError):
    error_code = ErrorCode.PROFILE_LINK_STATE_CONFLICT


class ProfileLinkAccountConflictError(AppError):
    error_code = ErrorCode.PROFILE_ALREADY_LINKED


class ProfileRefAlreadyClaimedError(AppError):
    error_code = ErrorCode.PROFILE_REF_ALREADY_CLAIMED


class ProfileLinkInvitationMismatchError(AppError):
    error_code = ErrorCode.PROFILE_LINK_INVITATION_MISMATCH


class RateLimitedError(AppError):
    error_code = ErrorCode.RATE_LIMITED


# --- challenge -----------------------------------------------------------
class ChallengeNotFoundError(AppError):
    error_code = ErrorCode.CHALLENGE_NOT_FOUND


# --- chat sessions -------------------------------------------------------
class ChatSessionNotFoundError(AppError):
    error_code = ErrorCode.CHAT_SESSION_NOT_FOUND
