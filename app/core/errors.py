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
    # --- 문서 인식 -------------------------------------------------
    # **한 코드로 뭉쳐 있었다.** 성격이 다른 24 곳이 전부 `OCR_UNAVAILABLE`(503) 로
    # 나가서 세 가지가 겹쳤다 — ① 사용자가 .docx 를 올릴 때마다 5xx 알림이 울리고,
    # ② 클라이언트·프록시는 503 을 "잠시 뒤 재시도" 로 읽는데 형식 오류는 재시도해도
    # 같으며 그 재시도가 계정 속도 제한을 태우고, ③ 프런트의 공통 매핑이
    # `OCR_UNAVAILABLE` 을 전부 "설정을 확인해 주세요" 로 바꿔 서버가 알려 준
    # 구체적 사유("각 20MB 이하")가 버려졌다.
    #
    # 그래서 원인별로 나눈다. 503 은 **우리 쪽 사정**(브리지 꺼짐·키 없음)만 남긴다.
    OCR_UNAVAILABLE = "OCR_UNAVAILABLE"
    OCR_NO_FILE = "OCR_NO_FILE"
    OCR_UNSUPPORTED_TYPE = "OCR_UNSUPPORTED_TYPE"
    OCR_FILE_TOO_LARGE = "OCR_FILE_TOO_LARGE"
    OCR_JOB_NOT_FOUND = "OCR_JOB_NOT_FOUND"
    OCR_PROVIDER_FAILED = "OCR_PROVIDER_FAILED"
    # --- llm 대화 ---------------------------------------------------
    # OCR 과 같은 이유로 처음부터 나눠 둔다. 원 PR(#27)은 타임아웃만 504 로 가르고
    # 나머지를 통째로 503 + "오류가 발생했습니다" 로 덮었다. 그러면 키 누락과
    # 모델명 오류와 레이트리밋이 화면에서 구분되지 않는다.
    LLM_UNAVAILABLE = "LLM_UNAVAILABLE"
    LLM_PROVIDER_FAILED = "LLM_PROVIDER_FAILED"
    LLM_TIMEOUT = "LLM_TIMEOUT"
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
    HOUSEHOLD_STATE_CONFLICT = "HOUSEHOLD_STATE_CONFLICT"
    ACTIVE_MEMBERS_REMAIN = "ACTIVE_MEMBERS_REMAIN"
    MEMBERSHIP_STATE_CONFLICT = "MEMBERSHIP_STATE_CONFLICT"
    INVITATION_NOT_FOUND = "INVITATION_NOT_FOUND"
    INVITATION_ALREADY_PENDING = "INVITATION_ALREADY_PENDING"
    INVITATION_SELF_NOT_ALLOWED = "INVITATION_SELF_NOT_ALLOWED"
    INVITATION_EXPIRED = "INVITATION_EXPIRED"
    INVITATION_STATE_CONFLICT = "INVITATION_STATE_CONFLICT"
    INVITATION_TOKEN_INVALID = "INVITATION_TOKEN_INVALID"
    INVITATION_TOKEN_REUSED = "INVITATION_TOKEN_REUSED"
    PROFILE_REFERENCE_ALREADY_USED = "PROFILE_REFERENCE_ALREADY_USED"
    PROFILE_LINK_NOT_FOUND = "PROFILE_LINK_NOT_FOUND"
    PROFILE_LINK_STATE_CONFLICT = "PROFILE_LINK_STATE_CONFLICT"
    PROFILE_ALREADY_LINKED = "PROFILE_ALREADY_LINKED"
    PROFILE_REF_ALREADY_CLAIMED = "PROFILE_REF_ALREADY_CLAIMED"
    PROFILE_LINK_INVITATION_MISMATCH = "PROFILE_LINK_INVITATION_MISMATCH"
    # --- challenge -------------------------------------------------
    CHALLENGE_NOT_FOUND = "CHALLENGE_NOT_FOUND"


