import hmac
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends
from sqlalchemy.exc import IntegrityError

from app.core.db.session import SessionDep
from app.dtos.profile_links import ProfileLinkCreateRequest, ProfileLinkData, ProfileLinkListData
from app.exceptions import (
    HouseholdMembershipRequiredError,
    InvitationNotFoundError,
    InvitationStateConflictError,
    ProfileAlreadyLinkedError,
    ProfileLinkNotFoundError,
    ProfileRefAlreadyClaimedError,
    ProfileRefInvalidError,
)
from app.models.family_invitations import FamilyInvitation, InvitationStatus
from app.models.profile_links import ProfileLink, ProfileLinkStatus
from app.models.service_accounts import ServiceAccount
from app.repositories.family_invitation_repository import FamilyInvitationRepository
from app.repositories.household_repository import HouseholdRepository
from app.repositories.profile_link_repository import ProfileLinkRepository
from app.services.family_invitations import get_family_invitation_repository
from app.services.households import get_household_repository

# 부분 유일 인덱스가 사전 검사보다 늦게 터졌을 때 같은 오류로 수렴시킨다.
_CONSTRAINT_ERRORS = {
    "uq_profile_links_one_active_profile_per_account_household": ProfileAlreadyLinkedError,
    "uq_profile_links_one_active_account_per_profile": ProfileRefAlreadyClaimedError,
    "uq_profile_links_invitation_id": InvitationStateConflictError,
}


def get_profile_link_repository(session: SessionDep) -> ProfileLinkRepository:
    return ProfileLinkRepository(session)


class ProfileLinkService:
    def __init__(
        self,
        session: SessionDep,
        link_repo: Annotated[ProfileLinkRepository, Depends(get_profile_link_repository)],
        invitation_repo: Annotated[FamilyInvitationRepository, Depends(get_family_invitation_repository)],
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
    ) -> None:
        self.session = session
        self.link_repo = link_repo
        self.invitation_repo = invitation_repo
        self.household_repo = household_repo

    async def create(self, account: ServiceAccount, request: ProfileLinkCreateRequest) -> ProfileLinkData:
        """docs/03_api_spec.md 6절 사전조건을 순서대로 확인하고 연결을 만든다.

        초대 행을 FOR UPDATE로 잠근 뒤 검사해서, 같은 초대에 대한 동시 요청이
        사전 검사 구간에서 서로를 지나치지 못하게 한다.
        """
        invitation = await self._require_accepted_invitation(request.invitation_id, account)

        if not hmac.compare_digest(invitation.target_profile_ref, request.local_profile_ref):
            # 초대가 지목한 프로필이 아니면 연결하지 않는다. 다른 참조값을
            # 밀어 넣어 가정 안의 임의 프로필을 점유하는 경로를 막는다.
            raise ProfileRefInvalidError()

        if not await self.household_repo.has_active_membership(invitation.household_id, account.id):
            raise HouseholdMembershipRequiredError()

        await self._require_unclaimed(invitation.household_id, account.id, request.local_profile_ref)

        link = ProfileLink(
            household_id=invitation.household_id,
            account_id=account.id,
            invitation_id=invitation.id,
            local_profile_ref=request.local_profile_ref,
        )
        try:
            await self.link_repo.create(link)
            await self.session.commit()
        except IntegrityError as err:
            await self.session.rollback()
            constraint = getattr(getattr(err.orig, "__cause__", None), "constraint_name", None)
            error = _CONSTRAINT_ERRORS.get(str(constraint))
            if error is None:
                raise
            raise error() from err

        await self.session.refresh(link)
        return ProfileLinkData.model_validate(link)

    async def list_for_account(
        self, account: ServiceAccount, household_id: uuid.UUID | None = None
    ) -> ProfileLinkListData:
        links = await self.link_repo.list_for_account(account.id, household_id)
        return ProfileLinkListData(items=[ProfileLinkData.model_validate(item) for item in links])

    async def unlink(self, link_id: uuid.UUID, account: ServiceAccount) -> ProfileLinkData:
        """연결만 끊는다. 브라우저의 로컬 프로필과 건강기록은 그대로 남는다."""
        link = await self.link_repo.get_for_update(link_id)
        if link is None or link.account_id != account.id:
            raise ProfileLinkNotFoundError()
        if link.status is ProfileLinkStatus.UNLINKED:
            # 해제는 멱등이다. 재시도한 클라이언트에게 409를 주지 않는다.
            return ProfileLinkData.model_validate(link)

        link.status = ProfileLinkStatus.UNLINKED
        link.unlinked_at = datetime.now(tz=timezone.utc)
        link.row_version += 1
        await self.session.commit()
        await self.session.refresh(link)
        return ProfileLinkData.model_validate(link)

    async def _require_accepted_invitation(self, invitation_id: uuid.UUID, account: ServiceAccount) -> FamilyInvitation:
        invitation = await self.invitation_repo.get_for_update(invitation_id)
        if invitation is None or invitation.accepted_by_account_id != account.id:
            # 수락하지 않은 계정에는 초대의 존재 여부를 알리지 않는다.
            raise InvitationNotFoundError()
        if invitation.status is not InvitationStatus.ACCEPTED:
            raise InvitationStateConflictError()
        return invitation

    async def _require_unclaimed(self, household_id: uuid.UUID, account_id: uuid.UUID, profile_ref: str) -> None:
        if await self.link_repo.find_active_by_account(household_id, account_id) is not None:
            raise ProfileAlreadyLinkedError()
        if await self.link_repo.find_active_by_profile_ref(household_id, profile_ref) is not None:
            raise ProfileRefAlreadyClaimedError()
