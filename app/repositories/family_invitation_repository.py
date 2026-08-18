import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.family_invitations import FamilyInvitation, InvitationStatus


class FamilyInvitationRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, invitation: FamilyInvitation) -> FamilyInvitation:
        self.session.add(invitation)
        await self.session.flush()
        return invitation

    async def get(self, invitation_id: uuid.UUID) -> FamilyInvitation | None:
        return await self.session.get(FamilyInvitation, invitation_id)

    async def find_pending_duplicate(
        self, inviter_id: int, invitee_email: str, household_ref: str, target_profile_ref: str
    ) -> FamilyInvitation | None:
        stmt = select(FamilyInvitation).where(
            FamilyInvitation.inviter_account_id == inviter_id,
            FamilyInvitation.invitee_email == invitee_email,
            FamilyInvitation.household_ref == household_ref,
            FamilyInvitation.target_profile_ref == target_profile_ref,
            FamilyInvitation.status == InvitationStatus.PENDING,
        )
        return await self.session.scalar(stmt)

    async def list_for_user(self, user_id: int, email: str) -> list[FamilyInvitation]:
        stmt = (
            select(FamilyInvitation)
            .where(or_(FamilyInvitation.inviter_account_id == user_id, FamilyInvitation.invitee_email == email))
            .order_by(FamilyInvitation.created_at.desc())
        )
        return list((await self.session.scalars(stmt)).all())

