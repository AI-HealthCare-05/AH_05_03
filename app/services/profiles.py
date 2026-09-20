import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db.session import SessionDep
from app.dtos.profiles import (
    ProfileCreateRequest,
    ProfileData,
    ProfileDeletionPreviewData,
    ProfileDeletionRequestData,
    ProfileListData,
    ProfilePurgeJobData,
    ProfileSyncRequest,
    ProfileUpdateRequest,
)
from app.exceptions import (
    CredentialsInvalidError,
    HouseholdMasterRequiredError,
    HouseholdMembershipRequiredError,
    HouseholdNotFoundError,
    ProfileAccessDeniedError,
    ProfileNotFoundError,
)
from app.models.households import HouseholdStatus
from app.models.profiles import CapabilityGrant, FamilyProfile, LifecycleStatus, MemberRole, OwnershipType
from app.models.service_accounts import ServiceAccount
from app.repositories.health_record_repository import HealthRecordRepository
from app.repositories.household_repository import HouseholdRepository
from app.repositories.member_pin_repository import MemberPinRepository
from app.repositories.profile_repository import ProfileRepository
from app.services.health_records import get_health_record_repository
from app.services.profile_access import (
    apply_age_flags,
    apply_lifecycle,
    build_context,
    check_row_version,
    record_audit,
    require_capability,
)
from app.services.profile_capabilities import (
    CapabilityContext,
    ProfileCapability,
    has_capability,
    infer_ownership,
    lifecycle_from_status,
    role_from_relationship,
    status_from_lifecycle,
)

PROFILE_TRASH_DAYS = 30
_BACKUP_HINT = (
    "삭제 전에 계정 화면에서 건강기록 내보내기를 권장합니다. 회원탈퇴(DELETE /account)와 프로필 삭제는 다릅니다."
)


class _ProfileOrmData(ProfileData):
    """ORM 직렬화 중간값. pin_configured는 자격 증명 조회로만 채운다."""

    pin_configured: bool = False


