"""봉투가 시간이 지나도 썩지 않게 막는 구조적 테스트.

새 라우트를 추가하면서 response_model=ApiResponse[...]를 깜빡하거나,
error_responses()를 빼먹어 기본 HTTPValidationError가 다시 새어 나오는 걸
개별 엔드포인트 테스트만으로는 잡지 못한다. 여기서 앱 전체를 훑는다.
"""

import json

from httpx import ASGITransport, AsyncClient
from starlette import status

from app.dtos.envelope import ApiResponse
from app.main import app

TEST_BASE_URL = "http://test"


class TestEveryRouteUsesTheEnvelope:
    def test_every_apiroute_response_model_is_api_response(self) -> None:
        from fastapi.routing import APIRoute

        offenders = []
        for route in app.routes:
            if not isinstance(route, APIRoute):
                continue
            model = route.response_model
            origin = getattr(model, "__pydantic_generic_metadata__", {}).get("origin")
            if origin is not ApiResponse:
                offenders.append(route.path)

        assert not offenders, f"ApiResponse를 쓰지 않는 라우트: {offenders}"

    def test_every_success_schema_has_the_envelope_keys(self) -> None:
        spec = app.openapi()
        schemas = spec["components"]["schemas"]

        checked = 0
        for path_item in spec["paths"].values():
            for operation in path_item.values():
                for response in operation.get("responses", {}).values():
                    ref = response.get("content", {}).get("application/json", {}).get("schema", {})
                    schema_name = ref.get("$ref", "").rsplit("/", 1)[-1]
                    if not schema_name.startswith("ApiResponse"):
                        continue
                    checked += 1
                    props = set(schemas[schema_name]["properties"])
                    assert {"data", "message", "success"} <= props

        assert checked > 0, "ApiResponse 스키마를 하나도 못 찾았다 — 라우트가 비었나?"

    def test_http_validation_error_is_gone_from_the_schema(self) -> None:
        """앱 레벨 responses=가 FastAPI 기본 422 스키마를 억제하는지."""
        spec = app.openapi()

        assert "HTTPValidationError" not in json.dumps(spec)


class TestFrameworkRaisedErrorsUseTheEnvelope:
    async def test_unknown_path_is_not_found_envelope(self) -> None:
        async with AsyncClient(transport=ASGITransport(app=app), base_url=TEST_BASE_URL) as c:
            response = await c.get("/api/v1/does-not-exist")

        assert response.status_code == status.HTTP_404_NOT_FOUND
        body = response.json()
        assert body == {"error_code": "NOT_FOUND", "message": body["message"], "success": False}
        assert "detail" not in body

    async def test_wrong_method_is_method_not_allowed_envelope(self) -> None:
        async with AsyncClient(transport=ASGITransport(app=app), base_url=TEST_BASE_URL) as c:
            response = await c.put("/api/v1/auth/signup")

        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        assert response.json()["error_code"] == "METHOD_NOT_ALLOWED"

    async def test_docs_and_openapi_still_serve(self) -> None:
        async with AsyncClient(transport=ASGITransport(app=app), base_url=TEST_BASE_URL) as c:
            docs = await c.get("/api/docs")
            openapi = await c.get("/api/openapi.json")

        assert docs.status_code == status.HTTP_200_OK
        assert openapi.status_code == status.HTTP_200_OK

    async def test_unhandled_exception_renders_internal_error_envelope(self) -> None:
        from fastapi import APIRouter

        boom_router = APIRouter()

        @boom_router.get("/_test_boom")
        async def boom() -> None:
            raise RuntimeError("deliberate")

        app.include_router(boom_router)
        try:
            # ServerErrorMiddleware가 항상 재던지므로 raise_app_exceptions=False가
            # 필요하다. 그러지 않으면 클라이언트가 응답 대신 예외를 받는다.
            async with AsyncClient(
                transport=ASGITransport(app=app, raise_app_exceptions=False), base_url=TEST_BASE_URL
            ) as c:
                response = await c.get("/_test_boom")

            assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
            assert response.json()["error_code"] == "INTERNAL_ERROR"
        finally:
            app.router.routes = [r for r in app.router.routes if r not in boom_router.routes]
