import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.core.db.databases import get_db
from app.dtos.family_invitations import FamilyInvitationCreateRequest
from app.models.family_invitations import FamilyInvitation, InvitationStatus
from app.models.users import User
from app.repositories.family_invitation_repository import FamilyInvitationRepository


class FamilyInvitationService:
    def __init__(self, session: Annotated[AsyncSession, Depends(get_db)]):
        self.session = session
        self.repo = FamilyInvitationRepository(session)

    async def create(self, user: User, data: FamilyInvitationCreateRequest) -> FamilyInvitation:
        email = str(data.invitee_email).strip().lower()
        if email == user.email.lower():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="본인에게는 초대할 수 없습니다.")
        duplicate = await self.repo.find_pending_duplicate(user.id, email, data.household_ref, data.target_profile_ref)
        if duplicate:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="동일한 대기 중 초대가 이미 있습니다.")
        invitation = FamilyInvitation(
            inviter_account_id=user.id,
            invitee_email=email,
            household_ref=data.household_ref,
            target_profile_ref=data.target_profile_ref,
            expires_at=datetime.now(timezone.utc) + timedelta(days=config.FAMILY_INVITATION_EXPIRE_DAYS),
        )
        await self.repo.create(invitation)
        await self.session.commit()
        await self.session.refresh(invitation)
        return invitation

    async def list_for_user(self, user: User) -> tuple[list[FamilyInvitation], list[FamilyInvitation]]:
        invitations = await self.repo.list_for_user(user.id, user.email.lower())
        changed = False
        now = datetime.now(timezone.utc)
        for invitation in invitations:
            if invitation.status == InvitationStatus.PENDING and self._is_expired(invitation, now):
                invitation.status = InvitationStatus.EXPIRED
                changed = True
        if changed:
            await self.session.commit()
        return (
            [item for item in invitations if item.inviter_account_id == user.id],
            [item for item in invitations if item.invitee_email == user.email.lower()],
        )

    async def accept(self, invitation_id: uuid.UUID, user: User) -> FamilyInvitation:
        invitation = await self._get_pending(invitation_id)
        if invitation.invitee_email != user.email.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="초대를 찾을 수 없습니다.")
        invitation.status = InvitationStatus.ACCEPTED
        invitation.accepted_by_account_id = user.id
        invitation.accepted_at = datetime.now(timezone.utc)
        await self.session.commit()
        await self.session.refresh(invitation)
        return invitation

    async def decline(self, invitation_id: uuid.UUID, user: User) -> FamilyInvitation:
        invitation = await self._get_pending(invitation_id)
        if invitation.invitee_email != user.email.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="초대를 찾을 수 없습니다.")
        invitation.status = InvitationStatus.DECLINED
        await self.session.commit()
        await self.session.refresh(invitation)
        return invitation

    async def cancel(self, invitation_id: uuid.UUID, user: User) -> None:
        invitation = await self._get_pending(invitation_id)
        if invitation.inviter_account_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="초대를 찾을 수 없습니다.")
        invitation.status = InvitationStatus.CANCELLED
        await self.session.commit()

    async def _get_pending(self, invitation_id: uuid.UUID) -> FamilyInvitation:
        invitation = await self.repo.get(invitation_id)
        if not invitation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="초대를 찾을 수 없습니다.")
        if invitation.status != InvitationStatus.PENDING:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="처리할 수 없는 초대 상태입니다.")
        if self._is_expired(invitation):
            invitation.status = InvitationStatus.EXPIRED
            await self.session.commit()
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="만료된 초대입니다.")
        return invitation

    @staticmethod
    def _is_expired(invitation: FamilyInvitation, now: datetime | None = None) -> bool:
        expires_at = invitation.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return expires_at <= (now or datetime.now(timezone.utc))
