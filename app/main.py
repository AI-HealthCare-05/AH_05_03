from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

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

# 프론트가 별 오리진(React)이라 필요하다. 지금까지 아예 없었다.
# refresh 토큰을 본문으로 옮겼으므로 allow_credentials는 False로 둘 수 있다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ALLOW_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

app.include_router(v1_routers)
