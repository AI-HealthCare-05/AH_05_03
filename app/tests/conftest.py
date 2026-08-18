from collections.abc import AsyncGenerator

import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.db.databases import get_db_session
from app.main import app
from app.models import Base, User

TEST_DATABASE_URL = "sqlite+aiosqlite://"
test_engine = create_async_engine(TEST_DATABASE_URL, poolclass=StaticPool)
TestSessionFactory = async_sessionmaker(bind=test_engine, expire_on_commit=False)


async def get_test_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with TestSessionFactory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


@pytest_asyncio.fixture(scope="session", autouse=True)
async def initialize_test_database() -> AsyncGenerator[None, None]:
    async with test_engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    app.dependency_overrides[get_db_session] = get_test_db_session
    yield
    app.dependency_overrides.pop(get_db_session, None)
    await test_engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def clean_database() -> None:
    async with TestSessionFactory() as session:
        await session.execute(delete(User))
        await session.commit()
