from typing import Annotated

from fastapi import Depends

from app.core.db.session import SessionDep
from app.dtos.households import HouseholdData, HouseholdListData
from app.models.service_accounts import ServiceAccount
from app.repositories.household_repository import HouseholdRepository


def get_household_repository(session: SessionDep) -> HouseholdRepository:
    return HouseholdRepository(session)


class HouseholdService:
    def __init__(
        self,
        session: SessionDep,
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
    ) -> None:
        self.session = session
        self.household_repo = household_repo

    async def create(self, account: ServiceAccount) -> HouseholdData:
        household = await self.household_repo.create_for_account(account.id)
        await self.session.commit()
        await self.session.refresh(household)
        return HouseholdData.model_validate(household)

    async def list_for_account(self, account: ServiceAccount) -> HouseholdListData:
        households = await self.household_repo.list_for_account(account.id)
        return HouseholdListData(items=[HouseholdData.model_validate(item) for item in households])
