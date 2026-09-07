from typing import Annotated, Any
from urllib.parse import urlsplit

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import config
from app.dependencies.services import get_token_store
from app.exceptions import (
    AccountClosedError,
    AccountNotFoundError,
    AccountSuspendedError,
    AuthRequiredError,
    OriginNotAllowedError,
    TokenInvalidError,
)
from app.models.service_accounts import ServiceAccount, ServiceAccountStatus
from app.repositories.service_account_repository import ServiceAccountRepository
from app.services.auth import get_account_repository
from app.services.jwt import JwtService, account_id_from_payload
from app.services.token_store import TokenStore

# auto_error=False로 둔다. FastAPI가 기본으로 내리는 401 {"detail": "..."}
# 대신 우리 봉투로 통일해서 내려야 하므로, 여기서 직접 AuthRequiredError를 던진다.
security = HTTPBearer(auto_error=False)


def is_same_origin(request: Request, origin: str) -> bool:
    """`origin` 이 이 요청이 도착한 바로 그 사이트인가.

    **호스트만 본다. 스킴은 안 본다.** TLS 를 끊는 CDN·터널 뒤에서는 스킴을 맞출
    방법이 없기 때문이다 — Cloudflare 가 https 를 받아 평문으로 nginx 에 넘기면
    nginx 의 `$scheme` 은 `http` 이고, `proxy_set_header X-Forwarded-Proto $scheme`
    이 앞단이 보낸 `https` 를 그 값으로 덮어쓴다. 브라우저는 `https://...` Origin 을
    보내므로 스킴까지 요구하면 절대 못 맞춘다. 2026-09-04 에 이 조합을 그대로
    재현해 403 을 확인했다(nginx 쪽도 같이 고쳤지만, 앞단 설정은 우리 손 밖이라
    여기서 스킴에 기대지 않는 것이 맞다).

    호스트만 봐도 CSRF 는 그대로 막힌다. 남의 사이트가 유도한 요청은 Origin 의
    호스트가 그 사이트이고 `Host` 는 우리 것이라 어긋나며, 브라우저는 스크립트로
    `Host` 를 바꾸지 못한다. 포트는 `netloc` 에 함께 들어 있어 `Host` 헤더와 같은
    모양으로 비교된다 — 기본 포트는 양쪽 다 생략되므로 `:5173` 같은 개발 오리진도
    정확히 갈린다.
    """

    host = request.headers.get("host")
    if not host:
        return False
    return urlsplit(origin).netloc.lower() == host.lower()


def request_origin(request: Request) -> str | None:
    """이 요청이 실제로 도착한 주소를 `scheme://host[:port]` 로 되돌린다.

    SPA 를 FastAPI 가 직접 서빙하므로(`main.py` 의 `spa.mount`) 프런트의 Origin 은
    언제나 이 값이다. 배포 도메인을 설정에 미리 적어 두지 않아도 되는 근거다.

    `Host` 는 nginx 가 `proxy_set_header Host $host` 로 원본을 넘겨 준다. 스킴은
    **`request.url.scheme` 이 아니라 `X-Forwarded-Proto` 를 먼저 본다** — uvicorn 의
    `forwarded_allow_ips` 기본값은 `127.0.0.1` 인데 nginx 는 다른 컨테이너 IP 로
    오므로 프록시 헤더가 무시된다. 그러면 HTTPS 뒤에서도 `request.url.scheme` 이
    `http` 로 남아, 브라우저가 보낸 `https://...` Origin 과 어긋난다.
    """

    host = request.headers.get("host")
    if not host:
        return None
    forwarded = request.headers.get("x-forwarded-proto")
    # 프록시가 여러 단이면 쉼표로 이어 붙는다. 클라이언트에 가장 가까운 앞쪽이 원본이다.
    scheme = forwarded.split(",")[0].strip() if forwarded else request.url.scheme
    return f"{scheme}://{host}"


def require_trusted_origin(request: Request) -> None:
    """브라우저의 쿠키 인증 요청이 허용된 프론트에서 왔는지 확인한다.

    Origin이 없는 CLI·서버 간 호출은 쿠키를 자동 첨부할 수 없으므로 허용한다.
    브라우저의 상태 변경 요청은 Origin이 붙고, 정확히 일치해야 한다.

    **자기 자신과 같은 Origin 은 설정 없이 통과시킨다.** 이것이 없으면 배포한
    도메인을 `CORS_ALLOW_ORIGINS` 에 손으로 적어 넣기 전까지 그 사이트의
    회원가입·로그인이 **전부** 403 으로 막힌다. `/auth` 라우터 전체가 이 검사를
    물고 있고 기본값은 localhost 넷뿐이라, 브라우저는 같은 출처의 POST 에도
    `Origin` 을 붙이기 때문이다. 2026-09-04 배포에서 실제로 그랬다 — API 는
    멀쩡한데 화면에는 "허용되지 않은 출처의 인증 요청입니다" 만 떴다.

    CSRF 방어는 그대로다. 남의 사이트에서 유도한 요청은 `Origin` 이 그 사이트로,
    `Host` 는 우리 것으로 오므로 둘이 어긋난다. 브라우저는 스크립트로 `Host` 를
    바꾸지 못하니 공격자가 이 일치를 만들어 낼 수 없다.

    `CORS_ALLOW_ORIGINS` 는 그대로 남는다. 프런트를 다른 오리진에 따로 띄우는
    개발(vite `:5173` → API `:8000`)은 여전히 그 목록이 있어야 한다.
    """

    origin = request.headers.get("origin")
    if origin is None:
        return

    candidate = origin.rstrip("/")
    allowed = {item.rstrip("/") for item in config.CORS_ALLOW_ORIGINS}
    if candidate in allowed:
        return

    if is_same_origin(request, candidate):
        return

    raise OriginNotAllowedError()


def get_refresh_token_cookie(request: Request) -> str:
    token = request.cookies.get(config.REFRESH_COOKIE_NAME)
    if not token:
        raise TokenInvalidError("Refresh Token 쿠키가 필요합니다.")
    return token


async def get_access_token_payload(
    credential: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    token_store: Annotated[TokenStore, Depends(get_token_store)],
) -> dict[str, Any]:
    if credential is None:
        raise AuthRequiredError()

    payload = JwtService().verify_jwt(token=credential.credentials, token_type="access").payload
    # denylist 조회. logout이 여기 jti를 등록해 즉시 무효화한다.
    await token_store.assert_access_active(str(payload["jti"]))
    return payload


async def get_current_account(
    payload: Annotated[dict[str, Any], Depends(get_access_token_payload)],
    account_repo: Annotated[ServiceAccountRepository, Depends(get_account_repository)],
) -> ServiceAccount:
    account_id = account_id_from_payload(payload)
    account = await account_repo.get_by_id(account_id)
    if not account:
        raise AccountNotFoundError()
    return account


async def require_active_account(
    account: Annotated[ServiceAccount, Depends(get_current_account)],
) -> ServiceAccount:
    """업무용 라우트가 쓴다. logout·계정 해지처럼 상태 무관하게 동작해야
    하는 라우트는 get_current_account를 직접 쓴다."""
    if account.status is ServiceAccountStatus.SUSPENDED:
        raise AccountSuspendedError()
    if account.status is ServiceAccountStatus.CLOSED:
        raise AccountClosedError()
    return account
