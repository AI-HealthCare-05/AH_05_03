import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profiles import FamilyProfile, LifecycleStatus


class ProfileRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, profile_id: uuid.UUID) -> FamilyProfile | None:
        return await self.session.get(FamilyProfile, profile_id)

    async def get_for_update(self, profile_id: uuid.UUID) -> FamilyProfile | None:
        return await self.session.scalar(select(FamilyProfile).where(FamilyProfile.id == profile_id).with_for_update())

    async def list_by_household(self, household_id: uuid.UUID, include_hidden: bool = False) -> list[FamilyProfile]:
        query = select(FamilyProfile).where(
            FamilyProfile.household_id == household_id,
            FamilyProfile.lifecycle_status != LifecycleStatus.DELETED,
        )
        if not include_hidden:
            query = query.where(
                FamilyProfile.status == "active",
                FamilyProfile.lifecycle_status != LifecycleStatus.UNSHARED,
            )
        else:
            query = query.where(FamilyProfile.lifecycle_status != LifecycleStatus.UNSHARED)
        query = query.order_by(FamilyProfile.created_at.asc())
        result = await self.session.scalars(query)
        return list(result)

    async def list_due_for_purge(self, now: datetime) -> list[FamilyProfile]:
        query = (
            select(FamilyProfile)
            .where(
                FamilyProfile.lifecycle_status == LifecycleStatus.PENDING_DELETE,
                FamilyProfile.purge_after.is_not(None),
                FamilyProfile.purge_after <= now,
                FamilyProfile.purged_at.is_(None),
            )
            .with_for_update()
        )
        result = await self.session.scalars(query)
        return list(result)

    async def find_active_claim(
        self, household_id: uuid.UUID, *, account_id: uuid.UUID | None = None, account_email: str | None = None
    ) -> FamilyProfile | None:
        query = select(FamilyProfile).where(
            FamilyProfile.household_id == household_id,
            FamilyProfile.lifecycle_status == LifecycleStatus.ACTIVE,
        )
        if account_id is not None:
            query = query.where(FamilyProfile.claimed_account_id == account_id)
        elif account_email is not None:
            query = query.where(FamilyProfile.account_email == account_email)
        else:
            return None
        return await self.session.scalar(query)

    async def create(self, profile: FamilyProfile) -> FamilyProfile:
        self.session.add(profile)
        await self.session.flush()
        return profile

    async def upsert(self, profile: FamilyProfile) -> FamilyProfile:
        stmt = (
            pg_insert(FamilyProfile)
            .values(
                id=profile.id,
                household_id=profile.household_id,
                created_by_account_id=profile.created_by_account_id,
                claimed_account_id=profile.claimed_account_id,
                display_name=profile.display_name,
                relationship=profile.relationship,
                birth_date=profile.birth_date,
                gender=profile.gender,
                account_email=profile.account_email,
                status=profile.status,
                ownership_type=profile.ownership_type,
                lifecycle_status=profile.lifecycle_status,
                member_role=profile.member_role,
                row_version=profile.row_version,
            )
            .on_conflict_do_update(
                index_elements=[FamilyProfile.id],
                set_={
                    "display_name": profile.display_name,
                    "relationship": profile.relationship,
                    "birth_date": profile.birth_date,
                    "gender": profile.gender,
                    "account_email": profile.account_email,
                    "status": profile.status,
                    "ownership_type": profile.ownership_type,
                    "lifecycle_status": profile.lifecycle_status,
                    "member_role": profile.member_role,
                    "claimed_account_id": profile.claimed_account_id,
                    "row_version": profile.row_version,
                },
            )
            .returning(FamilyProfile)
        )
        result = await self.session.scalar(stmt)
        return result or profile
