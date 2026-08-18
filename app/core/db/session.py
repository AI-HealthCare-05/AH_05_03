from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core import config
from app.core.db.url import build_db_url

engine = create_async_engine(
    build_db_url(),
    echo=False,
    pool_size=config.DB_CONNECTION_POOL_MAXSIZE,
    max_overflow=0,
    pool_pre_ping=True,
    pool_recycle=config.DB_POOL_RECYCLE,
    # asyncpg의 연결 타임아웃 인자명은 `timeout`이다. `connect_timeout`을 넘기면
    # 첫 연결에서 TypeError가 나고 불투명한 500으로 보인다.
    connect_args={"timeout": config.DB_CONNECT_TIMEOUT},
)

# expire_on_commit=False가 필수다. True면 commit() 직후 모든 속성이 만료되고,
# 라우터가 model_validate(account)로 속성을 읽는 순간 암묵적 refresh가 걸려
# async 컨텍스트에서 MissingGreenlet으로 죽는다.
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """요청당 세션 하나. 커밋은 서비스가 한다.

    FastAPI는 yield 의존성의 종료 코드를 응답 전송 *후*에 실행하므로,
    여기서 commit()하면 IntegrityError를 409로 바꿀 방법이 없다.
    AsyncSession.__aexit__가 close()를 부르고 열린 트랜잭션은 롤백된다.
    """
    async with AsyncSessionLocal() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def dispose_engine() -> None:
    await engine.dispose()
