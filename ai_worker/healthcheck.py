"""ai-worker 컨테이너 헬스체크.

    uv run --no-sync python -m ai_worker.healthcheck

**"떠 있음"과 "큐를 소비 중"은 다르다.** 프로세스가 살아 있어도 Redis 연결이 끊겼거나
모델 볼륨이 안 붙었으면 작업을 하나도 처리하지 못한다. 그 상태를 건강하다고 보고하면
`restart: always` 가 되살릴 기회를 잃는다.

세 가지를 본다.

1. Redis 에 닿는가
2. 예측·OCR 소비자 그룹 **둘 다** 내 이름이 등록돼 있는가 — 각 `run_forever` 가
   `XREADGROUP` 을 한 번은 돌았다는 뜻이다. 한쪽 루프만 죽은 상태도 가른다
3. 위험도 모델이 적재됐는가

종료 코드 0 이면 건강, 1 이면 아니다. 출력은 도커 로그에 남으므로 **건강 수치를 찍지
않는다** — 여기서 다루는 것은 소비자 이름과 개수뿐이다.
"""

from __future__ import annotations

import asyncio
import os
import socket
import sys
from typing import Any, cast

from redis.exceptions import RedisError

from app.core import config
from app.services.risk import registry

# `consumer.py` 와 같은 규칙으로 이름을 만들어야 자기 등록을 찾을 수 있다.
# 헬스체크는 별도 프로세스라 pid 가 다르므로 hostname 만 비교한다.
HOSTNAME = socket.gethostname()


async def check() -> tuple[bool, str]:
    from ai_worker.consumer import build_redis

    if not registry.available:
        return False, "모델이 적재되지 않았다 (/app/models 마운트 확인)"

    redis = build_redis()
    try:
        await redis.ping()
        targets = (
            ("predict", f"{config.REDIS_KEY_PREFIX}:predict:stream", config.PREDICTION_JOB_STREAM_GROUP),
            ("ocr", f"{config.REDIS_KEY_PREFIX}:ocr:stream", config.DEV_OCR_JOB_STREAM_GROUP),
        )
        consumers_by_target = {
            target: cast(
                list[dict[str, Any]],
                await cast(Any, redis).xinfo_consumers(stream, group),
            )
            for target, stream, group in targets
        }
    except RedisError as err:
        return False, f"Redis 에 닿지 못했다: {type(err).__name__}"
    finally:
        await redis.aclose()

    mine_by_target = {
        target: [c for c in consumers if str(c.get("name", "")).startswith(f"{HOSTNAME}-")]
        for target, consumers in consumers_by_target.items()
    }
    missing = [target for target, mine in mine_by_target.items() if not mine]
    if missing:
        return False, f"소비자 그룹({','.join(missing)})에 {HOSTNAME} 등록이 없다 — 해당 루프에 못 들어갔다"

    mine = [consumer for consumers in mine_by_target.values() for consumer in consumers]
    idle = min(int(c.get("idle", 0) or 0) for c in mine)
    return True, f"consumer={mine[0].get('name')} queues=2 idle={idle}ms targets={len(registry.targets())}"


def main() -> int:
    try:
        healthy, detail = asyncio.run(check())
    except Exception as err:  # noqa: BLE001 - 헬스체크가 예외로 죽으면 판정이 안 나온다
        print(f"unhealthy: {type(err).__name__}: {err}", file=sys.stderr)
        return 1
    print(f"{'healthy' if healthy else 'unhealthy'}: {detail}")
    return 0 if healthy else 1


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    raise SystemExit(main())
