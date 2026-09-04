"""Redis 소비자가 기동·순단을 견디게 하는 공용 헬퍼.

**`app/core` 에 두는 이유.** 이걸 쓰는 소비자가 셋이고 두 이미지에 나뉘어 있다 —
`ai_worker` 의 예측·문서 인식 소비자와 `app/workers` 의 초대 메일 소비자다. 처음에
`ai_worker/core/` 에 뒀는데 메일 워커는 fastapi 이미지에서 도므로 그쪽을 import 할 수
없다. 두 벌로 두면 한쪽만 고치는 사고가 나고, 그 사고의 증상이 아래에 적힌 그것이다.

## 이 파일이 막는 사고

`ensure_group()` 을 `run_forever` 첫 줄에서 그냥 await 하면, 기동 순간 Redis 가 아직
안 떴거나 잠깐 끊긴 것만으로 소비자가 죽는다. 죽은 뒤가 더 나쁘다 — 호출부가 예외를
삼키고 정상 반환하면 프로세스가 **종료 코드 0** 으로 끝나고, `restart: always` 가
되살려 같은 자리에서 또 죽는다. Redis 가 살아나도 스스로 회복하지 못한다.
실제로 ai-worker 를 `Restarting (0)` 상태로 발견했다.

`depends_on: service_healthy` 가 있으니 안 그럴 것 같지만 그것은 **최초 기동**만 막아
준다. 운영 중 Redis 재시작·네트워크 순단은 게이트 밖의 일이다.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable

from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import ResponseError
from redis.exceptions import TimeoutError as RedisTimeoutError

# 첫 재시도 간격과 상한. 지수 증가는 Redis 가 오래 죽어 있을 때 로그가
# 초당 한 줄씩 쌓이는 것을 막는다.
INITIAL_DELAY_SECONDS = 1.0
MAX_DELAY_SECONDS = 30.0


async def ensure_group_with_retry(
    ensure: Callable[[], Awaitable[None]],
    stopping: asyncio.Event,
    logger: logging.Logger,
) -> bool:
    """`ensure` 가 성공할 때까지 재시도한다. 성공하면 True.

    SIGTERM 을 받아 `stopping` 이 서면 False 를 돌려주고, 호출부는 루프에 들어가지
    않고 곧장 정상 종료한다 — Redis 를 기다리는 중에 내린 종료 지시가 무시되면
    `docker compose down` 이 타임아웃까지 매달린다.

    **연결 계열 예외만 삼킨다.** `ResponseError` 같은 것은 재시도해도 같은 답이므로
    그대로 올려 보내 프로세스가 죽고 사람이 보게 한다.
    """
    delay = INITIAL_DELAY_SECONDS
    attempt = 0
    while not stopping.is_set():
        try:
            await ensure()
        except (RedisConnectionError, RedisTimeoutError) as error:
            attempt += 1
            logger.warning(
                "Redis 에 닿지 못했다 (%s). %.0f초 뒤 재시도 · attempt=%d",
                type(error).__name__,
                delay,
                attempt,
            )
            # `wait_for` 로 재우면 대기 중에 SIGTERM 이 와도 즉시 깨어난다.
            # 타임아웃은 "아직 종료 지시가 없다" 는 정상 흐름이라 삼킨다.
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stopping.wait(), timeout=delay)
            delay = min(delay * 2, MAX_DELAY_SECONDS)
            continue
        if attempt:
            logger.info("Redis 연결 복구 · attempt=%d", attempt)
        return True
    return False


def is_missing_group(error: BaseException) -> bool:
    """ "소비자 그룹이 없다" 인가.

    **이 스택에서는 예외 상황이 아니라 정상 사건이다.** Redis 는 지속화를 꺼 두었으므로
    (ADR-010 §6 — 큐에 건강 수치와 검진표 원본이 흐른다) 재시작하면 스트림과 소비자
    그룹이 통째로 사라진다. 그러면 살아 있던 소비자의 `XREADGROUP` 이 이렇게 답한다.

        NOGROUP No such key 'ieobom:ocr:stream' or consumer group 'ocr-workers'

    `ResponseError` 라 연결 계열 재시도에 걸리지 않아 소비자가 죽는다. 실제로 Redis 를
    한 번 껐다 켜 보고 발견했다 — 프로세스가 죽고 `restart: always` 가 되살리면서
    `ensure_group` 이 다시 만들어 결과적으로는 회복했지만, 그건 회복이 아니라 사고다.
    그동안 처리 중이던 작업이 함께 죽는다.
    """
    return isinstance(error, ResponseError) and "NOGROUP" in str(error)
