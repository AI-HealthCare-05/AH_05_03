"""대화형 문서와 OpenAPI 스키마가 설정을 따르는지 못 박는다.

2026-09-04 배포에서 `/api/openapi.json` 이 익명에게 211KB 짜리 전체 스키마를
그대로 내주고 있었다. 라우트·필드·오류 코드가 다 들어 있어 API 표면을 읽는
수고를 대신 해 주는 셈이었다. 세 값이 다시 하드코딩으로 돌아가면 여기서 잡힌다.
"""

from app.core import config
from app.main import app


class TestApiDocsExposure:
    def test_doc_routes_follow_the_configuration_flag(self) -> None:
        urls = (app.docs_url, app.redoc_url, app.openapi_url)

        if config.API_DOCS_ENABLED:
            assert urls == ("/api/docs", "/api/redoc", "/api/openapi.json")
        else:
            # `None` 이면 FastAPI 가 라우트를 아예 만들지 않는다. 우회할 경로가 없다.
            assert urls == (None, None, None)

    def test_flag_defaults_to_on_so_development_keeps_its_docs(self) -> None:
        """끄는 것은 운영 `.env` 의 선택이지 코드의 기본값이 아니다."""
        assert config.API_DOCS_ENABLED is True
