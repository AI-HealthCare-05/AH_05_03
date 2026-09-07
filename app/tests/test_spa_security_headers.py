"""정적 응답에 붙는 보안 헤더 계약.

**왜 이 파일이 생겼나.** CSP 를 넓히는 변경이 조용히 지나가면 안 되기 때문이다.
`img-src` 에 `blob:` 을 더한 이유는 판정 화면이 올린 검진표를 폼 옆에 띄우기
위해서인데(`app/apis/spa.py` 참조), 그 한 줄에 딸린 두 가지를 여기서 못 박는다.

하나. **일반 JavaScript 실행 권한은 넓히지 않았다.** Draco 디코더에 필요한
`'wasm-unsafe-eval'`만 허용하고, 범위가 더 넓은 `'unsafe-eval'`은 허용하지 않는다.

둘. **`/api/docs` 에는 CSP 가 붙지 않는다.** Swagger UI 가 CDN 에서 받는 스크립트가
`script-src 'self'` 에 걸려 화면이 빈다 — 옮겨 오기 전 nginx 도 API 쪽에는 헤더를
붙이지 않았다.
"""

from httpx import AsyncClient


class TestStaticSecurityHeaders:
    async def test_allows_blob_images_and_draco_wasm_without_javascript_eval(
        self,
        client: AsyncClient,
    ) -> None:
        """검진표 blob과 Draco WASM만 허용하고 일반 JavaScript eval은 막는다."""
        response = await client.get("/")
        policy = response.headers.get("content-security-policy")
        if policy is None:
            # 프런트를 빌드하지 않은 환경에서는 정적 서빙 자체를 건너뛴다.
            return

        assert "img-src 'self' data: blob:" in policy
        assert "script-src 'self' 'wasm-unsafe-eval';" in policy
        assert " 'unsafe-eval'" not in policy
        assert "object-src 'none'" in policy
        assert "frame-ancestors 'none'" in policy

    async def test_api_docs_carry_no_policy(self, client: AsyncClient) -> None:
        """Swagger UI 가 CDN 에서 받는 스크립트가 `script-src 'self'` 에 걸려 화면이 빈다."""
        response = await client.get("/api/docs")

        assert "content-security-policy" not in {key.lower() for key in response.headers}
