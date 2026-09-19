"""개발·스테이징 전용 성년 전환 복구 break-glass.

프로덕션 최종 관리자 인증이 아니다. 운영 환경에서는 라우터를 등록하지 않고,
운영자 개인 계정·MFA/패스키·전용 capability·1회용 승인 토큰으로 교체할 때까지
이 모듈을 쓰지 않는다. 키 원문은 환경 변수로만 주입한다(Secret Manager).
로그·감사에 넣지 않는다.

요청 본문의 operator_id·ticket_ref 는 호출자가 적은 주장값이다. 검증된 신원이 아니다.
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timezone

from app.core import config
from app.core.config import Env


def should_mount_ops_recovery_router() -> bool:
    return config.ENV is not Env.PROD


def ops_break_glass_available() -> bool:
    if config.ENV is Env.PROD or not config.OPS_RECOVERY_ENABLED:
        return False
    return bool(config.OPS_CIVIL_MAJORITY_RECOVERY_KEY)


def _digest(value: str) -> bytes:
    return hashlib.sha256(value.encode("utf-8")).digest()


def _previous_key_usable(*, now: datetime | None = None) -> bool:
    previous = config.OPS_CIVIL_MAJORITY_RECOVERY_KEY_PREVIOUS
    expires = config.OPS_CIVIL_MAJORITY_RECOVERY_KEY_PREVIOUS_EXPIRES_AT
    if not previous or expires is None:
        return False
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    clock = now or datetime.now(tz=timezone.utc)
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=timezone.utc)
    return clock < expires


def presented_key_matches(presented: str, *, now: datetime | None = None) -> str | None:
    """맞으면 키 세대 식별자만 돌려준다. 원문은 반환하지 않는다."""
    if not presented or not ops_break_glass_available():
        return None
    current = config.OPS_CIVIL_MAJORITY_RECOVERY_KEY
    presented_digest = _digest(presented)
    if current and hmac.compare_digest(presented_digest, _digest(current)):
        return config.OPS_CIVIL_MAJORITY_RECOVERY_KEY_ID or "current"
    previous = config.OPS_CIVIL_MAJORITY_RECOVERY_KEY_PREVIOUS
    if previous and _previous_key_usable(now=now) and hmac.compare_digest(presented_digest, _digest(previous)):
        return "previous"
    return None


def break_glass_audit_metadata(*, key_id: str, operator_id: str, ticket_ref: str) -> dict[str, str]:
    return {
        "asserted_operator_id": operator_id,
        "asserted_ticket_ref": ticket_ref,
        "authentication_method": "ops_recovery_key",
        "identity_verified": "false",
        "key_id": key_id,
        "env": str(config.ENV),
    }


def ops_recovery_client_identity(*, peer_host: str, x_forwarded_for: str | None) -> str:
    """소켓 peer 가 신뢰 프록시일 때만 X-Forwarded-For 를 본다.

    이 저장소 nginx 는 `$proxy_add_x_forwarded_for` 로 hop 을 **뒤에 붙인다**.
    맨 오른쪽은 직전 프록시일 수 있으므로, 오른쪽부터 신뢰 목록을 건너뛰고
    처음 만나는 비신뢰 hop 을 클라이언트로 쓴다. peer 가 allowlist 밖이면 헤더를 무시한다.
    """
    peer = (peer_host or "unknown").strip() or "unknown"
    trusted = {item.strip() for item in config.OPS_RECOVERY_TRUSTED_PROXY_IPS.split(",") if item.strip()}
    if peer not in trusted:
        return peer
    hops = [item.strip() for item in (x_forwarded_for or "").split(",") if item.strip()]
    for hop in reversed(hops):
        if hop not in trusted:
            return hop
    return peer
