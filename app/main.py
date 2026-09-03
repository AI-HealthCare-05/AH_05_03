from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app.apis.demo_routers import demo_router
from app.apis.exception_handlers import register_exception_handlers
from app.apis.v1 import v1_routers
from app.core import config
from app.core.db.session import dispose_engine
from app.core.errors import ErrorCode
from app.core.redis.client import close_redis_pool, create_redis_pool
from app.dtos.envelope import error_responses


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # httpx의 ASGITransport는 lifespan을 실행하지 않으므로, 테스트에서는
    # app.state.redis가 존재하지 않는다. conftest가 get_redis를 override해서
    # 이 블록 자체를 건너뛴다.
    app.state.redis = create_redis_pool()
    yield
    await close_redis_pool(app.state.redis)
    await dispose_engine()


app = FastAPI(
    default_response_class=ORJSONResponse,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
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
# 예측 API를 사람이 눌러 확인하는 데모 화면. nginx가 /api/ 만 프록시하므로 그 아래 둔다.
# ML 모델과 규칙 엔진을 한 화면에서 스위치로 바꿔 돌린다.
app.include_router(demo_router)
