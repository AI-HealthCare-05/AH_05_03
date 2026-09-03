"""비밀번호 해싱.

**bcrypt 는 일부러 느리다.** 이 이미지에서 1 회 206ms 다. 그 느림이 무차별 대입을
막아 주는 값어치이므로 라운드를 낮춰서는 안 된다 — 대신 **이벤트 루프 밖에서** 돌린다.

동기 함수를 async 핸들러 안에서 그냥 부르면 그 206ms 동안 이 워커의 이벤트 루프가
통째로 멈춘다. 로그인만 느려지는 게 아니라 그 시간 동안 도착한 Redis 응답도 못 읽어서,
0.5 초 소켓 타임아웃에 걸린 요청이 `TimeoutError` -> 503 으로 떨어졌다.

2026-08-27 실측 — 동시 로그인 80 건이 17.0 초(= 206ms x 80, 완전 직렬)에 3 건 503.
`asyncio.to_thread` 로 옮긴 뒤 같은 부하가 1.5 초, 503 은 0 건이다.
`bcrypt` 확장은 해싱 중 GIL 을 놓으므로 스레드로 옮기면 실제로 코어를 나눠 쓴다.

동기 판은 남겨 둔다. import 시점에 쓰는 더미 해시와 테스트가 그걸 부른다.
**async 핸들러 안에서는 반드시 `_async` 판을 써라.**
"""

import asyncio

from passlib.context import CryptContext

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


async def hash_password_async(password: str) -> str:
    """이벤트 루프를 막지 않는 `hash_password`."""
    return await asyncio.to_thread(hash_password, password)


async def verify_password_async(plain_password: str, hashed_password: str) -> bool:
    """이벤트 루프를 막지 않는 `verify_password`."""
    return await asyncio.to_thread(verify_password, plain_password, hashed_password)