ERROR_STATUS: dict[ErrorCode, int] = {
    ErrorCode.VALIDATION_ERROR: status.HTTP_422_UNPROCESSABLE_CONTENT,
    ErrorCode.NOT_FOUND: status.HTTP_404_NOT_FOUND,
    ErrorCode.METHOD_NOT_ALLOWED: status.HTTP_405_METHOD_NOT_ALLOWED,
    ErrorCode.RATE_LIMITED: status.HTTP_429_TOO_MANY_REQUESTS,
    ErrorCode.SERVICE_UNAVAILABLE: status.HTTP_503_SERVICE_UNAVAILABLE,
    ErrorCode.INTERNAL_ERROR: status.HTTP_500_INTERNAL_SERVER_ERROR,
    # 503 은 우리 쪽 사정(브리지 꺼짐·키 없음)일 때만.
    ErrorCode.OCR_UNAVAILABLE: status.HTTP_503_SERVICE_UNAVAILABLE,
    ErrorCode.OCR_NO_FILE: status.HTTP_400_BAD_REQUEST,
    ErrorCode.OCR_UNSUPPORTED_TYPE: status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
    # `HTTP_413_REQUEST_ENTITY_TOO_LARGE` 는 starlette 에서 deprecated 다.
    ErrorCode.OCR_FILE_TOO_LARGE: status.HTTP_413_CONTENT_TOO_LARGE,
    ErrorCode.OCR_JOB_NOT_FOUND: status.HTTP_404_NOT_FOUND,
    # 외부 공급자가 실패한 것이지 우리가 죽은 게 아니다.
    ErrorCode.OCR_PROVIDER_FAILED: status.HTTP_502_BAD_GATEWAY,
    ErrorCode.LLM_UNAVAILABLE: status.HTTP_503_SERVICE_UNAVAILABLE,
    ErrorCode.LLM_PROVIDER_FAILED: status.HTTP_502_BAD_GATEWAY,
    ErrorCode.LLM_TIMEOUT: status.HTTP_504_GATEWAY_TIMEOUT,
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
    ErrorCode.HOUSEHOLD_STATE_CONFLICT: status.HTTP_409_CONFLICT,
    ErrorCode.ACTIVE_MEMBERS_REMAIN: status.HTTP_409_CONFLICT,
    ErrorCode.MEMBERSHIP_STATE_CONFLICT: status.HTTP_409_CONFLICT,
    ErrorCode.INVITATION_NOT_FOUND: status.HTTP_404_NOT_FOUND,
    ErrorCode.INVITATION_ALREADY_PENDING: status.HTTP_409_CONFLICT,
    ErrorCode.INVITATION_SELF_NOT_ALLOWED: status.HTTP_400_BAD_REQUEST,
    ErrorCode.INVITATION_EXPIRED: status.HTTP_410_GONE,
    ErrorCode.INVITATION_STATE_CONFLICT: status.HTTP_409_CONFLICT,
    ErrorCode.INVITATION_TOKEN_INVALID: status.HTTP_403_FORBIDDEN,
    ErrorCode.INVITATION_TOKEN_REUSED: status.HTTP_409_CONFLICT,
    ErrorCode.PROFILE_REFERENCE_ALREADY_USED: status.HTTP_409_CONFLICT,
    ErrorCode.PROFILE_LINK_NOT_FOUND: status.HTTP_404_NOT_FOUND,
    ErrorCode.PROFILE_LINK_STATE_CONFLICT: status.HTTP_409_CONFLICT,
    ErrorCode.PROFILE_ALREADY_LINKED: status.HTTP_409_CONFLICT,
    ErrorCode.PROFILE_REF_ALREADY_CLAIMED: status.HTTP_409_CONFLICT,
    ErrorCode.PROFILE_LINK_INVITATION_MISMATCH: status.HTTP_409_CONFLICT,
    ErrorCode.CHALLENGE_NOT_FOUND: status.HTTP_404_NOT_FOUND,
}

