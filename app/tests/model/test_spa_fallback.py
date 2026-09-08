"""SPA 폴백이 무엇을 가리고 무엇을 가리지 않는가.

폴백은 클라이언트 라우팅을 위해 존재한다 — `/members/3/records` 는 서버에 파일이
없지만 화면은 있다. 그런데 **아무 경로에나 걸면 "없는 것" 과 "화면인 것" 이
구분되지 않는다.**

두 자리를 명시적으로 판다.

    /api/...      오타 난 API 요청이 HTML 을 받으면 디버깅이 지옥이 된다
    /assets/...   해시가 박힌 산출물. 여기엔 SPA 라우트가 없다

두 번째가 실제로 사고를 냈다. 배포로 청크 해시가 바뀌면 이미 열려 있던 탭은 옛
진입 청크를 들고 있고, 지연 로딩 화면으로 이동하면 없는 파일을 찾는다. 폴백이
`index.html` 을 **200 과 text/html** 로 돌려주면 브라우저가 그걸 모듈로 파싱하려다
`Failed to fetch dynamically imported module` 만 남긴다 — 배포 문제인지 코드가
깨진 것인지 화면에서 구분할 수 없다. 404 를 내면 원인이 그대로 드러난다.
"""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.apis import spa


@pytest.fixture()
def client(tmp_path: Path) -> Generator[TestClient, None, None]:
    """빌드 산출물을 흉내 낸 최소 트리."""
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>app</title>", encoding="utf-8")
    (tmp_path / "assets" / "index-abc123.js").write_text("export default 1;", encoding="utf-8")

    app = FastAPI()
    original = spa.STATIC_DIR
    spa.STATIC_DIR = tmp_path
    try:
        assert spa.mount(app) is True
        yield TestClient(app)
    finally:
        spa.STATIC_DIR = original


def test_client_routes_fall_back_to_index(client: TestClient) -> None:
    """서버에 파일이 없어도 화면이 있는 경로는 `index.html` 을 받는다."""
    response = client.get("/members/3/records")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    # 진입 문서는 캐시하지 않는다 — 안 그러면 새 빌드가 영영 반영되지 않는다.
    assert response.headers["cache-control"] == "no-cache"


def test_existing_asset_is_served_with_immutable_cache(client: TestClient) -> None:
    response = client.get("/assets/index-abc123.js")
    assert response.status_code == 200
    assert "immutable" in response.headers["cache-control"]


def test_missing_asset_is_a_404_not_html(client: TestClient) -> None:
    """**없는 청크는 404 다.**

    여기서 `index.html` 을 돌려주면 브라우저가 HTML 을 모듈로 파싱하다 실패하고,
    화면에는 원인을 알 수 없는 오류만 남는다.
    """
    response = client.get("/assets/InsightsPage-Cx7rN0MO.js")
    assert response.status_code == 404
    assert "text/html" not in response.headers.get("content-type", "")


def test_missing_api_path_is_a_404(client: TestClient) -> None:
    """오타 난 API 요청도 HTML 을 받지 않는다."""
    response = client.get("/api/v1/nope")
    assert response.status_code == 404
