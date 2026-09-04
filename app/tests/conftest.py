from collections.abc import AsyncIterator
from uuid import uuid4

import pytest_asyncio
from fakeredis.aioredis import FakeRedis
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

import app.models as _models  # noqa: F401  Base.metadata에 매퍼를 등록한다
from app.core import config
from app.core.db.base import Base
from app.core.db.session import get_session
from app.core.db.url import build_db_url
from app.core.redis.client import get_redis
from app.main import app

# 운영과 동일하게 Secure 쿠키 동작을 검증한다.
TEST_BASE_URL = "https://test"


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def _create_test_database() -> AsyncIterator[None]:
    """CREATE DATABASE는 트랜잭션 블록 안에서 못 돈다 → AUTOCOMMIT.

    POSTGRES_USER가 클러스터 슈퍼유저이므로 별도 권한 부여가 필요 없다.
    MySQL 시절 run_test.sh의 GRANT 해킹이 사라진 자리다.
    """
    admin_url = build_db_url(database="postgres")
    admin = create_async_engine(admin_url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    async with admin.connect() as conn:
        await conn.execute(text(f'DROP DATABASE IF EXISTS "{config.DB_TEST_NAME}" WITH (FORCE)'))
        await conn.execute(text(f'CREATE DATABASE "{config.DB_TEST_NAME}"'))
    await admin.dispose()

    yield

    admin = create_async_engine(admin_url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    async with admin.connect() as conn:
        await conn.execute(text(f'DROP DATABASE IF EXISTS "{config.DB_TEST_NAME}" WITH (FORCE)'))
    await admin.dispose()


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def engine(_create_test_database: None) -> AsyncIterator[AsyncEngine]:
    """스키마는 create_all로 만든다.

    마이그레이션이 아니라 모델에서 직접 만들어야 테스트 실패가
    "모델 버그"와 "마이그레이션 버그" 사이에서 모호해지지 않는다.
    둘 사이의 드리프트는 CI의 `alembic check`가 잡는다.
    """
    eng = create_async_engine(build_db_url(database=config.DB_TEST_NAME), poolclass=NullPool)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def db_session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """테스트마다 바깥 트랜잭션을 열고 끝에 롤백한다.

    서비스가 commit()을 호출하므로 join_transaction_mode="create_savepoint"가
    필요하다. 각 commit()이 RELEASE SAVEPOINT로 재해석되어 테스트 안에서는
    쓴 값이 보이고, 바깥 트랜잭션 롤백 시 전부 사라진다.
    """
    conn = await engine.connect()
    trans = await conn.begin()
    session = AsyncSession(
        bind=conn,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,  # 운영 설정과 맞춘다
    )
    try:
        yield session
    finally:
        await session.close()
        await trans.rollback()
        await conn.close()


@pytest_asyncio.fixture(loop_scope="session", autouse=True)
async def _override_session(db_session: AsyncSession) -> AsyncIterator[None]:
    """앱의 get_session을 테스트 세션으로 바꿔치기한다.

    이게 유일한 이음새다. override가 없으면 앱이 자기 get_session을 해석해
    개발 DB에 별도 세션을 열고, 테스트는 그걸 보지도 롤백하지도 못한다.

    알려진 한계: 한 테스트 안의 모든 HTTP 요청이 세션 하나를 공유하므로
    identity map도 공유된다. 운영에서는 요청마다 세션이 따로다. "요청 간
    재조회가 필요한" 버그는 이 하네스로 잡히지 않는다.
    """

    async def _get_session() -> AsyncIterator[AsyncSession]:
        try:
            yield db_session
        except Exception:
            await db_session.rollback()
            # 반드시 다시 올려야 한다. FastAPI 0.141은 yield 의존성이 예외를
            # 삼키면 FastAPIError를 낸다.
            raise

    app.dependency_overrides[get_session] = _get_session
    yield
    app.dependency_overrides.pop(get_session, None)


@pytest_asyncio.fixture(loop_scope="session")
async def fake_redis() -> AsyncIterator[FakeRedis]:
    fake = FakeRedis(decode_responses=True)
    yield fake
    await fake.aclose()


@pytest_asyncio.fixture(loop_scope="session", autouse=True)
async def _override_redis(fake_redis: FakeRedis) -> AsyncIterator[None]:
    """앱의 get_redis를 fakeredis로 바꿔치기한다.

    ASGITransport는 lifespan을 실행하지 않으므로 app.state.redis가 아예
    없다. 실제 Redis를 쓰지 않는 또 다른 이유는, compose의 redis가 ai-worker
    브로커라 테스트에서 FLUSHDB하면 팀원의 브로커 상태를 지울 수 있어서다.
    테스트 세션 전용 인스턴스라 실제 브로커 상태를 건드리지 않는다.
    """

    async def _get_redis():
        return fake_redis

    app.dependency_overrides[get_redis] = _get_redis
    yield
    app.dependency_overrides.pop(get_redis, None)


@pytest_asyncio.fixture(loop_scope="session")
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url=TEST_BASE_URL) as c:
        yield c


@pytest_asyncio.fixture(loop_scope="session")
async def authorized_client(client: AsyncClient) -> AsyncIterator[AsyncClient]:
    """가입·로그인을 끝낸 클라이언트. `Authorization` 헤더가 기본으로 붙는다.

    왜 필요했나
    -----------
    예측·판정 라우터에 인증이 붙으면서(ADR-009 §10) 그 경로를 부르던 테스트 23건이
    한꺼번에 401 로 깨졌다. 테스트마다 로그인 절차를 복사하면 같은 다섯 줄이 스무 번
    들어가고, 토큰 만료나 쿠키 이름이 바뀔 때 스무 곳을 고쳐야 한다.

    이메일에 uuid 를 넣는 이유는 세션 스코프 DB 를 여러 테스트가 공유하기 때문이다.
    고정 주소를 쓰면 두 번째 가입이 `EMAIL_ALREADY_EXISTS` 로 떨어진다.

    **`client` 를 그대로 감싸므로 쿠키 저장소를 공유한다.** 리프레시 토큰이 쿠키로
    내려오는 흐름을 테스트가 실제로 통과한다는 뜻이다.
    """
    email = f"fixture-{uuid4().hex}@example.com"
    password = "Password123!"
    await client.post("/api/v1/auth/signup", json={"email": email, "password": password})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    token = response.json()["data"]["access_token"]

    previous = dict(client.headers)
    client.headers["Authorization"] = f"Bearer {token}"
    yield client
    # 헤더를 되돌린다. 같은 세션의 다른 테스트가 무인증을 기대할 수 있다.
    client.headers.clear()
    client.headers.update(previous)
