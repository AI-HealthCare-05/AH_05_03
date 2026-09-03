"""빌드된 프런트엔드(SPA)를 FastAPI 가 직접 서빙한다.

원래는 nginx:alpine 컨테이너가 `frontend/dist` 를 들고 있었고 리버스 프록시가
`/` 를 그쪽으로, `/api/` 를 FastAPI 로 갈랐다. 컨테이너를 하나 줄이면서 그 역할을
여기로 옮긴다. **정책은 옮기되 바꾸지 않는다** — `frontend/nginx.conf` 가 걸던
보안 헤더·캐시 수명·SPA 폴백을 그대로 재현한다.

옮기면서 조심할 것이 셋이다.

**하나. SPA 폴백.** 라우팅이 클라이언트 쪽에 있어서 `/members/3/records` 같은 경로는
서버에 파일이 없다. nginx 의 ``try_files $uri $uri/ /index.html`` 을 그대로 옮겨,
파일이 없으면 `index.html` 을 돌려주고 브라우저가 라우팅하게 둔다.

**둘. API 를 가리면 안 된다.** 폴백을 아무 경로에나 걸면 오타 난 API 요청이 404 대신
HTML 을 받는다. 디버깅이 지옥이 되므로 `/api` 로 시작하면 폴백을 태우지 않고
FastAPI 의 404 를 그대로 낸다.

**셋. CSP 를 `/api/docs` 에 걸면 Swagger 가 깨진다.** nginx 는 프런트 컨테이너에만
헤더를 붙였으므로 API 쪽은 원래 CSP 가 없었다. 여기서 전역 미들웨어로 붙이면
Swagger UI 가 CDN 에서 받아오는 스크립트가 `script-src 'self'` 에 걸려 막힌다.
그래서 정적 응답에만 붙인다.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

# 컨테이너에서는 이미지 안에 구운 경로, 로컬에서는 저장소의 빌드 산출물.
# 둘 다 없으면 정적 서빙을 통째로 건너뛴다 — 프런트를 빌드하지 않은 개발 환경과
# 테스트에서 앱이 죽지 않아야 한다.
STATIC_DIR = Path(os.environ.get("FRONTEND_DIST", "/app/static"))
REPO_STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"

# `frontend/nginx.conf` 의 add_header 를 그대로 옮긴 것. 값은 한 글자도 바꾸지 않는다.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        "connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; "
        "frame-ancestors 'none'"
    ),
}

# 사람이 칠 법한 짧은 주소 -> 정본. 데모 화면이 `/api/` 아래 있는 것은 nginx 가
# `/api/` 만 프록시하던 시절의 흔적인데, 주소를 옮기면 기존 링크가 깨지므로
# 짧은 쪽을 리다이렉트로 살려 둔다.
SHORTCUTS = {
    "/demo": "/api/demo",
    "/demo/rules": "/api/demo/rules",
    "/docs": "/api/docs",
}

# 파일명에 해시가 박히는 산출물만 영구 캐시한다. index.html 은 매번 새로 받아야
# 새 빌드가 반영된다 — 그래서 nginx 도 `/` 에만 no-cache 를 걸었다.
IMMUTABLE_PREFIXES = ("/assets/", "/vendor/")
IMMUTABLE_SUFFIXES = (".glb",)


def resolve_static_dir() -> Path | None:
    for candidate in (STATIC_DIR, REPO_STATIC_DIR):
        if candidate.is_dir() and (candidate / "index.html").is_file():
            return candidate
    return None


def _cache_control(path: str) -> str:
    if path.startswith(IMMUTABLE_PREFIXES) or path.endswith(IMMUTABLE_SUFFIXES):
        return "public, max-age=31536000, immutable"
    return "no-cache"


class SecureStaticFiles(StaticFiles):
    """StaticFiles 에 nginx 가 걸던 헤더를 붙인다."""

    async def get_response(self, path: str, scope) -> Response:  # type: ignore[no-untyped-def]
        response = await super().get_response(path, scope)
        response.headers.update(SECURITY_HEADERS)
        response.headers["Cache-Control"] = _cache_control(f"/{path}")
        return response


def mount(app: FastAPI) -> bool:
    """정적 서빙과 SPA 폴백을 붙인다. 빌드 산출물이 없으면 아무것도 안 하고 False.

    **반드시 API 라우터를 등록한 뒤에 부른다.** 폴백이 catch-all 이라 먼저 붙으면
    그 뒤의 라우트가 전부 가려진다.
    """
    static_dir = resolve_static_dir()
    if static_dir is None:
        return False

    index = static_dir / "index.html"

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> PlainTextResponse:
        """컴포즈 헬스체크. nginx 컨테이너가 갖고 있던 것을 그대로 옮겼다."""
        return PlainTextResponse("ok\n")

    # `/assets`, `/vendor` 같은 실제 파일은 여기서 처리된다. html=False 로 두는 이유는
    # 폴백을 아래 catch-all 한 곳에서만 다루기 위해서다 — 두 군데서 하면
    # "왜 이 경로만 index.html 이 아니지" 를 언젠가 디버깅하게 된다.
    app.mount("/static", SecureStaticFiles(directory=static_dir), name="static")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(request: Request, full_path: str) -> Response:
        # API 는 절대 가리지 않는다. 오타 난 요청은 HTML 이 아니라 404 를 받아야 한다.
        if full_path.startswith("api/"):
            return Response(status_code=404)

        # 데모 화면은 `/api/` 아래 있는데 사람은 `/demo` 를 친다. 실제로 그렇게 치고
        # SPA 404 를 받은 적이 있어서 짧은 주소를 살려 둔다. 정본은 `/api/demo` 다.
        redirect = SHORTCUTS.get(f"/{full_path}".rstrip("/") or "/")
        if redirect:
            return RedirectResponse(redirect, status_code=307)

        candidate = (static_dir / full_path).resolve()
        # 경로 탈출 방지. `..` 이 섞여 들어와도 정적 디렉터리 밖으로 못 나간다.
        inside = static_dir.resolve() in candidate.parents or candidate == static_dir.resolve()
        if full_path and inside and candidate.is_file():
            return FileResponse(
                candidate,
                headers={**SECURITY_HEADERS, "Cache-Control": _cache_control(f"/{full_path}")},
            )
        return FileResponse(index, headers={**SECURITY_HEADERS, "Cache-Control": "no-cache"})

    return True
