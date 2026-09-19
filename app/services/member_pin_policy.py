"""위임 PIN 형식. DEK·계정 비밀번호가 아니다."""

from __future__ import annotations

import secrets

COMMON_PINS = frozenset({"000000", "111111", "123456", "654321", "123123", "112233", "121212"})
PIN_MAX_ATTEMPTS = 5
PIN_LOCK_SECONDS = 5 * 60
PIN_SESSION_SECONDS = 5 * 60


def is_weak_pin(pin: str, birth_date: str | None = None) -> bool:
    if not pin.isdigit() or len(pin) < 6:
        return True
    if len(pin) == 6 and pin in COMMON_PINS:
        return True
    if all(digit == pin[0] for digit in pin):
        return True
    digits = [int(digit) for digit in pin]
    sequential_up = all(digit == (digits[index - 1] + 1) % 10 for index, digit in enumerate(digits) if index)
    sequential_down = all(digit == (digits[index - 1] + 9) % 10 for index, digit in enumerate(digits) if index)
    if sequential_up or sequential_down:
        return True
    if birth_date:
        compact = birth_date.replace("-", "")
        if len(compact) >= 6 and pin in {compact[:6], compact[-6:], compact[2:8]}:
            return True
    return False


def generate_temporary_pin(birth_date: str | None = None) -> str:
    for _ in range(32):
        pin = f"{secrets.randbelow(1_000_000):06d}"
        if not is_weak_pin(pin, birth_date):
            return pin
    raise RuntimeError("임시 PIN을 만들지 못했습니다.")