async def serialize_profile(
    session: AsyncSession,
    profile: FamilyProfile,
    *,
    pin_configured_ids: set[uuid.UUID] | None = None,
) -> ProfileData:
    staged = _ProfileOrmData.model_validate(profile)
    if pin_configured_ids is None:
        configured = await MemberPinRepository(session).get_credential(profile.id) is not None
    else:
        configured = profile.id in pin_configured_ids
    return ProfileData.model_validate({**staged.model_dump(), "pin_configured": configured})


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
        record_repo: Annotated[HealthRecordRepository, Depends(get_health_record_repository)],
    ) -> None:
        self.session = session
        self.profile_repo = profile_repo
        self.household_repo = household_repo
        self.record_repo = record_repo

    async def _verify_household_access(self, household_id: uuid.UUID, account: ServiceAccount) -> None:
        household = await self.household_repo.get(household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        is_member = await self.household_repo.has_active_membership(household_id, account.id)
        if not is_member:
            raise HouseholdMembershipRequiredError()

    async def _context(
        self,
        account: ServiceAccount,
        profile: FamilyProfile,
        actor_profile_id: uuid.UUID | None = None,
    ) -> CapabilityContext:
        return await build_context(
            session=self.session,
            household_repo=self.household_repo,
            profile_repo=self.profile_repo,
            account=account,
            profile=profile,
            actor_profile_id=actor_profile_id,
        )

    def _stamp_ownership(self, profile: FamilyProfile) -> None:
        transitioned = profile.adult_transitioned_at is not None
        profile.member_role = MemberRole.ADULT_MEMBER if transitioned else role_from_relationship(profile.relationship)
        profile.ownership_type = infer_ownership(
            relationship=profile.relationship,
            birth_date=profile.birth_date,
            account_email=profile.account_email,
            claimed_account_id=profile.claimed_account_id,
            adult_transitioned=transitioned,
        )
        apply_age_flags(profile)
        apply_lifecycle(profile, profile.lifecycle_status)

    async def create_profile(self, account: ServiceAccount, req: ProfileCreateRequest) -> ProfileData:
        await self._verify_household_access(req.household_id, account)
        claimed_account_id = None
        if req.account_email is not None and req.account_email.lower() == account.email.lower():
            claimed_account_id = account.id
        profile = FamilyProfile(
            id=req.id or uuid.uuid4(),
            household_id=req.household_id,
            created_by_account_id=account.id,
            claimed_account_id=claimed_account_id,
            display_name=req.display_name,
            relationship=req.relationship,
            birth_date=req.birth_date,
            gender=req.gender,
            account_email=req.account_email,
            status="active",
            lifecycle_status=LifecycleStatus.ACTIVE,
        )
        self._stamp_ownership(profile)
        created = await self.profile_repo.create(profile)
        if created.ownership_type is OwnershipType.GUARDIAN_MANAGED:
            from app.models.guardians import GuardianLink, GuardianLinkKind, GuardianVerificationStatus

            self.session.add(
                GuardianLink(
                    household_id=created.household_id,
                    profile_id=created.id,
                    account_id=account.id,
                    kind=GuardianLinkKind.PRODUCT_GUARDIAN.value,
                    verification_status=GuardianVerificationStatus.UNVERIFIED.value,
                )
            )
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=created.household_id,
            event_type="profile.created",
            target_ref=str(created.id),
            event_metadata={
                "ownership_type": created.ownership_type.value,
                "member_role": created.member_role.value,
            },
        )
        await self.session.commit()
        await self.session.refresh(created)
        return await serialize_profile(self.session, created)

    async def list_profiles(
        self, account: ServiceAccount, household_id: uuid.UUID, include_hidden: bool = False
    ) -> ProfileListData:
        await self._verify_household_access(household_id, account)
        profiles = await self.profile_repo.list_by_household(household_id, include_hidden=include_hidden)
        for profile in profiles:
            apply_age_flags(profile)
        if self.session.dirty:
            await self.session.commit()
        pin_ids = await MemberPinRepository(self.session).list_configured_profile_ids([p.id for p in profiles])
        return ProfileListData(
            items=[await serialize_profile(self.session, p, pin_configured_ids=pin_ids) for p in profiles]
        )

    async def get_profile(
        self,
        account: ServiceAccount,
        profile_id: uuid.UUID,
        *,
        actor_profile_id: uuid.UUID | None = None,
    ) -> ProfileData:
        profile = await self.profile_repo.get(profile_id)
        if profile is None:
            raise ProfileNotFoundError()
        ctx = await self._context(account, profile, actor_profile_id)
        if not ctx.is_active_member and profile.claimed_account_id != account.id:
            raise HouseholdMembershipRequiredError()
        apply_age_flags(profile)
        if self.session.dirty:
            await self.session.commit()
            await self.session.refresh(profile)
        return await serialize_profile(self.session, profile)

    def _apply_status_update(self, profile: FamilyProfile, req: ProfileUpdateRequest, ctx: CapabilityContext) -> None:
        if req.status == "deleted":
            purge = (
                ProfileCapability.PURGE_CLAIMED_PROFILE
                if profile.ownership_type.value == "claimed_adult" or profile.claimed_account_id is not None
                else ProfileCapability.PURGE_EMPTY_PROFILE
            )
            require_capability(ctx, purge)
            apply_lifecycle(profile, LifecycleStatus.PENDING_DELETE)
            return
        if req.status == "hidden":
            require_capability(ctx, ProfileCapability.HIDE_PROFILE)
            apply_lifecycle(profile, LifecycleStatus.HIDDEN)
            return
        if req.status == "active":
            require_capability(ctx, ProfileCapability.HIDE_PROFILE)
            apply_lifecycle(profile, LifecycleStatus.ACTIVE)
            return
        require_capability(ctx, ProfileCapability.HIDE_PROFILE)

    async def update_profile(
        self,
        account: ServiceAccount,
        profile_id: uuid.UUID,
        req: ProfileUpdateRequest,
        *,
        expected_version: int | None = None,
        actor_profile_id: uuid.UUID | None = None,
    ) -> ProfileData:
        profile = await self.profile_repo.get(profile_id)
        if profile is None:
            raise ProfileNotFoundError()
        ctx = await self._context(account, profile, actor_profile_id)
        check_row_version(profile, expected_version)
        self._apply_status_update(profile, req, ctx)

        if req.display_name is not None:
            profile.display_name = req.display_name
        if req.relationship is not None:
            profile.relationship = req.relationship
        if req.birth_date is not None:
            profile.birth_date = req.birth_date
        if req.gender is not None:
            profile.gender = req.gender
        if req.account_email is not None:
            profile.account_email = req.account_email
            if profile.account_email.lower() == account.email.lower():
                profile.claimed_account_id = account.id

        previous_role = profile.member_role.value
        self._stamp_ownership(profile)
        profile.row_version += 1
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="profile.updated",
            target_ref=str(profile.id),
            event_metadata={
                "ownership_type": profile.ownership_type.value,
                "member_role": profile.member_role.value,
                "lifecycle_status": profile.lifecycle_status.value,
            },
        )
        if previous_role != profile.member_role.value:
            await record_audit(
                self.session,
                actor_account_id=account.id,
                household_id=profile.household_id,
                event_type="profile.role_changed",
                target_ref=str(profile.id),
                event_metadata={"from_role": previous_role, "to_role": profile.member_role.value},
            )
        await self.session.commit()
        await self.session.refresh(profile)
        return await serialize_profile(self.session, profile)

    async def delete_profile(
        self,
        account: ServiceAccount,
        profile_id: uuid.UUID,
        *,
        expected_version: int | None = None,
        actor_profile_id: uuid.UUID | None = None,
    ) -> None:
        profile = await self.profile_repo.get(profile_id)
        if profile is None:
            raise ProfileNotFoundError()
        ctx = await self._context(account, profile, actor_profile_id)
        check_row_version(profile, expected_version)
        require_capability(ctx, ProfileCapability.HIDE_PROFILE)
        apply_lifecycle(profile, LifecycleStatus.HIDDEN)
        profile.row_version += 1
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="profile.hidden",
            target_ref=str(profile.id),
            event_metadata={"ownership_type": profile.ownership_type.value},
        )
        await self.session.commit()

    async def unshare_from_household(
        self,
        account: ServiceAccount,
        profile_id: uuid.UUID,
        password: str | None,
        *,
        expected_version: int | None = None,
    ) -> None:
        from sqlalchemy import delete

        from app.core.utils.security import verify_password_async
        from app.models.households import MembershipStatus
        from app.models.profiles import CapabilityGrant
        from app.repositories.member_pin_repository import MemberPinRepository

        profile = await self.profile_repo.get_for_update(profile_id)
        if profile is None:
            raise ProfileNotFoundError()
        household = await self.household_repo.get(profile.household_id)
        if household is None:
            raise HouseholdNotFoundError()
        if household.master_account_id != account.id:
            raise HouseholdMasterRequiredError()
        ctx = await self._context(account, profile)
        check_row_version(profile, expected_version)
        require_capability(ctx, ProfileCapability.UNSHARE_PROFILE)
        if profile.claimed_account_id == account.id:
            raise ProfileAccessDeniedError("마스터 본인 프로필은 가족 공유에서 제외할 수 없습니다.")

        claimed_account_id = profile.claimed_account_id
        if claimed_account_id is not None:
            if not password or not await verify_password_async(password, account.password_hash):
                raise CredentialsInvalidError()
            membership = await self.household_repo.get_membership_for_update(profile.household_id, claimed_account_id)
            if membership is not None and membership.status is MembershipStatus.ACTIVE:
                membership.status = MembershipStatus.LEFT
                membership.left_at = datetime.now(tz=timezone.utc)
                membership.row_version += 1
            await self.household_repo.unlink_active_profile(profile.household_id, claimed_account_id)
            apply_lifecycle(profile, LifecycleStatus.UNSHARED)
        else:
            apply_lifecycle(profile, LifecycleStatus.HIDDEN)

        profile.row_version += 1
        await self.session.execute(delete(CapabilityGrant).where(CapabilityGrant.profile_id == profile.id))
        pin_repo = MemberPinRepository(self.session)
        await pin_repo.delete_credential(profile.id)
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="profile.unshared",
            target_ref=str(profile.id),
            event_metadata={
                "ownership_type": profile.ownership_type.value,
                "lifecycle_status": profile.lifecycle_status.value,
            },
        )
        await self.session.commit()

    async def sync_profiles(self, account: ServiceAccount, req: ProfileSyncRequest) -> ProfileListData:
        results: list[FamilyProfile] = []
        for p in req.profiles:
            await self._verify_household_access(p.household_id, account)
            lifecycle = lifecycle_from_status(p.status)
            model = FamilyProfile(
                id=p.id,
                household_id=p.household_id,
                created_by_account_id=account.id,
                display_name=p.display_name,
                relationship=p.relationship,
                birth_date=p.birth_date,
                gender=p.gender,
                account_email=p.account_email,
                status=status_from_lifecycle(lifecycle),
                lifecycle_status=lifecycle,
                row_version=p.row_version,
            )
            self._stamp_ownership(model)
            saved = await self.profile_repo.upsert(model)
            results.append(saved)
        await self.session.commit()
        pin_ids = await MemberPinRepository(self.session).list_configured_profile_ids([p.id for p in results])
        return ProfileListData(
            items=[await serialize_profile(self.session, p, pin_configured_ids=pin_ids) for p in results]
        )

    async def _load_profile(self, profile_id: uuid.UUID, *, for_update: bool = False) -> FamilyProfile:
        profile = (
            await self.profile_repo.get_for_update(profile_id)
            if for_update
            else await self.profile_repo.get(profile_id)
        )
        if profile is None or profile.lifecycle_status is LifecycleStatus.DELETED:
            raise ProfileNotFoundError()
        return profile

    async def deletion_preview(self, account: ServiceAccount, profile_id: uuid.UUID) -> ProfileDeletionPreviewData:
        profile = await self._load_profile(profile_id)
        ctx = await self._context(account, profile)
        require_capability(ctx, ProfileCapability.HIDE_PROFILE)
        record_count = await self.record_repo.count_active(profile.id)
        recommended: Literal["purge_empty", "trash", "forbidden", "minor_review"] = "forbidden"
        if profile.ownership_type is OwnershipType.GUARDIAN_MANAGED:
            recommended = (
                "minor_review" if has_capability(ctx, ProfileCapability.REQUEST_MINOR_DELETION) else "forbidden"
            )
        elif profile.ownership_type is OwnershipType.CLAIMED_ADULT:
            recommended = "trash" if profile.claimed_account_id == account.id else "forbidden"
        elif record_count == 0:
            recommended = "purge_empty"
        else:
            recommended = "trash"
        return ProfileDeletionPreviewData(
            profile_id=profile.id,
            ownership_type=profile.ownership_type.value,
            lifecycle_status=profile.lifecycle_status.value,
            record_count=record_count,
            recommended_action=recommended,
            backup_hint=_BACKUP_HINT,
            purge_after=profile.purge_after,
        )

    async def archive_profile(
        self, account: ServiceAccount, profile_id: uuid.UUID, *, expected_version: int | None = None
    ) -> ProfileData:
        profile = await self._load_profile(profile_id, for_update=True)
        ctx = await self._context(account, profile)
        check_row_version(profile, expected_version)
        require_capability(ctx, ProfileCapability.ARCHIVE_PROFILE)
        apply_lifecycle(profile, LifecycleStatus.ARCHIVED)
        profile.row_version += 1
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="profile.archived",
            target_ref=str(profile.id),
            event_metadata={"ownership_type": profile.ownership_type.value},
        )
        await self.session.commit()
        await self.session.refresh(profile)
        return await serialize_profile(self.session, profile)

    async def restore_profile(
        self, account: ServiceAccount, profile_id: uuid.UUID, *, expected_version: int | None = None
    ) -> ProfileData:
        profile = await self._load_profile(profile_id, for_update=True)
        ctx = await self._context(account, profile)
        check_row_version(profile, expected_version)
        require_capability(ctx, ProfileCapability.RESTORE_PROFILE)
        apply_lifecycle(profile, LifecycleStatus.ACTIVE)
        profile.row_version += 1
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="profile.restored",
            target_ref=str(profile.id),
            event_metadata={"ownership_type": profile.ownership_type.value},
        )
        await self.session.commit()
        await self.session.refresh(profile)
        return await serialize_profile(self.session, profile)

    async def request_deletion(
        self, account: ServiceAccount, profile_id: uuid.UUID, *, expected_version: int | None = None
    ) -> ProfileDeletionRequestData:
        profile = await self._load_profile(profile_id, for_update=True)
        ctx = await self._context(account, profile)
        check_row_version(profile, expected_version)
        record_count = await self.record_repo.count_active(profile.id)
        if profile.ownership_type is OwnershipType.GUARDIAN_MANAGED:
            raise ProfileAccessDeniedError("보호자 관리형 프로필은 법정대리인 확인 뒤 삭제 검토만 가능합니다.")
        if record_count == 0 and profile.ownership_type is OwnershipType.LOCAL_SLOT:
            require_capability(ctx, ProfileCapability.PURGE_EMPTY_PROFILE)
            await self._discard_pin(profile.id)
            await record_audit(
                self.session,
                actor_account_id=account.id,
                household_id=profile.household_id,
                event_type="profile.purged",
                target_ref=str(profile.id),
                event_metadata={"reason": "empty_local_slot"},
            )
            await self.session.delete(profile)
            await self.session.commit()
            return ProfileDeletionRequestData(
                profile_id=profile_id, lifecycle_status="deleted", purged=True, purge_after=None
            )
        require_capability(
            ctx,
            ProfileCapability.PURGE_CLAIMED_PROFILE
            if profile.ownership_type is OwnershipType.CLAIMED_ADULT
            else ProfileCapability.PURGE_EMPTY_PROFILE,
        )
        apply_lifecycle(profile, LifecycleStatus.PENDING_DELETE)
        profile.purge_after = datetime.now(tz=timezone.utc) + timedelta(days=PROFILE_TRASH_DAYS)
        profile.row_version += 1
        await self._discard_pin(profile.id)
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="profile.deletion_requested",
            target_ref=str(profile.id),
            event_metadata={"purge_after": profile.purge_after.isoformat(), "record_count": str(record_count)},
        )
        await self.session.commit()
        await self.session.refresh(profile)
        return ProfileDeletionRequestData(
            profile_id=profile.id,
            lifecycle_status=profile.lifecycle_status.value,
            purged=False,
            purge_after=profile.purge_after,
        )

    async def run_due_purges(self, account: ServiceAccount) -> ProfilePurgeJobData:
        now = datetime.now(tz=timezone.utc)
        due = await self.profile_repo.list_due_for_purge(now)
        purged = 0
        skipped = 0
        for profile in due:
            if not await self.household_repo.has_active_membership(profile.household_id, account.id):
                skipped += 1
                continue
            household = await self.household_repo.get(profile.household_id)
            if household is None or household.master_account_id != account.id:
                skipped += 1
                continue
            if profile.purge_hold_reason:
                skipped += 1
                continue
            await self._discard_pin(profile.id)
            await self.session.execute(delete(CapabilityGrant).where(CapabilityGrant.profile_id == profile.id))
            profile_id = str(profile.id)
            household_id = profile.household_id
            await self.session.delete(profile)
            await record_audit(
                self.session,
                actor_account_id=account.id,
                household_id=household_id,
                event_type="profile.purged",
                target_ref=profile_id,
                event_metadata={"reason": "trash_expired"},
            )
            purged += 1
        await self.session.commit()
        return ProfilePurgeJobData(purged_count=purged, skipped_count=skipped)

    async def _discard_pin(self, profile_id: uuid.UUID) -> None:
        pin_repo = MemberPinRepository(self.session)
        await pin_repo.delete_credential(profile_id)
