from sqlalchemy import URL, make_url

from app.core import config


def build_db_url(database: str | None = None) -> URL:
    """PostgreSQL DSN을 만든다.

    f-string으로 조립하면 안 된다. 운영 비밀번호에 `@`가 들어 있어
    (envs/example.prod.env) 호스트 파싱이 깨진다. URL.create는 렌더 시점에
    이스케이프하므로 특수문자가 그대로 통과한다.
    """
    if config.DB_URL:
        url = make_url(config.DB_URL)
        return url.set(database=database) if database else url

    return URL.create(
        drivername="postgresql+asyncpg",
        username=config.DB_USER,
        password=config.DB_PASSWORD,
        host=config.DB_HOST,
        port=config.DB_PORT,
        database=database or config.DB_NAME,
    )
