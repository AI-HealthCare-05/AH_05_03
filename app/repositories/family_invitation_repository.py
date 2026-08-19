import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.family_invitations import FamilyInvitation


class FamilyInvitationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, invitation: FamilyInvitation) -> FamilyInvitation:
        self.session.add(invitation)
        await self.session.flush()
        return invitation

    async def find_by_profile_ref(self, household_id: uuid.UUID, target_profile_ref: str) -> FamilyInvitation | None:
        return await self.session.scalar(
            select(FamilyInvitation)
            .where(
                FamilyInvitation.household_id == household_id,
                FamilyInvitation.target_profile_ref == target_profile_ref,
            )
            .with_for_update()
        )

    async def get_for_update(self, invitation_id: uuid.UUID) -> FamilyInvitation | None:
        return await self.session.scalar(
            select(FamilyInvitation).where(FamilyInvitation.id == invitation_id).with_for_update()
        )

    async def list_for_account(self, account_id: uuid.UUID, email: str) -> list[FamilyInvitation]:
        result = await self.session.scalars(
            select(FamilyInvitation)
            .where(
                or_(
                    FamilyInvitation.inviter_account_id == account_id,
                    func.lower(FamilyInvitation.invitee_email) == email.lower(),
                )
            )
            .order_by(FamilyInvitation.created_at.desc())
        )
        return list(result)
