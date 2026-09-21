"""프록시 뒤에 있는 실제 접속 IP.

FastAPI 는 nginx 만 본다. CloudFront 가 붙인 시청자 IP 는 `X-Forwarded-For` 에 있다.
헤더는 클라이언트가 위조할 수 있으므로, **소켓 peer 가 사설망(nginx)일 때만** 읽고
오른쪽에서 nginx 가 붙인 한 홉을 건너뛴다.

예: `spoof, viewer, cloudfront` → viewer.
직접 공개 IP 로 온 요청의 헤더는 믿지 않는다.
"""

from __future__ import annotations

import ipaddress

from starlette.requests import Request


def _parse_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(value.strip())
    except ValueError:
        return None


def is_unusable_client_ip(value: str | None) -> bool:
    """루프백·사설·링크로컬은 시청자 IP 로 쓰지 않는다."""
    if not value or value in {"localhost", "testclient", "unknown"}:
        return True
    parsed = _parse_ip(value)
    if parsed is None:
        return True
    return bool(
        parsed.is_loopback
        or parsed.is_private
        or parsed.is_link_local
        or parsed.is_multicast
        or parsed.is_unspecified
    )


def client_ip_from_forwarded(
    *,
    peer_host: str | None,
    x_forwarded_for: str | None,
    x_real_ip: str | None = None,
) -> str | None:
    peer = (peer_host or "").strip() or None
    hops = [item.strip() for item in (x_forwarded_for or "").split(",") if item.strip()]

    if peer and not is_unusable_client_ip(peer):
        return peer

    # peer 가 nginx(사설)이면 XFF 의 끝은 `$remote_addr`(CloudFront 또는 클라이언트)다.
    if len(hops) >= 2:
        candidate = hops[-2]
        if not is_unusable_client_ip(candidate):
            return candidate
    if hops:
        candidate = hops[-1]
        if not is_unusable_client_ip(candidate):
            return candidate

    real_ip = (x_real_ip or "").strip() or None
    if real_ip and not is_unusable_client_ip(real_ip):
        return real_ip
    return None


def client_ip_from_request(request: Request) -> str | None:
    peer = request.client.host if request.client else None
    return client_ip_from_forwarded(
        peer_host=peer,
        x_forwarded_for=request.headers.get("x-forwarded-for"),
        x_real_ip=request.headers.get("x-real-ip"),
    )
