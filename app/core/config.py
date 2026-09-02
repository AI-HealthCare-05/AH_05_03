import os
import uuid
import zoneinfo
from dataclasses import field
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.utils.enums import StrEnum


class Env(StrEnum):
    LOCAL = "local"
    DEV = "dev"
    PROD = "prod"


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="allow")

    ENV: Env = Env.LOCAL
    SECRET_KEY: str = f"default-secret-key{uuid.uuid4().hex}"
    TIMEZONE: zoneinfo.ZoneInfo = field(default_factory=lambda: zoneinfo.ZoneInfo("Asia/Seoul"))
    TEMPLATE_DIR: str = os.path.join(Path(__file__).resolve().parent.parent, "templates")

    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "pw1234"
    DB_NAME: str = "ai_health"
    DB_TEST_NAME: str = "ai_health_test"
    # 전체 DSN 재정의. 값이 있으면 위 항목보다 우선한다 (CI·스테이징용)
    DB_URL: str | None = None
    DB_CONNECT_TIMEOUT: int = 5
    DB_CONNECTION_POOL_MAXSIZE: int = 10
    DB_POOL_RECYCLE: int = 1800

    # --- redis / token store -----------------------------------------
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_KEY_PREFIX: str = "ieobom"
    # **20 은 너무 낮았다.** 이 값을 넘는 Redis 작업이 동시에 뜨면 기본
    # `ConnectionPool` 이 기다리지 않고 즉시 `MaxConnectionsError` 를 던진다. 그게
    # `TokenStoreUnavailableError` 로 번역돼 사용자에게는 503 으로 나갔다.
    #
    # 실측 (2026-08-27, 같은 설정으로 파이프라인 동시 실행):
    #   동시  20건 → 실패   0건
    #   동시  40건 → 실패  20건   MaxConnectionsError: Too many connections
    #   동시 160건 → 실패 140건
    #
    # 로그인 한 번이 토큰을 쓰느라 연결을 잡으므로, 21 명이 동시에 로그인하면
    # 그 초과분이 전부 503 이었다. 예측·문서 인식 등록도 속도 제한이 Redis 를
    # 거치므로 같은 벽에 부딪힌다. 100 은 redis-py 자신의 기본값이다.
    REDIS_MAX_CONNECTIONS: int = 100
    # 풀이 꽉 찼을 때 **얼마나 기다렸다가 포기하는가.** `BlockingConnectionPool` 만
    # 이 값을 본다(`app/core/redis/client.py`). 0 으로 두는 것과 예전 동작이 같다.
    # Redis 명령 자체는 밀리초 단위라 3 초를 기다릴 일은 진짜 장애뿐이다.
    REDIS_POOL_WAIT_TIMEOUT: float = 3.0
    # 짧게 잡아 장애 시 매달리지 않고 빠르게 503으로 떨어지게 한다.
    # **이건 명령 왕복 시간이지 풀 대기 시간이 아니다.** 둘을 헷갈려 이 값을 올리면
    # Redis 가 죽었을 때 요청이 그만큼 매달린다.
    REDIS_SOCKET_TIMEOUT: float = 0.5
    REDIS_SOCKET_CONNECT_TIMEOUT: float = 0.5

    JWT_ALGORITHM: str = "HS256"
    # docs/05_tech_architecture.md 7절 "Access Token은 짧게 유지".
    # Redis 장애 시 fail-open 브레이크글래스의 노출 창을 15분으로 묶는 값이기도 하다.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 14 * 24 * 60
    JWT_LEEWAY: int = 5
    # access 토큰 denylist 조회에만 적용되는 비상 스위치.
    # 회전·등록·무효화는 이 값과 무관하게 항상 fail-closed다.
    AUTH_FAIL_OPEN_ON_REDIS_ERROR: bool = False

    # --- family invitations -----------------------------------------
    FAMILY_INVITATION_EXPIRE_DAYS: int = 7
    FAMILY_INVITATION_TOKEN_BYTES: int = 32
    FAMILY_INVITATION_DELIVERY_TTL_SECONDS: int = 5 * 60
    FAMILY_INVITATION_DELIVERY_STREAM_MAXLEN: int = 10_000
    FAMILY_INVITATION_USED_TOKEN_TTL_SECONDS: int = 7 * 24 * 60 * 60
    FAMILY_INVITATION_ACCOUNT_RATE_LIMIT: int = 10
    FAMILY_INVITATION_ACCOUNT_RATE_WINDOW_SECONDS: int = 60
    FAMILY_INVITATION_EMAIL_RATE_LIMIT: int = 20
    FAMILY_INVITATION_EMAIL_RATE_WINDOW_SECONDS: int = 60 * 60
    FAMILY_INVITATION_TRANSITION_RATE_LIMIT: int = 20
    FAMILY_INVITATION_TRANSITION_RATE_WINDOW_SECONDS: int = 60

    # --- invitation email worker ------------------------------------
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_FROM_EMAIL: str = "no-reply@ieobom.local"
    SMTP_FROM_NAME: str = "이어봄"
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_USE_TLS: bool = False
    SMTP_USE_STARTTLS: bool = False
    INVITATION_WEB_ORIGIN: str = "http://localhost:5173"
    INVITATION_EMAIL_STREAM_GROUP: str = "invitation-email-workers"
    INVITATION_EMAIL_STREAM_BLOCK_MS: int = 5_000
    INVITATION_EMAIL_RETRY_DELAY_SECONDS: float = 2.0
    #: 죽은 소비자가 물고 있는 배달 건을 회수하기까지 기다리는 시간.
    #:
    #: **없을 때 무슨 일이 났는가.** 워커가 `XREADGROUP` 뒤 `XACK` 전에 죽으면 그
    #: 메시지는 죽은 소비자의 PEL 에 남는다. 새 워커는 이름이 `{hostname}-{pid}` 라
    #: 달라지고 `>` 로만 읽으므로 그 항목을 영영 안 본다. 사용자는 201 "초대했습니다"
    #: 를 받았는데 상대는 메일을 못 받고, 아무 로그도 남지 않는다. 2026-08-27 에
    #: 재현했다 — XPENDING 이 1 로 고정된 채 35 초를 기다려도 배달되지 않았다.
    #:
    #: 60 초는 SMTP 왕복(타임아웃 10 초)보다 넉넉히 길다. 짧으면 정상 처리 중인
    #: 건을 다른 워커가 뺏어 가 같은 초대가 두 번 발송된다.
    INVITATION_EMAIL_RECLAIM_IDLE_MS: int = 60_000

    # --- prediction job queue ----------------------------------------
    # 예측을 큐로 돌리는 비동기 경로. 동기 경로(`/predictions/risk`)는 그대로 남는다.
    # ADR-009 §7 은 예측을 동기로 정했다 — 채점이 1.3ms 라 큐가 지연만 늘린다.
    # 이 경로는 그 판단을 뒤집는 게 아니라 **워커 구조를 실제로 세우기 위한 것**이고,
    # 어느 경로를 화면에 쓸지는 부하 측정 뒤에 정한다. docs/35 참조.
    PREDICTION_JOB_STREAM_GROUP: str = "prediction-workers"
    PREDICTION_JOB_STREAM_MAXLEN: int = 10_000
    PREDICTION_JOB_STREAM_BLOCK_MS: int = 5_000
    PREDICTION_JOB_BATCH: int = 10
    # 작업 해시 수명. 건강 수치가 담기므로 짧게 잡는다 (ADR-010 §6).
    PREDICTION_JOB_TTL_SECONDS: int = 600
    # 이 시간 넘게 pending 인 작업은 죽은 소비자 몫으로 보고 회수한다.
    PREDICTION_JOB_RECLAIM_IDLE_MS: int = 60_000
    # 재시도 상한. 넘으면 failed 로 확정하고 XACK 한다 — 무한 재배달을 막는다.
    PREDICTION_JOB_MAX_ATTEMPTS: int = 3
    # 이만큼 놀고 pending 이 0 인 소비자는 그룹에서 지운다. 컨테이너를 재시작하면
    # pid 가 바뀌어 새 이름이 생기고 옛 이름이 남는데, 청소하지 않으면 배포할 때마다
    # 소비자 목록이 늘어난다.
    # --- prediction rate limit ---------------------------------------
    # 예측 경로는 인증을 요구하고 계정 단위로 속도를 제한한다 (ADR-009 §10).
    # 동기 경로는 사람이 버튼을 누르는 속도라 넉넉해도 되고, 큐 경로는 한 계정이
    # 큐를 채워 다른 사용자를 밀어내지 못하게 더 조인다.
    PREDICTION_RATE_LIMIT: int = 60
    PREDICTION_RATE_WINDOW_SECONDS: int = 60
    PREDICTION_JOB_RATE_LIMIT: int = 20
    PREDICTION_JOB_RATE_WINDOW_SECONDS: int = 60
    # 챌린지 체크는 하루 항목이 일곱뿐이라 정상 사용은 분당 몇 건이다.
    # 넉넉히 두되 연타·스크립트로 이력을 부풀리는 것은 막는다.
    CHALLENGE_CHECK_RATE_LIMIT: int = 60
    CHALLENGE_CHECK_RATE_WINDOW_SECONDS: int = 60

    PREDICTION_JOB_CONSUMER_IDLE_MS: int = 10 * 60_000
    # 청소 주기. 매 루프마다 훑으면 XINFO 호출이 낭비다.
    PREDICTION_JOB_PRUNE_INTERVAL_SECONDS: float = 300.0

    # --- api ----------------------------------------------------------
    # 오류 응답의 details는 비규격 필드다. 운영에서는 끈다.
    API_ERROR_INCLUDE_DETAILS: bool = False
    CORS_ALLOW_ORIGINS: list[str] = [
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # --- Gemini OCR development bridge -----------------------------
    # 개발·시연에서만 명시적으로 켜는 외부 문서 인식 브리지다.
    ENABLE_DEV_OCR_BRIDGE: bool = False
    DEV_OCR_MAX_FILE_BYTES: int = 20 * 1024 * 1024
    GEMINI_API_KEY: str | None = None
    # OpenAI 예비 경로. **비어 있으면 그냥 꺼진 상태다** — 아래 `DEV_OCR_MODELS` 에
    # `openai:` 항목이 있어도 키가 없으면 그 항목을 건너뛴다. 즉 켜려면 둘 다 필요하다.
    #
    # **Gemini 와 성격이 다르다는 것을 알고 써야 한다.** 무료 등급이 없어서 이 경로로
    # 넘어가는 순간부터 건당 과금이고, 무엇보다 **검진 결과지 원본이 두 번째 업체로**
    # 나간다. ADR-010 의 외부 전송 조건·동의 문구·처리위탁이 같이 갱신돼야 한다.
    # 그래서 기본값은 비어 있고, 켜는 것은 명시적 선택이어야 한다.
    OPENAI_API_KEY: str | None = None
    # **쓸 수 있는 OpenAI 모델을 여기서 못 박는다.** 팀이 지정한 둘만 허용하고,
    # 목록에 없는 모델이 `DEV_OCR_MODELS` 에 들어오면 **기동 시점에** 거절한다
    # (아래 `validate_ocr_models`). 오타 하나로 엉뚱한 — 그리고 훨씬 비싼 — 모델을
    # 부르는 사고를 런타임이 아니라 부팅에서 잡으려는 것이다.
    OPENAI_ALLOWED_MODELS: list[str] = ["gpt-4o-mini", "text-embedding-3-small"]
    # 문서 인식에 쓸 수 없는 모델. 임베딩 모델은 벡터를 돌려줄 뿐 글을 못 만든다.
    # 허용 목록에는 남겨 둔다 — 나중에 챗봇·RAG 축에서 쓸 자리가 있다.
    OPENAI_EMBEDDING_MODELS: list[str] = ["text-embedding-3-small"]
    # 이미지는 base64 data URL(`image_url`), PDF 는 `file` 파트로 보낸다.
    #
    # **PDF 를 뺐던 주석은 낡았다.** 예전에는 "PDF 는 Files API 가 따로 필요하니
    # Gemini 가 처리한다" 였는데, Chat Completions 가 `{"type": "file", "file":
    # {"filename", "file_data"}}` 로 base64 PDF 를 직접 받는다(공식 문서 pdf-files 가이드).
    # gpt-4o 계열은 PDF 에서 **텍스트와 페이지 이미지를 함께** 뽑는다.
    #
    # **2026-08-28 PDF 를 도로 넣었다.** OpenAI 단독으로 다시 전환하면서
    # (아래 `DEV_OCR_MODELS` 참조) PDF 를 받아 줄 다른 공급자가 없어졌기 때문이다.
    # 바로 위 주석이 요구한 그대로다 — `dev_ocr.py` 는 업로드 단계에서 PDF 를 허용하므로
    # 여기 없으면 **올릴 수는 있는데 절대 처리되지 않는 조합**이 된다.
    OPENAI_SUPPORTED_MIME_TYPES: list[str] = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
    ]
    #: 이미지 파트의 `detail`. **기본값 `auto` 로 두면 안 된다.**
    #:
    #: 공식 문서(images-vision) — `low`/`auto` 는 이미지를 줄여서 본다. 검진표는
    #: 2123x3039 에 작은 한글이 빽빽한 문서라, 줄여 보면 모델이 글자를 읽는 대신
    #: **그럴듯한 검사명을 지어낸다.** 2026-08-27 에 `auto` 로 3회 돌린 결과 —
    #: 값 6개는 매번 정확했는데 이름이 `요소질소`→`요단백`/`요산`, `크레아티닌`→`크레아틴`
    #: 으로 매번 다르게 틀렸고 기준범위는 `0~`·`0~7.0`·`0~5` 로 지어냈다.
    #: 2·3 회차에는 `요산` 행이 둘이 나왔다 — BUN 12.0 이 요산으로 붙으면 정상인
    #: 사람이 중증 고요산혈증으로 판정된다.
    #:
    #: `high` 는 타일로 쪼개 원해상도에 가깝게 본다. 토큰이 늘어 비용이 오르지만
    #: 검사명을 잘못 읽는 것보다 싸다.
    OPENAI_IMAGE_DETAIL: str = "high"
    # 외부 유료 API 를 부르는 경로다. 인증만으로는 부족하고 계정별 상한이 있어야
    # 한 계정이 조용히 할당량을 태우는 것을 막는다.
    DEV_OCR_RATE_LIMIT: int = 20
    DEV_OCR_RATE_WINDOW_SECONDS: int = 60
    # 건강 어시스턴트·통증 대화. 같은 이유로 같은 모양의 상한을 건다. OCR 보다
    # 한 번 호출이 싸므로 창은 같고 횟수만 넉넉하다.
    LLM_CHAT_RATE_LIMIT: int = 30
    LLM_CHAT_RATE_WINDOW_SECONDS: int = 60
    #: 대화 경로가 쓰는 Gemini 모델.
    #:
    #: **원 PR(#27)이 세 곳에 하드코딩해 둔 값을 여기로 모았다.** 세 곳 모두
    #: 테스트가 클라이언트를 목킹하므로 CI 가 이 문자열의 유효성을 증명하지
    #: 못한다 — 모델명이 틀리면 배포 후 첫 호출에서야 드러난다. 설정으로 빼
    #: 두면 재배포 없이 환경변수로 고칠 수 있다. 값 자체는 원 PR 을 그대로
    #: 따랐고, 실제 호출로 확인하기 전에는 검증되지 않은 상태다.
    GEMINI_CHAT_MODEL: str = "gemini-3.5-flash-lite"
    #: 대화 경로 제한 시간. 원 PR 은 어시스턴트 12 초 / 통증 2.2 초로 갈라 뒀는데,
    #: 통증 쪽 상수(`OPENAI_PAIN_CHAT_TIMEOUT_SECONDS`)가 이 저장소에 없어 실제로는
    #: `hasattr` 폴백인 10 초로 돌고 있었다. 구조화 JSON 생성에 2.2 초는 짧아
    #: 한 값으로 모으고 12 초로 둔다.
    LLM_CHAT_TIMEOUT_SECONDS: float = 12.0
    # 문서 인식 작업 큐. 예측 큐와 같은 구조지만 흐르는 것이 수치가 아니라 검진
    # 결과지 원본이라 상한을 더 좁게 잡았다.
    DEV_OCR_JOB_STREAM_GROUP: str = "ocr-workers"
    DEV_OCR_JOB_STREAM_MAXLEN: int = 1_000
    DEV_OCR_JOB_STREAM_BLOCK_MS: int = 5_000
    DEV_OCR_JOB_BATCH: int = 2
    # 예측 큐(600s)의 절반. 원본이 Redis 에 머무는 시간을 줄인다.
    DEV_OCR_JOB_TTL_SECONDS: int = 300
    # Gemini 왕복이 수십 초까지 걸린다. 예측(60s)보다 길게 둬야 정상 처리 중인
    # 작업을 다른 워커가 뺏어 가지 않는다.
    DEV_OCR_JOB_RECLAIM_IDLE_MS: int = 180_000
    # 외부 API 호출이라 재시도가 곧 비용이다. 예측(3회)보다 짧게.
    DEV_OCR_JOB_MAX_ATTEMPTS: int = 2
    # 한 작업의 원본 총합. 상한이 없으면 큰 파일 여러 장으로 Redis 메모리를 민다.
    DEV_OCR_JOB_MAX_TOTAL_BYTES: int = 30 * 1024 * 1024
    # 외부 호출 한 건의 상한. **없으면 한 건이 큐 전체를 영구히 막는다** —
    # 실제로 그렇게 멈췄다. 모델 하나당 적용되고, fallback 이 셋이라 최악의
    # 총 대기는 이 값의 3배다.
    DEV_OCR_CALL_TIMEOUT_SECONDS: float = 45.0
    # 시도 순서. 앞에서부터 시도하고 실패하면 다음으로 넘어간다.
    #
    # ## 무료 등급이라는 사실이 나머지를 전부 설명한다
    #
    # 이 저장소의 키는 무료 등급이다. 모델을 부르면 이렇게 답하는 때가 있다.
    #
    #     429 RESOURCE_EXHAUSTED
    #     Quota exceeded for metric: generate_content_free_tier_requests,
    #     limit: 20, model: gemini-3.7-flash
    #
    # **모델당 하루 20건**이고, 할당량이 남아 있어도 혼잡하면 연결만 붙잡는다.
    # 그래서 같은 모델을 같은 이미지로 연달아 재도 이렇게 갈린다(2026-08-27 실측).
    #
    #     1회차   3.5-flash  40초 무응답 │ 3.6-flash  5.4s 성공 │ 3.7-flash  40초 무응답
    #     2회차   3.5-flash  7.8s 성공   │ 3.6-flash  429      │ 3.7-flash  429
    #
    # **모델 사이의 속도 차이를 재려던 앞선 시도는 사실상 잡음을 잰 것이었다.**
    # 한 번씩만 재고 "3.6 이 3.5 보다 2.6배 빠르다" 로 읽었는데, 같은 모델이
    # 회차에 따라 5초와 40초를 오간다. 지배 변수는 모델이 아니라 무료 등급의
    # 할당량과 혼잡이다. **유료 등급으로 올리기 전에는 이 순서를 성능 근거로
    # 정할 수 없다** — 지금 순서는 팀의 선택이고, 값으로 빼 둔 이유가 그것이다.
    #
    # 그래서 진짜 방어선은 순서가 아니라 `DEV_OCR_FIRST_CHUNK_TIMEOUT_SECONDS` 다.
    # 어느 모델이 앞에 있든 매달리지 않고 다음으로 넘어가야 한다.
    #
    # `CORS_ALLOW_ORIGINS` 와 같은 규칙으로 **JSON 배열**을 쓴다 (pydantic-settings 가
    # `list[str]` 를 그렇게 읽는다). 쉼표 구분 문자열은 파싱 오류가 난다.
    #
    #     DEV_OCR_MODELS=["gemini-3.5-flash","gemini-3.7-flash","gemini-3.6-flash"]
    #
    # **compose 의 `environment:` 에도 넣어야 컨테이너까지 닿는다.** 이미지에 `.env`
    # 를 넣지 않으므로(`.dockerignore`) 컨테이너 안에서는 명시적으로 넘긴 값만 보인다.
    # **할당량은 모델마다 따로 센다.** `quotaId` 가
    # `GenerateRequestsPerDayPerProjectPerModel-FreeTier` 다 — 이름 그대로 *PerModel* 이라
    # 목록에 모델을 하나 더 얹을 때마다 하루 예산이 20건씩 늘어난다. 2026-08-27 에
    # 3.5·3.7 이 둘 다 소진돼 인식이 멈췄을 때 아래 넷은 멀쩡히 응답했다.
    #
    #     gemini-3.5-flash-lite   첫 청크 1.7s → 2.4s   표행 6
    #     gemini-3.1-flash-lite   첫 청크 1.9s → 2.6s   표행 6
    #     gemini-3-flash-preview  첫 청크 8.5s → 9.6s   표행 6
    #     (참고: gemini-3.5-flash 는 같은 이미지에 14~20s)
    #
    # **표에서 뽑아내는 행은 여섯으로 전부 같다.** 즉 구조화 결과는 안 갈리고,
    # lite 는 오히려 5~8배 빠르다. 갈리는 것은 `text` 요약의 길이뿐이다.
    #
    # **순서는 "싼 것부터 태운다".** 가벼운 모델을 앞에 두고 무거운 것을 예비로 남긴다.
    # 얻는 것이 둘이다.
    #
    # 1. **평소 지연이 줄어든다.** 첫 글자까지 14~20초에서 2초 안쪽으로 내려간다.
    #    스트리밍을 붙인 이유가 체감 대기를 줄이는 것이었으니 여기서 제일 크게 듣는다.
    # 2. **예산이 오래 간다.** 무거운 모델의 20건을 아껴 두었다가 lite 가 다 막힌
    #    뒤에 쓴다. 반대로 두면 제일 느린 모델로 하루치를 먼저 태우게 된다.
    #
    # 뒤 항목은 앞이 전부 막혔을 때만 불리므로, 예비를 늘려도 평소 지연에는 영향이 없다.
    # 별칭(`gemini-flash-latest` 류)은 넣지 않았다. 어느 실모델을 가리키는지에 따라
    # 앞 항목과 같은 버킷을 나눠 쓸 수 있어서 예산이 안 늘어난다.
    #
    # ## 공급자를 섞을 수 있다
    #
    # 항목은 `공급자:모델` 이고, 접두사가 없으면 `gemini` 로 본다(기존 표기 그대로 동작).
    #
    #     DEV_OCR_MODELS=["gemini-3.5-flash-lite","gemini-3.1-flash-lite","openai:gpt-4o-mini"]
    #
    # OpenAI 항목은 **키와 목록이 둘 다 있어야** 켜진다. 무료 등급이 없으므로 여기까지
    # 내려오면 건당 과금이고, 검진 결과지 원본이 두 번째 업체로 나간다 — 그래서 맨 뒤에
    # 두어 Gemini 예비가 전부 막혔을 때만 닿게 하는 것을 권한다.
    # **맨 뒤의 OpenAI 항목이 "무료 한도가 다 떨어졌을 때" 를 받는다.** 앞의 Gemini
    # 다섯(하루 100건)이 전부 막혀야 닿으므로 평소에는 불리지 않는다. 닿는 순간부터는
    # 과금이고 검진 결과지가 두 번째 업체로 나가므로, 로그의
    # `OCR 성공 · model=openai:...` 는 **비용이 발생했다는 신호**로 읽어야 한다.
    #
    # 끄고 싶으면 `.env` 에서 이 항목을 빼거나 `OPENAI_API_KEY` 를 비우면 된다 —
    # 키가 없으면 항목이 있어도 건너뛴다.
    #
    # 실측 (2026-08-27, 같은 이미지): 첫 청크 4.8s → 7.8s, **표행 6 으로 Gemini 와 동일**.
    #
    # ## 2026-08-27 — OpenAI 단독 전환을 시도했다가 되돌렸다
    #
    # `["openai:gpt-4o-mini"]` 단독으로 바꿔서 전 경로가 동작하는 것까지 확인했다
    # (PDF 포함, 동기 6.2s · 큐 5s · SSE 첫 청크 2.5s). **되돌린 이유는 속도가 아니라
    # 인식 정확도다.**
    #
    # `sample.jpeg` 3회 반복, 정답은 원본 이미지를 직접 확인 —
    #   값 6개는 gpt-4o-mini 도 매번 정확했다. 갈린 것은 **검사명과 참고치**다.
    #   · Gemini            검사명 6/6 · 참고치 6/6
    #   · gpt-4o-mini       검사명 5/6 (`크레아티닌`→`크레아틴`) · 참고치는 계속 어긋남
    #   프롬프트를 고치기 전에는 더 나빴다 — `요소질소`(BUN 12.0)가 `요산` 으로 읽혀
    #   **`요산` 행이 둘** 나왔다. 그대로 수치에 매핑되면 요산 6.1(정상)인 사람이
    #   12.0 으로 잡혀 중증 고요산혈증이 된다.
    #
    # 다시 켜려면 이 목록을 `["openai:gpt-4o-mini"]` 로 바꾸고 compose 의 같은 항목도
    # 맞추면 된다. 그때 `OPENAI_SUPPORTED_MIME_TYPES` 에 `application/pdf` 를 같이
    # 넣어야 PDF 가 막히지 않는다 — 아래 주석 참조.
    # ## 2026-08-28 — OpenAI 단독으로 다시 전환했다 (팀 결정)
    #
    # 바로 위에 되돌린 기록이 있는 그 전환이다. 되돌린 이유였던 **검사명·참고치 오독은
    # 사라지지 않았다** — 대신 그 오독을 받는 쪽에 방어선을 세웠다.
    # `ocr_measurements.py` 가 이름을 그대로 믿지 않고 단위·참고치·값 범위로
    # 교차검증해서, 어긋나면 수치로 채택하지 않고 사용자 검토로 돌린다.
    # `크레아티닌`→`크레아틴` 이나 `요소질소`→`요산` 이 그 관문에서 걸린다.
    #
    # **fallback 이 없다는 것을 알고 쓴다.** `OPENAI_ALLOWED_MODELS` 가 사실상
    # `gpt-4o-mini` 하나라 이 항목이 막히면 인식 경로 전체가 멈춘다. Gemini 다섯을
    # 예비로 두던 때와 다르다. 더 정확한 모델을 쓰려면 허용 목록을 먼저 늘려야 한다.
    DEV_OCR_MODELS: list[str] = ["openai:gpt-4o-mini"]
    # 첫 청크까지의 상한. 스트리밍에서는 이 값이 실질적인 "이 모델이 응답하는가" 판정이다.
    # 503(용량 부족)은 여기서 걸리고, 걸리면 곧장 다음 모델로 넘어간다.
    #
    # **이 값이 진짜 방어선이다.** SDK 재시도를 꺼도(`attempts=1`) 3.7 은 102초·1200초를
    # 쓰고 나서야 503 을 돌려줬다 — 오래 걸리는 것이 클라이언트 재시도가 아니라 서버가
    # 연결을 붙잡는 시간이라 끊는 쪽은 우리여야 한다.
    #
    # 25초는 건강한 모델의 첫 청크(6.0s·18.9s)에 여유를 더한 값이다. 더 줄이면 3.5 가
    # 정상인데도 잘리고, 더 늘리면 혼잡한 모델이 앞에 있을 때 그만큼 사용자가 기다린다.
    DEV_OCR_FIRST_CHUNK_TIMEOUT_SECONDS: float = 25.0
    # 청크 사이 무응답 상한. 전체 상한만 두면 **응답이 오는 중인데도** 긴 문서가
    # 잘린다. 반대로 이것만 두면 조금씩 영원히 흘리는 응답을 못 끊는다 — 둘 다 있어야 한다.
    DEV_OCR_CHUNK_IDLE_TIMEOUT_SECONDS: float = 20.0
    # SDK 내부 재시도 횟수(원 요청 포함). 기본값 5 는 여기서 해롭다 — 503 하나에
    # 104초를 쓰는 것을 실측했고, 그동안 우리 fallback 은 시작조차 못 한다.
    # 1 이면 재시도 없이 즉시 실패해 다음 모델로 넘어간다. 재시도는 우리가 모델을
    # 바꿔 가며 하는 것이 낫다.
    DEV_OCR_SDK_RETRY_ATTEMPTS: int = 1
    # 429 가 알려 주는 대기 시간을 이만큼까지는 지킨다.
    #
    # **무료 등급에서 이 값이 성패를 가른다.** 429 응답에 이런 게 들어 있다.
    #
    #     quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier, quotaValue: 20
    #     retryDelay: 19s   ·   "Please retry in 19.925417153s"
    #
    # 이름은 "per day" 지만 실제로는 짧은 창으로 회복한다 — 20초 기다렸다 다시 부르니
    # 정상 응답했다(17청크). 그런데 그 힌트를 무시하고 모델 둘을 1.5초 만에 연달아
    # 태우면 **둘 다 같은 429 를 맞고 작업이 실패로 확정된다.** 실제로 그렇게 실패했다.
    # 그래서 429 를 만나면 알려 준 만큼 기다렸다 **같은 모델로 한 번 더** 건다.
    #
    # 상한을 두는 이유는 429 가 진짜 하루치 소진일 때다. 그때 retryDelay 는 수천 초라
    # 여기 걸려 걸러지고 곧장 다음 모델로 넘어간다.
    DEV_OCR_RETRY_AFTER_MAX_SECONDS: float = 25.0
    # 인식 중 부분 결과를 담는 스트림의 수명. 결과 해시(`DEV_OCR_JOB_TTL_SECONDS`)보다
    # 짧게 둔다 — 완성본이 해시에 있으므로 조각을 더 오래 들고 있을 이유가 없다.
    DEV_OCR_CHUNK_TTL_SECONDS: int = 120
    # 한 작업의 부분 결과 조각 수 상한. 상한이 없으면 긴 문서 하나가 Redis 를 민다.
    DEV_OCR_CHUNK_STREAM_MAXLEN: int = 2_000
    DEV_OCR_JOB_CONSUMER_IDLE_MS: int = 10 * 60_000
    DEV_OCR_JOB_PRUNE_INTERVAL_SECONDS: float = 300.0

    # Refresh Token은 JavaScript에 노출하지 않고 host 전용 쿠키로만 전달한다.
    # __Host- 접두사는 Secure + Path=/ + Domain 미지정을 브라우저가 강제한다.
    REFRESH_COOKIE_NAME: str = "__Host-ieobom_refresh"
    REFRESH_COOKIE_PATH: str = "/"
    REFRESH_COOKIE_SECURE: bool = True
    REFRESH_COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"

    @model_validator(mode="after")
    def validate_browser_security(self) -> "Config":
        if "*" in self.CORS_ALLOW_ORIGINS:
            raise ValueError("credentialed CORS requires explicit origins")
        if self.REFRESH_COOKIE_NAME.startswith("__Host-") and (
            not self.REFRESH_COOKIE_SECURE or self.REFRESH_COOKIE_PATH != "/"
        ):
            raise ValueError("__Host- cookies require Secure and Path=/")
        if self.REFRESH_COOKIE_SAMESITE == "none" and not self.REFRESH_COOKIE_SECURE:
            raise ValueError("SameSite=None cookies require Secure")
        return self

    @model_validator(mode="after")
    def validate_ocr_models(self) -> "Config":
        """문서 인식 모델 목록을 **기동 시점에** 검증한다.

        런타임까지 미루면 오타 하나가 "사용자가 문서를 올린 순간에야 드러나는 실패" 가
        되고, OpenAI 쪽은 더 나쁘다 — 허용하지 않은 모델명이 통과하면 훨씬 비싼 모델을
        조용히 부르게 된다. 그래서 부팅에서 막는다.
        """
        for entry in self.DEV_OCR_MODELS:
            provider, _, model = entry.partition(":")
            if not model:  # 접두사 없음 = gemini. 기존 표기를 그대로 받는다.
                continue
            if provider != "openai":
                raise ValueError(f"알 수 없는 OCR 공급자입니다: {entry!r} (openai: 또는 접두사 없음)")
            if model not in self.OPENAI_ALLOWED_MODELS:
                raise ValueError(
                    f"허용하지 않은 OpenAI 모델입니다: {model!r}. "
                    f"쓸 수 있는 것은 {self.OPENAI_ALLOWED_MODELS} 뿐입니다."
                )
            if model in self.OPENAI_EMBEDDING_MODELS:
                # 임베딩 모델은 벡터를 돌려줄 뿐 글을 못 만든다. 목록에 넣으면
                # 반드시 실패하므로 여기서 이유를 붙여 막는다.
                raise ValueError(
                    f"{model!r} 은 임베딩 모델이라 문서 인식에 쓸 수 없습니다. "
                    f"이미지를 읽는 모델을 지정하세요 (예: openai:gpt-4o-mini)."
                )
        return self
