import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from app.core.db.base import Base
from app.core.db.url import build_db_url

# 모든 매퍼를 Base.metadata에 등록한다. 빠지면 autogenerate가 빈 마이그레이션을
# 만들거나 방금 만든 테이블을 drop하자고 제안한다.
import app.models  # noqa: F401  isort:skip

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

DB_URL = build_db_url().render_as_string(hide_password=False)


def _type_bound_check_constraint_names() -> set[str]:
    """Enum(native_enum=False)가 파생시킨 CHECK 제약의 이름 집합.

    이 제약들은 컬럼 타입 정의에서 자동으로 나온다. Alembic은 메타데이터
    쪽에서는 type-bound 제약을 건너뛰면서 DB 쪽 리플렉션에서는 세기 때문에,
    매번 "removed check constraint"라는 가짜 차이를 만든다. 이름으로 양쪽
    모두에서 제외해 autogenerate와 `alembic check`를 조용하게 만든다.
    """
    names: set[str] = set()
    for table in target_metadata.tables.values():
        for constraint in table.constraints:
            if getattr(constraint, "_type_bound", False) and constraint.name is not None:
                names.add(str(constraint.name))
    return names


TYPE_BOUND_CHECK_NAMES = _type_bound_check_constraint_names()


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    if type_ == "check_constraint" and name in TYPE_BOUND_CHECK_NAMES:
        return False
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=DB_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # 기본값 False라 VARCHAR(40) -> VARCHAR(255) 같은 변경을 놓친다.
        compare_type=True,
        compare_server_default=True,
        include_schemas=False,
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    section = config.get_section(config.config_ini_section, {})
    # set_main_option()을 쓰면 ConfigParser의 % 보간을 타서 URL 인코딩된
    # 비밀번호(%40 등)가 InterpolationSyntaxError를 낸다. 파싱이 끝난
    # dict에 직접 넣어 보간을 우회한다.
    section["sqlalchemy.url"] = DB_URL

    connectable = async_engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
