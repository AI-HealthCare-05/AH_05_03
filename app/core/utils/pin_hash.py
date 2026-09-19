"""구성원 PIN Argon2id. 계정 bcrypt와 섞지 않는다."""

from __future__ import annotations

import asyncio

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

# 6자리 PIN은 잠금·지연이 1차 방어다. 해시는 솔트가 프로필마다 달라지게만 한다.
_HASHER = PasswordHasher(time_cost=1, memory_cost=8_192, parallelism=1, hash_len=32)


def hash_pin(pin: str) -> str:
    return _HASHER.hash(pin)


def verify_pin_hash(pin: str, hashed: str) -> bool:
    try:
        return _HASHER.verify(hashed, pin)
    except (VerifyMismatchError, InvalidHashError):
        return False


async def hash_pin_async(pin: str) -> str:
    return await asyncio.to_thread(hash_pin, pin)


async def verify_pin_hash_async(pin: str, hashed: str) -> bool:
    return await asyncio.to_thread(verify_pin_hash, pin, hashed)


DUMMY_PIN_HASH = hash_pin("not-a-real-member-pin")
