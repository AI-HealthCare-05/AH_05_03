import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profiles import FamilyProfile


class ProfileRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, profile_id: uuid.UUID) -> FamilyProfile | None:
        return await self.session.get(FamilyProfile, profile_id)

    async def list_by_household(self, household_id: uuid.UUID, include_hidden: bool = False) -> list[FamilyProfile]:
        query = select(FamilyProfile).where(FamilyProfile.household_id == household_id)
        if not include_hidden:
            query = query.where(FamilyProfile.status == "active")
        query = query.order_by(FamilyProfile.created_at.asc())
        result = await self.session.scalars(query)
        return list(result)

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
                display_name=profile.display_name,
                relationship=profile.relationship,
                birth_date=profile.birth_date,
                gender=profile.gender,
                status=profile.status,
                row_version=profile.row_version,
            )
            .on_conflict_do_update(
                index_elements=[FamilyProfile.id],
                set_={
                    "display_name": profile.display_name,
                    "relationship": profile.relationship,
                    "birth_date": profile.birth_date,
                    "gender": profile.gender,
                    "status": profile.status,
                    "row_version": profile.row_version,
                },
            )
            .returning(FamilyProfile)
        )
        result = await self.session.scalar(stmt)
        return result or profile
