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
    ProfileClaimConflictError,
    ProfileLinkAccountConflictError,
    ProfileLinkInvitationMismatchError,
    ProfileLinkNotFoundError,
    ProfileLinkStateConflictError,
    ProfileNotFoundError,
    ProfileRefAlreadyClaimedError,
    VersionMismatchError,
)
from app.models.family_invitations import InvitationStatus
from app.models.households import ProfileLink, ProfileLinkStatus
from app.models.profiles import FamilyProfile, LifecycleStatus
from app.models.service_accounts import ServiceAccount
from app.repositories.family_invitation_repository import FamilyInvitationRepository
from app.repositories.household_repository import HouseholdRepository
from app.repositories.profile_link_repository import ProfileLinkRepository
from app.repositories.profile_repository import ProfileRepository
from app.services.family_invitations import get_family_invitation_repository
from app.services.households import get_household_repository
from app.services.profile_access import apply_age_flags, apply_lifecycle, record_audit
from app.services.profile_capabilities import infer_ownership, role_from_relationship
from app.services.profiles import get_profile_repository


def get_profile_link_repository(session: SessionDep) -> ProfileLinkRepository:
    return ProfileLinkRepository(session)


class ProfileLinkService:
    def __init__(
        self,
        session: SessionDep,
        profile_link_repo: Annotated[ProfileLinkRepository, Depends(get_profile_link_repository)],
        invitation_repo: Annotated[FamilyInvitationRepository, Depends(get_family_invitation_repository)],
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
        profile_repo: Annotated[ProfileRepository, Depends(get_profile_repository)],
    ) -> None:
        self.session = session
        self.profile_link_repo = profile_link_repo
        self.invitation_repo = invitation_repo
        self.household_repo = household_repo
        self.profile_repo = profile_repo

    async def create(self, account: ServiceAccount, request: ProfileLinkCreateRequest) -> ProfileLinkData:
        invitation = await self.invitation_repo.get_for_update(request.invitation_id)
        if invitation is None or invitation.accepted_by_account_id != account.id:
            raise InvitationNotFoundError()
        if invitation.status is not InvitationStatus.ACCEPTED:
            raise ProfileLinkInvitationMismatchError("수락 완료된 초대만 프로필 연결에 사용할 수 있습니다.")
        if invitation.target_profile_ref != request.local_profile_ref:
            raise ProfileLinkInvitationMismatchError()
        if request.profile_id is not None and invitation.target_profile_id not in {None, request.profile_id}:
            raise ProfileLinkInvitationMismatchError()
        if not await self.household_repo.has_active_membership(invitation.household_id, account.id):
            raise HouseholdMembershipRequiredError()
        if await self.profile_link_repo.find_active_for_account(invitation.household_id, account.id):
            raise ProfileLinkAccountConflictError()
        if await self.profile_link_repo.find_by_ref(invitation.household_id, request.local_profile_ref):
            raise ProfileRefAlreadyClaimedError()

        claimed_profile_id = await self._apply_claim(
            account, invitation.household_id, request.profile_id or invitation.target_profile_id
        )
        link = ProfileLink(
            household_id=invitation.household_id,
            account_id=account.id,
            invitation_id=invitation.id,
            profile_id=claimed_profile_id,
            local_profile_ref=request.local_profile_ref,
        )
        try:
            await self.profile_link_repo.create(link)
            await self.session.commit()
        except IntegrityError as err:
            await self.session.rollback()
            constraint = getattr(getattr(err.orig, "__cause__", None), "constraint_name", None)
            if constraint == "uq_profile_links_active_household_account":
                raise ProfileLinkAccountConflictError() from err
            raise ProfileRefAlreadyClaimedError() from err
        await self.session.refresh(link)
        return ProfileLinkData.model_validate(link)

    async def _apply_claim(
        self, account: ServiceAccount, household_id: uuid.UUID, profile_id: uuid.UUID | None
    ) -> uuid.UUID | None:
        if profile_id is None:
            return None
        profile = await self.profile_repo.get_for_update(profile_id)
        if profile is None or profile.household_id != household_id:
            raise ProfileNotFoundError()
        other = await self.profile_repo.find_active_claim(household_id, account_id=account.id)
        if other is not None and other.id != profile.id:
            raise ProfileClaimConflictError()
        if profile.claimed_account_id is not None and profile.claimed_account_id != account.id:
            raise ProfileClaimConflictError()
        self._stamp_claim(profile, account)
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=household_id,
            event_type="profile.claimed",
            target_ref=str(profile.id),
            event_metadata={"ownership_type": profile.ownership_type.value},
        )
        return profile.id

    def _stamp_claim(self, profile: FamilyProfile, account: ServiceAccount) -> None:
        profile.claimed_account_id = account.id
        profile.account_email = account.email
        apply_lifecycle(profile, LifecycleStatus.ACTIVE)
        profile.member_role = role_from_relationship(profile.relationship)
        profile.ownership_type = infer_ownership(
            relationship=profile.relationship,
            birth_date=profile.birth_date,
            account_email=profile.account_email,
            claimed_account_id=profile.claimed_account_id,
            adult_transitioned=profile.adult_transitioned_at is not None,
        )
        apply_age_flags(profile)
        profile.row_version += 1

    async def list_for_account(self, account: ServiceAccount) -> ProfileLinkListData:
        links = await self.profile_link_repo.list_for_account(account.id)
        return ProfileLinkListData(items=[ProfileLinkData.model_validate(item) for item in links])

    async def unlink(
        self, link_id: uuid.UUID, account: ServiceAccount, *, expected_version: int | None = None
    ) -> ProfileLinkData:
        link = await self.profile_link_repo.get_for_update(link_id)
        if link is None or link.account_id != account.id:
            raise ProfileLinkNotFoundError()
        if link.status is not ProfileLinkStatus.ACTIVE:
            raise ProfileLinkStateConflictError()
        if expected_version is not None and link.row_version != expected_version:
            raise VersionMismatchError()
        link.status = ProfileLinkStatus.UNLINKED
        link.unlinked_at = datetime.now(tz=timezone.utc)
        link.row_version += 1
        await self.session.commit()
        await self.session.refresh(link)
        return ProfileLinkData.model_validate(link)
