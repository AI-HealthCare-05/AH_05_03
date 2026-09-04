import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from redis.exceptions import RedisError

from app.apis import spa
from app.apis.exception_handlers import register_exception_handlers
from app.apis.v1 import v1_routers
from app.core import config
from app.core.db.session import dispose_engine
from app.core.errors import ErrorCode
from app.core.jobs import PredictionJobStore
from app.core.logger import install_access_log_mask
from app.core.redis.client import close_redis_pool, create_redis_pool
from app.dtos.envelope import error_responses
from app.services.risk import registry


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # uvicorn 접근 로그의 job_id 를 가린다. uvicorn 이 제 로거를 만든 뒤여야 걸리므로
    # import 시점이 아니라 여기다. 이유는 `app/core/logger.py` 의 `MaskJobIds` 참조.
    install_access_log_mask()

    # httpx의 ASGITransport는 lifespan을 실행하지 않으므로, 테스트에서는
    # app.state.redis가 존재하지 않는다. conftest가 get_redis를 override해서
    # 이 블록 자체를 건너뛴다.
    app.state.redis = create_redis_pool()
    yield
    await close_redis_pool(app.state.redis)
    await dispose_engine()


# `default_response_class=ORJSONResponse` 를 걷어냈다. FastAPI 가 이 클래스를
# deprecate 했고(테스트 한 번에 경고 124건), 이제는 **반환 타입이나 response_model 이
# 있으면 Pydantic 이 Rust 쪽에서 곧장 JSON 바이트로 직렬화한다** — 커스텀 응답
# 클래스보다 빠르다. 우리 라우트는 전부 봉투 DTO 를 선언하고 있으므로 그 경로를 탄다.
app = FastAPI(
    # `None` 이면 FastAPI 가 그 라우트를 아예 만들지 않는다. 404 를 돌려주는 게
    # 아니라 존재하지 않게 되므로 우회할 경로가 남지 않는다. 운영은 셋 다 끈다 —
    # `API_DOCS_ENABLED` 주석 참조.
    docs_url="/api/docs" if config.API_DOCS_ENABLED else None,
    redoc_url="/api/redoc" if config.API_DOCS_ENABLED else None,
    openapi_url="/api/openapi.json" if config.API_DOCS_ENABLED else None,
    lifespan=lifespan,
    # 앱 레벨에 걸면 모든 라우트로 전파된다. FastAPI는 422가 이미 선언돼
    # 있으면 기본 HTTPValidationError를 넣지 않으므로, 이 한 줄이 전역에서
    # 기본 스키마를 우리 봉투로 대체한다.
    responses=error_responses(ErrorCode.VALIDATION_ERROR, ErrorCode.INTERNAL_ERROR),
)

# 개발 중 React와 API의 오리진이 다를 수 있다. Refresh Token 쿠키를 보내기
# 위해 credentials를 허용하되, origin은 명시적 allowlist로만 제한한다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

app.include_router(v1_routers)
# 예측 API를 사람이 눌러 확인하는 데모 화면. /api/ 아래 두는 규칙은 그대로 지킨다 —
# 아래 SPA 폴백이 /api 로 시작하는 경로를 건드리지 않기 때문이다.
# ML 모델과 규칙 엔진을 한 화면에서 스위치로 바꿔 돌린다.


# 빌드된 프런트엔드. 별도 nginx 컨테이너가 하던 일을 여기로 옮겼다.
# **반드시 마지막이다** — SPA 폴백이 catch-all 이라 먼저 붙으면 위 라우터를 다 가린다.
# 컨테이너 헬스체크용. **`spa.mount(app)` 보다 먼저 등록해야 한다** — SPA 는 모르는
# 경로를 전부 index.html 로 받아 200 을 주므로, 뒤에 두면 이 경로도 HTML 을 돌려주고
# 헬스체크가 "항상 건강함"이 된다. 실제로 `/health` 가 그 상태였다.
#
# 모델 적재 여부까지 본다. 컨테이너는 떴는데 번들 볼륨이 안 붙은 상태를 건강하다고
# 하면 nginx 가 트래픽을 넘기고 사용자가 503 을 본다.
@app.get("/api/health", include_in_schema=False)
async def health(request: Request) -> dict[str, object]:
    """컨테이너 헬스체크 + 큐 관측.

    `queue.pending` 이 계속 쌓이면 워커가 못 따라가고 있다는 뜻이다. 이 값을 안 보면
    큐가 밀리는 것을 사용자 불만으로 알게 된다.

    Redis 가 죽어도 **200 을 준다.** 동기 예측 경로는 Redis 없이 동작하므로 여기서
    503 을 주면 nginx 가 멀쩡한 서버를 죽은 것으로 보고 트래픽을 끊는다. 대신
    `queue.available` 로 상태를 드러낸다.
    """
    queue: dict[str, object] = {"available": False, "pending": None}
    redis = getattr(request.app.state, "redis", None)
    if redis is not None:
        with contextlib.suppress(RedisError):
            queue = {"available": True, "pending": await PredictionJobStore(redis).pending_count()}
    return {
        "status": "ok",
        "models": registry.available,
        "targets": len(registry.targets()),
        "queue": queue,
    }


spa.mount(app)
