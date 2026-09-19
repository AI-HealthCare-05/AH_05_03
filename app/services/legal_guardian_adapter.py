"""법정대리인 확인 공급자. 제품이 법률 결론을 내지 않는다.

기본 구현은 확인을 시작만 하고 verified로 올리지 않는다. 출시 전 공급자를
고르기 전까지 체크박스·마스터 클릭으로 확인 완료를 만들지 않는다.
"""

from __future__ import annotations

import uuid
from typing import Protocol

from app.models.guardians import GuardianVerificationStatus


class LegalGuardianAdapter(Protocol):
    name: str

    async def start(self, *, profile_id: uuid.UUID, account_id: uuid.UUID) -> GuardianVerificationStatus: ...

    async def refresh(self, *, verification_id: uuid.UUID) -> GuardianVerificationStatus: ...


class UnavailableLegalGuardianAdapter:
    """확인 공급자가 아직 없다. pending만 만들고 verified는 주지 않는다."""

    name = "unavailable"

    async def start(self, *, profile_id: uuid.UUID, account_id: uuid.UUID) -> GuardianVerificationStatus:
        del profile_id, account_id
        return GuardianVerificationStatus.PENDING

    async def refresh(self, *, verification_id: uuid.UUID) -> GuardianVerificationStatus:
        del verification_id
        return GuardianVerificationStatus.PENDING


class MemoryLegalGuardianAdapter:
    """테스트용. 운영 경로에 넣지 않는다."""

    name = "memory"

    def __init__(self) -> None:
        self.outcomes: dict[uuid.UUID, GuardianVerificationStatus] = {}

    async def start(self, *, profile_id: uuid.UUID, account_id: uuid.UUID) -> GuardianVerificationStatus:
        del profile_id, account_id
        return GuardianVerificationStatus.PENDING

    async def refresh(self, *, verification_id: uuid.UUID) -> GuardianVerificationStatus:
        return self.outcomes.get(verification_id, GuardianVerificationStatus.PENDING)


def get_legal_guardian_adapter() -> LegalGuardianAdapter:
    return UnavailableLegalGuardianAdapter()
