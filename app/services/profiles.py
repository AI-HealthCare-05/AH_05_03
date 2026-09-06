import uuid
from typing import Annotated

from fastapi import Depends

from app.core.db.session import SessionDep
from app.dtos.profiles import (
    ProfileCreateRequest,
    ProfileData,
    ProfileListData,
    ProfileSyncRequest,
    ProfileUpdateRequest,
)
from app.exceptions import (
    HouseholdMembershipRequiredError,
    HouseholdNotFoundError,
    ProfileNotFoundError,
)
from app.models.households import HouseholdStatus
from app.models.profiles import FamilyProfile
from app.models.service_accounts import ServiceAccount
from app.repositories.household_repository import HouseholdRepository
from app.repositories.profile_repository import ProfileRepository


def get_profile_repository(session: SessionDep) -> ProfileRepository:
    return ProfileRepository(session)


def get_household_repository(session: SessionDep) -> HouseholdRepository:
    return HouseholdRepository(session)


class ProfileService:
    def __init__(
        self,
        session: SessionDep,
        profile_repo: Annotated[ProfileRepository, Depends(get_profile_repository)],
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
    ) -> None:
        self.session = session
        self.profile_repo = profile_repo
        self.household_repo = household_repo

    async def _verify_household_access(self, household_id: uuid.UUID, account: ServiceAccount) -> None:
        household = await self.household_repo.get(household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        is_member = await self.household_repo.has_active_membership(household_id, account.id)
        if not is_member:
            raise HouseholdMembershipRequiredError()

    async def create_profile(self, account: ServiceAccount, req: ProfileCreateRequest) -> ProfileData:
        await self._verify_household_access(req.household_id, account)

        profile = FamilyProfile(
            id=req.id or uuid.uuid4(),
            household_id=req.household_id,
            created_by_account_id=account.id,
            display_name=req.display_name,
            relationship=req.relationship,
            birth_date=req.birth_date,
            gender=req.gender,
            status="active",
        )
        created = await self.profile_repo.create(profile)
        await self.session.commit()
        await self.session.refresh(created)
        return ProfileData.model_validate(created)

    async def list_profiles(
        self, account: ServiceAccount, household_id: uuid.UUID, include_hidden: bool = False
    ) -> ProfileListData:
        await self._verify_household_access(household_id, account)
        profiles = await self.profile_repo.list_by_household(household_id, include_hidden=include_hidden)
        return ProfileListData(items=[ProfileData.model_validate(p) for p in profiles])

    async def get_profile(self, account: ServiceAccount, profile_id: uuid.UUID) -> ProfileData:
        profile = await self.profile_repo.get(profile_id)
        if profile is None:
            raise ProfileNotFoundError()
        await self._verify_household_access(profile.household_id, account)
        return ProfileData.model_validate(profile)

    async def update_profile(
        self, account: ServiceAccount, profile_id: uuid.UUID, req: ProfileUpdateRequest
    ) -> ProfileData:
        profile = await self.profile_repo.get(profile_id)
        if profile is None:
            raise ProfileNotFoundError()
        await self._verify_household_access(profile.household_id, account)

        if req.display_name is not None:
            profile.display_name = req.display_name
        if req.relationship is not None:
            profile.relationship = req.relationship
        if req.birth_date is not None:
            profile.birth_date = req.birth_date
        if req.gender is not None:
            profile.gender = req.gender
        if req.status is not None:
            profile.status = req.status

        profile.row_version += 1
        await self.session.commit()
        await self.session.refresh(profile)
        return ProfileData.model_validate(profile)

    async def delete_profile(self, account: ServiceAccount, profile_id: uuid.UUID) -> None:
        profile = await self.profile_repo.get(profile_id)
        if profile is None:
            raise ProfileNotFoundError()
        await self._verify_household_access(profile.household_id, account)

        profile.status = "hidden"
        profile.row_version += 1
        await self.session.commit()

    async def sync_profiles(self, account: ServiceAccount, req: ProfileSyncRequest) -> ProfileListData:
        results: list[ProfileData] = []
        for p in req.profiles:
            await self._verify_household_access(p.household_id, account)
            model = FamilyProfile(
                id=p.id,
                household_id=p.household_id,
                created_by_account_id=account.id,
                display_name=p.display_name,
                relationship=p.relationship,
                birth_date=p.birth_date,
                gender=p.gender,
                status=p.status,
                row_version=p.row_version,
            )
            saved = await self.profile_repo.upsert(model)
            results.append(ProfileData.model_validate(saved))
        await self.session.commit()
        return ProfileListData(items=results)
