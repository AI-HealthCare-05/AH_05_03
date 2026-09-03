import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profile_links import ProfileLink, ProfileLinkStatus


class ProfileLinkRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, link: ProfileLink) -> ProfileLink:
        self.session.add(link)
        await self.session.flush()
        return link

    async def get_for_update(self, link_id: uuid.UUID) -> ProfileLink | None:
        return await self.session.scalar(select(ProfileLink).where(ProfileLink.id == link_id).with_for_update())

    async def find_active_by_account(self, household_id: uuid.UUID, account_id: uuid.UUID) -> ProfileLink | None:
        return await self.session.scalar(
            select(ProfileLink).where(
                ProfileLink.household_id == household_id,
                ProfileLink.account_id == account_id,
                ProfileLink.status == ProfileLinkStatus.ACTIVE,
            )
        )

    async def find_active_by_profile_ref(self, household_id: uuid.UUID, profile_ref: str) -> ProfileLink | None:
        return await self.session.scalar(
            select(ProfileLink).where(
                ProfileLink.household_id == household_id,
                ProfileLink.local_profile_ref == profile_ref,
                ProfileLink.status == ProfileLinkStatus.ACTIVE,
            )
        )

    async def list_for_account(self, account_id: uuid.UUID, household_id: uuid.UUID | None = None) -> list[ProfileLink]:
        query = select(ProfileLink).where(ProfileLink.account_id == account_id)
        if household_id is not None:
            query = query.where(ProfileLink.household_id == household_id)
        result = await self.session.scalars(query.order_by(ProfileLink.linked_at.desc()))
        return list(result)
