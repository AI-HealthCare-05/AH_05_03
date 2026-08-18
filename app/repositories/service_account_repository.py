import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.service_accounts import ServiceAccount, ServiceAccountStatus


class ServiceAccountRepository:
    """DB 접근만 담당한다. 커밋은 서비스가 한다 (flush까지만)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_all(self) -> Sequence[ServiceAccount]:
        return (await self.session.scalars(select(ServiceAccount))).all()

    async def get_by_id(self, account_id: uuid.UUID) -> ServiceAccount | None:
        # identity map에 이미 있으면 SQL을 내지 않는다.
        return await self.session.get(ServiceAccount, account_id)

    async def get_by_email(self, email: str) -> ServiceAccount | None:
        return await self.session.scalar(select(ServiceAccount).where(ServiceAccount.email == email))

    async def exists_by_email(self, email: str) -> bool:
        return bool(await self.session.scalar(select(exists().where(ServiceAccount.email == email))))

    async def create(self, email: str, password_hash: str) -> ServiceAccount:
        account = ServiceAccount(email=email, password_hash=password_hash)
        self.session.add(account)
        # commit이 아니라 flush다. id(Python 측 uuid4 기본값)를 채우고
        # IntegrityError를 서비스가 잡을 수 있는 시점에 띄운다.
        await self.session.flush()
        return account

    async def set_status(
        self,
        account: ServiceAccount,
        status: ServiceAccountStatus,
        closed_at: datetime | None = None,
    ) -> ServiceAccount:
        account.status = status
        if closed_at is not None:
            account.closed_at = closed_at
        await self.session.flush()
        return account

    async def update_instance(self, account: ServiceAccount, data: dict[str, object]) -> ServiceAccount:
        for key, value in data.items():
            if value is not None:
                setattr(account, key, value)
        # updated_at은 onupdate=func.now()가 처리한다. 손으로 넣지 않는다.
        await self.session.flush()
        return account