DEFAULT_MESSAGE: dict[ErrorCode, str] = {
    ErrorCode.VALIDATION_ERROR: "입력값을 확인해 주세요.",
    ErrorCode.NOT_FOUND: "요청하신 경로를 찾을 수 없습니다.",
    ErrorCode.METHOD_NOT_ALLOWED: "허용되지 않은 요청 방식입니다.",
    ErrorCode.RATE_LIMITED: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
    ErrorCode.SERVICE_UNAVAILABLE: "일시적으로 서비스를 이용할 수 없습니다.",
    ErrorCode.INTERNAL_ERROR: "일시적인 오류가 발생했습니다.",
    ErrorCode.OCR_UNAVAILABLE: "OCR 기능을 사용할 수 없습니다.",
    ErrorCode.OCR_NO_FILE: "인식할 파일을 첨부해 주세요.",
    ErrorCode.OCR_UNSUPPORTED_TYPE: "JPEG, PNG, WEBP 이미지 또는 PDF 문서만 인식할 수 있습니다.",
    ErrorCode.OCR_FILE_TOO_LARGE: "파일이 너무 큽니다. 크기를 줄여서 다시 올려 주세요.",
    ErrorCode.OCR_JOB_NOT_FOUND: "문서 인식 작업을 찾을 수 없습니다. 시간이 지나 정리됐을 수 있습니다.",
    ErrorCode.OCR_PROVIDER_FAILED: "문서 인식에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    ErrorCode.LLM_UNAVAILABLE: "대화 기능을 사용할 수 없습니다.",
    ErrorCode.LLM_PROVIDER_FAILED: "대화 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.",
    ErrorCode.LLM_TIMEOUT: "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
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
    ErrorCode.HOUSEHOLD_STATE_CONFLICT: "현재 상태에서는 가정을 변경할 수 없습니다.",
    ErrorCode.ACTIVE_MEMBERS_REMAIN: "다른 활성 구성원이 있어 가정을 폐쇄할 수 없습니다.",
    ErrorCode.MEMBERSHIP_STATE_CONFLICT: "현재 상태에서는 멤버십을 변경할 수 없습니다.",
    ErrorCode.INVITATION_NOT_FOUND: "초대를 찾을 수 없습니다.",
    ErrorCode.INVITATION_ALREADY_PENDING: "동일한 대기 중 초대가 이미 있습니다.",
    ErrorCode.INVITATION_SELF_NOT_ALLOWED: "자기 자신에게는 초대를 보낼 수 없습니다.",
    ErrorCode.INVITATION_EXPIRED: "초대가 만료되었습니다.",
    ErrorCode.INVITATION_STATE_CONFLICT: "현재 상태에서는 초대를 처리할 수 없습니다.",
    ErrorCode.INVITATION_TOKEN_INVALID: "초대 링크가 유효하지 않습니다.",
    ErrorCode.INVITATION_TOKEN_REUSED: "이미 사용된 초대 링크입니다.",
    ErrorCode.PROFILE_REFERENCE_ALREADY_USED: "이미 사용된 프로필 연결 참조값입니다. 새 참조값으로 다시 시도해 주세요.",
    ErrorCode.PROFILE_LINK_NOT_FOUND: "프로필 연결을 찾을 수 없습니다.",
    ErrorCode.PROFILE_LINK_STATE_CONFLICT: "현재 상태에서는 프로필 연결을 변경할 수 없습니다.",
    ErrorCode.PROFILE_ALREADY_LINKED: "이 가정에서 계정에 이미 활성 프로필 연결이 있습니다.",
    ErrorCode.PROFILE_REF_ALREADY_CLAIMED: "이 프로필 참조값은 이미 연결에 사용되었습니다.",
    ErrorCode.PROFILE_LINK_INVITATION_MISMATCH: "초대와 프로필 연결 정보가 일치하지 않습니다.",
    ErrorCode.CHALLENGE_NOT_FOUND: "그런 챌린지가 없습니다.",
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
