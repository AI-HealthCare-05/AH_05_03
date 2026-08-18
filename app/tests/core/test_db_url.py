import pytest
from sqlalchemy.engine.url import make_url

from app.core.db import url as url_module


@pytest.mark.parametrize("password", ["Password1234@", "pw/with/slash", "pw%25percent", "p#hash"])
def test_special_characters_in_password_survive_round_trip(monkeypatch, password: str) -> None:
    """운영 비밀번호에 `@`가 들어 있다(envs/example.prod.env).

    f-string DSN이면 호스트 파싱이 깨지는데, 그 실패는 배포 시점에만
    드러난다. URL.create가 이스케이프를 책임지는지 못 박아 둔다.
    """
    monkeypatch.setattr(url_module.config, "DB_URL", None, raising=False)
    monkeypatch.setattr(url_module.config, "DB_USER", "ozcoding", raising=False)
    monkeypatch.setattr(url_module.config, "DB_PASSWORD", password, raising=False)
    monkeypatch.setattr(url_module.config, "DB_HOST", "postgres", raising=False)
    monkeypatch.setattr(url_module.config, "DB_PORT", 5432, raising=False)
    monkeypatch.setattr(url_module.config, "DB_NAME", "ai_health", raising=False)

    url = url_module.build_db_url()

    assert url.password == password
    assert url.host == "postgres"
    assert url.database == "ai_health"
    assert url.drivername == "postgresql+asyncpg"
    # 렌더 후 다시 파싱해도 값이 보존되어야 한다 (alembic env.py가 이 경로를 탄다)
    assert make_url(url.render_as_string(hide_password=False)).password == password


def test_database_override_switches_target_db(monkeypatch) -> None:
    monkeypatch.setattr(url_module.config, "DB_URL", None, raising=False)
    monkeypatch.setattr(url_module.config, "DB_NAME", "ai_health", raising=False)

    assert url_module.build_db_url(database="ai_health_test").database == "ai_health_test"


def test_db_url_setting_takes_precedence(monkeypatch) -> None:
    monkeypatch.setattr(url_module.config, "DB_URL", "postgresql+asyncpg://u:p@example:5555/other", raising=False)

    url = url_module.build_db_url()

    assert url.host == "example"
    assert url.database == "other"
