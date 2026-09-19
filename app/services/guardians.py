"""보호자 링크·법정대리 확인·미성년 삭제 검토·성인 전환."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends
from redis.asyncio import Redis

from app.core.db.session import SessionDep
from app.core.redis.client import get_redis_optional
from app.dtos.guardians import (
    BirthDateCorrectionData,
    BirthDateCorrectionRequest,
    CivilMajorityInvalidationData,
    CivilMajorityInvalidationRequest,
    CivilMajorityTransitionRequest,
    GuardianLinkCreateRequest,
    GuardianLinkData,
    GuardianLinkListData,
    GuardianShareReapprovalRequest,
    MinorDeletionRequestCreate,
    MinorDeletionRequestData,
    MinorDeletionReviewRequest,
    PrivacySelfDeterminationRequest,
)
from app.dtos.profiles import ProfileData
from app.exceptions import (
    AdultTransitionNotDueError,
    CredentialsInvalidError,
    HouseholdMasterRequiredError,
    HouseholdMembershipRequiredError,
    LegalGuardianRequiredError,
    LegalGuardianUnverifiedError,
    MinorDeletionStateConflictError,
    OpsRecoveryForbiddenError,
    ProfileAccessDeniedError,
    ProfileClaimRequiredError,
    ProfileNotFoundError,
)
from app.models.guardians import (
    BirthDateCorrection,
    CivilMajorityTransition,
    GuardianLink,
    GuardianLinkKind,
    GuardianVerificationStatus,
    MinorDeletionRequest,
    MinorDeletionStatus,
)
from app.models.profiles import FamilyProfile, LifecycleStatus, MemberRole, OwnershipType
from app.models.service_accounts import ServiceAccount
from app.repositories.guardian_repository import GuardianRepository
from app.repositories.household_repository import HouseholdRepository
from app.repositories.profile_repository import ProfileRepository
from app.services.household_session import bump_session_epoch
from app.services.legal_guardian_adapter import LegalGuardianAdapter, get_legal_guardian_adapter
from app.services.minor_policy import (
    MINOR_POLICY_ID,
    has_reached_civil_majority,
    has_reached_privacy_self_determination,
)
from app.services.ops_recovery_policy import break_glass_audit_metadata, presented_key_matches
from app.services.profile_access import (
    apply_age_flags,
    apply_lifecycle,
    build_context,
    parse_share_scopes,
    record_audit,
    require_capability,
)
from app.services.profile_capabilities import (
    SHARE_POLICY_VERSION,
    SHARE_SCOPE_TO_CAPS,
    ProfileCapability,
    infer_ownership,
)
from app.services.profiles import PROFILE_TRASH_DAYS, get_household_repository, get_profile_repository

_OPEN = {
    MinorDeletionStatus.SUBMITTED.value,
    MinorDeletionStatus.UNDER_REVIEW.value,
    MinorDeletionStatus.APPEALED.value,
}


def get_guardian_repository(session: SessionDep) -> GuardianRepository:
    return GuardianRepository(session)


class GuardianService:
    def __init__(
        self,
        session: SessionDep,
        profile_repo: Annotated[ProfileRepository, Depends(get_profile_repository)],
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
        guardian_repo: Annotated[GuardianRepository, Depends(get_guardian_repository)],
        adapter: Annotated[LegalGuardianAdapter, Depends(get_legal_guardian_adapter)],
        redis: Annotated[Redis | None, Depends(get_redis_optional)] = None,
    ) -> None:
        self.session = session
        self.profile_repo = profile_repo
        self.household_repo = household_repo
        self.guardian_repo = guardian_repo
        self.adapter = adapter
        self.redis = redis

    async def _profile(self, profile_id: uuid.UUID) -> FamilyProfile:
        profile = await self.profile_repo.get(profile_id)
        if profile is None or profile.lifecycle_status is LifecycleStatus.DELETED:
            raise ProfileNotFoundError()
        apply_age_flags(profile)
        return profile

    async def _verify_password(self, account: ServiceAccount, password: str) -> None:
        from app.core.utils.security import verify_password_async

        if not await verify_password_async(password, account.password_hash):
            raise CredentialsInvalidError()

    async def _require_member(self, household_id: uuid.UUID, account: ServiceAccount) -> None:
        if not await self.household_repo.has_active_membership(household_id, account.id):
            raise HouseholdMembershipRequiredError()

    async def _require_master(self, household_id: uuid.UUID, account: ServiceAccount) -> None:
        household = await self.household_repo.get(household_id)
        if household is None or household.master_account_id != account.id:
            raise HouseholdMasterRequiredError()

    def _link_data(self, link: GuardianLink) -> GuardianLinkData:
        return GuardianLinkData.model_validate(link)

    def _deletion_data(self, row: MinorDeletionRequest) -> MinorDeletionRequestData:
        return MinorDeletionRequestData.model_validate(row)

    async def list_links(self, account: ServiceAccount, profile_id: uuid.UUID) -> GuardianLinkListData:
        profile = await self._profile(profile_id)
        await self._require_member(profile.household_id, account)
        return GuardianLinkListData(
            items=[self._link_data(link) for link in await self.guardian_repo.list_links(profile.id)]
        )

    async def assign_product_guardian(
        self, account: ServiceAccount, profile_id: uuid.UUID, req: GuardianLinkCreateRequest
    ) -> GuardianLinkData:
        profile = await self._profile(profile_id)
        await self._require_master(profile.household_id, account)
        if profile.ownership_type is not OwnershipType.GUARDIAN_MANAGED:
            raise ProfileAccessDeniedError("보호자 관리형 프로필에만 보호자를 붙일 수 있습니다.")
        existing = await self.guardian_repo.find_link(profile.id, req.account_id, GuardianLinkKind.PRODUCT_GUARDIAN)
        if existing is not None:
            existing.verification_status = GuardianVerificationStatus.UNVERIFIED.value
            existing.self_attested = req.self_attested
            existing.row_version += 1
            link = existing
        else:
            link = await self.guardian_repo.add_link(
                GuardianLink(
                    household_id=profile.household_id,
                    profile_id=profile.id,
                    account_id=req.account_id,
                    kind=GuardianLinkKind.PRODUCT_GUARDIAN.value,
                    verification_status=GuardianVerificationStatus.UNVERIFIED.value,
                    self_attested=req.self_attested,
                )
            )
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="guardian.product_assigned",
            target_ref=str(profile.id),
            event_metadata={"self_attested": str(req.self_attested).lower(), "kind": "product_guardian"},
        )
        await self.session.commit()
        await self.session.refresh(link)
        return self._link_data(link)

    async def start_legal_verification(self, account: ServiceAccount, profile_id: uuid.UUID) -> GuardianLinkData:
        profile = await self._profile(profile_id)
        await self._require_member(profile.household_id, account)
        if profile.ownership_type is not OwnershipType.GUARDIAN_MANAGED:
            raise ProfileAccessDeniedError()
        started = await self.adapter.start(profile_id=profile.id, account_id=account.id)
        existing = await self.guardian_repo.find_link(profile.id, account.id, GuardianLinkKind.LEGAL_REPRESENTATIVE)
        if existing is None:
            existing = await self.guardian_repo.add_link(
                GuardianLink(
                    household_id=profile.household_id,
                    profile_id=profile.id,
                    account_id=account.id,
                    kind=GuardianLinkKind.LEGAL_REPRESENTATIVE.value,
                    verification_status=started.value,
                    adapter_name=self.adapter.name,
                )
            )
        else:
            existing.verification_status = started.value
            existing.adapter_name = self.adapter.name
            existing.row_version += 1
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="guardian.legal_started",
            target_ref=str(existing.id),
            event_metadata={"adapter": self.adapter.name, "status": started.value, "policy": MINOR_POLICY_ID},
        )
        await self.session.commit()
        await self.session.refresh(existing)
        return self._link_data(existing)

    async def refresh_legal_verification(self, account: ServiceAccount, link_id: uuid.UUID) -> GuardianLinkData:
        link = await self.guardian_repo.get_link_for_update(link_id)
        if link is None or link.kind != GuardianLinkKind.LEGAL_REPRESENTATIVE.value:
            raise ProfileNotFoundError()
        await self._require_member(link.household_id, account)
        refreshed = await self.adapter.refresh(verification_id=link.id)
        link.verification_status = refreshed.value
        link.row_version += 1
        now = datetime.now(tz=timezone.utc)
        if refreshed is GuardianVerificationStatus.EXPIRED:
            link.expires_at = now
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=link.household_id,
            event_type="guardian.legal_refreshed",
            target_ref=str(link.id),
            event_metadata={"status": refreshed.value, "adapter": self.adapter.name},
        )
        await self.session.commit()
        await self.session.refresh(link)
        return self._link_data(link)

    async def expire_legal_verification(self, account: ServiceAccount, link_id: uuid.UUID) -> None:
        link = await self.guardian_repo.get_link_for_update(link_id)
        if link is None or link.kind != GuardianLinkKind.LEGAL_REPRESENTATIVE.value:
            raise ProfileNotFoundError()
        await self._require_master(link.household_id, account)
        link.verification_status = GuardianVerificationStatus.EXPIRED.value
        link.expires_at = datetime.now(tz=timezone.utc)
        link.row_version += 1
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=link.household_id,
            event_type="guardian.legal_expired",
            target_ref=str(link.id),
            event_metadata={},
        )
        await self.session.commit()

    async def submit_minor_deletion(
        self, account: ServiceAccount, profile_id: uuid.UUID, req: MinorDeletionRequestCreate
    ) -> MinorDeletionRequestData:
        profile = await self._profile(profile_id)
        ctx = await build_context(
            session=self.session,
            household_repo=self.household_repo,
            profile_repo=self.profile_repo,
            account=account,
            profile=profile,
            actor_profile_id=None,
        )
        if ctx.legal_verification_status != GuardianVerificationStatus.VERIFIED.value:
            if ctx.is_product_guardian or ctx.is_master:
                raise LegalGuardianRequiredError()
            raise LegalGuardianUnverifiedError()
        require_capability(ctx, ProfileCapability.REQUEST_MINOR_DELETION)
        if await self.guardian_repo.open_deletion(profile.id) is not None:
            raise MinorDeletionStateConflictError()
        row = await self.guardian_repo.add_deletion(
            MinorDeletionRequest(
                household_id=profile.household_id,
                profile_id=profile.id,
                requested_by_account_id=account.id,
                status=MinorDeletionStatus.SUBMITTED.value,
                decision_note=req.note,
            )
        )
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="minor_deletion.submitted",
            target_ref=str(row.id),
            event_metadata={"profile_id": str(profile.id)},
        )
        await self.session.commit()
        await self.session.refresh(row)
        return self._deletion_data(row)

    async def review_minor_deletion(
        self, account: ServiceAccount, request_id: uuid.UUID, req: MinorDeletionReviewRequest
    ) -> MinorDeletionRequestData:
        row = await self.guardian_repo.get_deletion_for_update(request_id)
        if row is None:
            raise ProfileNotFoundError()
        await self._require_master(row.household_id, account)
        if row.status not in _OPEN and row.status != MinorDeletionStatus.REJECTED.value:
            raise MinorDeletionStateConflictError()
        if req.decision == "under_review":
            row.status = MinorDeletionStatus.UNDER_REVIEW.value
        elif req.decision == "rejected":
            row.status = MinorDeletionStatus.REJECTED.value
            row.decided_at = datetime.now(tz=timezone.utc)
        else:
            row.status = MinorDeletionStatus.APPROVED.value
            row.decided_at = datetime.now(tz=timezone.utc)
            profile = await self.profile_repo.get_for_update(row.profile_id)
            if profile is None:
                raise ProfileNotFoundError()
            apply_lifecycle(profile, LifecycleStatus.PENDING_DELETE)
            profile.purge_after = datetime.now(tz=timezone.utc) + timedelta(days=PROFILE_TRASH_DAYS)
            if req.legal_hold:
                profile.purge_hold_reason = "legal_hold"
                row.legal_hold = True
            profile.row_version += 1
        row.decision_note = req.note
        row.row_version += 1
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=row.household_id,
            event_type=f"minor_deletion.{req.decision}",
            target_ref=str(row.id),
            event_metadata={"legal_hold": str(req.legal_hold).lower()},
        )
        await self.session.commit()
        await self.session.refresh(row)
        return self._deletion_data(row)

    async def appeal_minor_deletion(self, account: ServiceAccount, request_id: uuid.UUID) -> MinorDeletionRequestData:
        row = await self.guardian_repo.get_deletion_for_update(request_id)
        if row is None:
            raise ProfileNotFoundError()
        if row.requested_by_account_id != account.id:
            raise ProfileAccessDeniedError()
        if row.status != MinorDeletionStatus.REJECTED.value:
            raise MinorDeletionStateConflictError()
        row.status = MinorDeletionStatus.APPEALED.value
        row.row_version += 1
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=row.household_id,
            event_type="minor_deletion.appealed",
            target_ref=str(row.id),
            event_metadata={},
        )
        await self.session.commit()
        await self.session.refresh(row)
        return self._deletion_data(row)

    async def mark_privacy_self_determination(
        self, account: ServiceAccount, profile_id: uuid.UUID, req: PrivacySelfDeterminationRequest
    ) -> ProfileData:
        profile = await self.profile_repo.get_for_update(profile_id)
        if profile is None or profile.lifecycle_status is LifecycleStatus.DELETED:
            raise ProfileNotFoundError()
        await self._require_member(profile.household_id, account)
        await self._verify_password(account, req.password)
        if profile.claimed_account_id != account.id:
            raise ProfileClaimRequiredError()
        if not has_reached_privacy_self_determination(profile.birth_date):
            raise AdultTransitionNotDueError()
        if profile.privacy_self_determined_at is None:
            profile.privacy_self_determined_at = datetime.now(tz=timezone.utc)
            profile.row_version += 1
        apply_age_flags(profile)
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="profile.privacy_self_determined",
            target_ref=str(profile.id),
            event_metadata={"policy": MINOR_POLICY_ID, "civil_complete": "false"},
        )
        await self.session.commit()
        await self.session.refresh(profile)
        return ProfileData.model_validate(profile)

    async def complete_civil_majority(
        self, account: ServiceAccount, profile_id: uuid.UUID, req: CivilMajorityTransitionRequest
    ) -> ProfileData:
        profile = await self.profile_repo.get_for_update(profile_id)
        if profile is None or profile.lifecycle_status is LifecycleStatus.DELETED:
            raise ProfileNotFoundError()
        await self._require_member(profile.household_id, account)
        await self._verify_password(account, req.password)
        if not has_reached_civil_majority(profile.birth_date):
            raise AdultTransitionNotDueError()
        if profile.claimed_account_id is None:
            apply_age_flags(profile)
            await self.session.commit()
            raise ProfileClaimRequiredError()
        if profile.claimed_account_id != account.id:
            raise ProfileAccessDeniedError()
        existing = await self.guardian_repo.get_active_transition(profile.id)
        if profile.adult_transitioned_at is not None:
            return ProfileData.model_validate(profile)
        now = datetime.now(tz=timezone.utc)
        profile.adult_transitioned_at = now
        profile.adult_transition_pending_at = None
        if profile.privacy_self_determined_at is None:
            profile.privacy_self_determined_at = profile.adult_transitioned_at
        profile.member_role = MemberRole.ADULT_MEMBER
        profile.ownership_type = infer_ownership(
            relationship=profile.relationship,
            birth_date=profile.birth_date,
            account_email=profile.account_email,
            claimed_account_id=profile.claimed_account_id,
            adult_transitioned=True,
        )
        profile.row_version += 1
        await self.guardian_repo.expire_profile_links(profile.id)
        await self.guardian_repo.clear_share_reapprovals(profile.id)
        if existing is None:
            await self.guardian_repo.add_transition(
                CivilMajorityTransition(
                    household_id=profile.household_id,
                    profile_id=profile.id,
                    actor_account_id=account.id,
                    completed_at=now,
                    review_status="active",
                    idempotency_key=f"complete:{profile.id}",
                )
            )
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="profile.civil_majority_completed",
            target_ref=str(profile.id),
            event_metadata={"policy": MINOR_POLICY_ID, "auto_transfer": "false"},
        )
        await self.session.commit()
        await self.session.refresh(profile)
        return ProfileData.model_validate(profile)

    async def reapprove_guardian_share(
        self, account: ServiceAccount, profile_id: uuid.UUID, req: GuardianShareReapprovalRequest
    ) -> GuardianLinkData:
        profile = await self._profile(profile_id)
        if profile.claimed_account_id != account.id or profile.adult_transitioned_at is None:
            raise ProfileAccessDeniedError()
        await self._verify_password(account, req.password)
        if req.account_id == account.id:
            raise ProfileAccessDeniedError()
        link = await self.guardian_repo.find_link(profile.id, req.account_id, GuardianLinkKind.PRODUCT_GUARDIAN)
        if link is None:
            raise ProfileNotFoundError()
        now = datetime.now(tz=timezone.utc)
        scopes = [item for item in req.capabilities if item in SHARE_SCOPE_TO_CAPS]
        if not scopes:
            link.share_reapproved_at = None
            link.share_capabilities = ""
            link.share_expires_at = None
            link.share_revoked_at = now
            link.share_policy_version = SHARE_POLICY_VERSION
            link.share_reauthenticated_at = now
            link.share_grantor_account_id = account.id
            from app.repositories.member_pin_repository import MemberPinRepository

            await MemberPinRepository(self.session).revoke_sessions(profile.id)
            household = await self.household_repo.get_for_update(profile.household_id)
            if household is not None:
                await bump_session_epoch(self.session, household, self.redis)
        else:
            current = set(parse_share_scopes(link.share_capabilities))
            expanding = set(scopes) - current
            if expanding and not req.password:
                raise CredentialsInvalidError()
            link.share_reapproved_at = now
            link.share_revoked_at = None
            link.share_capabilities = ",".join(scopes)
            link.share_expires_at = now + timedelta(days=req.expires_in_days)
            link.share_policy_version = SHARE_POLICY_VERSION
            link.share_reauthenticated_at = now
            link.share_grantor_account_id = account.id
        link.verification_status = GuardianVerificationStatus.UNVERIFIED.value
        link.expires_at = None
        link.row_version += 1
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="guardian.share_reapproved",
            target_ref=str(link.id),
            event_metadata={
                "kind": "product_guardian",
                "scope": link.share_capabilities,
                "expires_in_days": str(req.expires_in_days),
            },
        )
        await self.session.commit()
        await self.session.refresh(link)
        return self._link_data(link)

    async def correct_birth_date(
        self, account: ServiceAccount, profile_id: uuid.UUID, req: BirthDateCorrectionRequest
    ) -> BirthDateCorrectionData:
        profile = await self.profile_repo.get_for_update(profile_id)
        if profile is None or profile.lifecycle_status is LifecycleStatus.DELETED:
            raise ProfileNotFoundError()
        await self._require_member(profile.household_id, account)
        household = await self.household_repo.get(profile.household_id)
        is_master = household is not None and household.master_account_id == account.id
        is_self = profile.claimed_account_id == account.id
        if not is_master and not is_self:
            raise ProfileAccessDeniedError()
        if is_self:
            if not req.password:
                raise CredentialsInvalidError()
            await self._verify_password(account, req.password)
        previous = profile.birth_date
        profile.birth_date = req.birth_date
        apply_age_flags(profile)
        profile.row_version += 1
        row = await self.guardian_repo.add_birth_date_correction(
            BirthDateCorrection(
                household_id=profile.household_id,
                profile_id=profile.id,
                actor_account_id=account.id,
                previous_birth_date=previous,
                new_birth_date=req.birth_date,
                reason=req.reason,
            )
        )
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="profile.birth_date_corrected",
            target_ref=str(row.id),
            event_metadata={"civil_complete": str(profile.adult_transitioned_at is not None).lower()},
        )
        await self.session.commit()
        await self.session.refresh(row)
        return BirthDateCorrectionData.model_validate(row)

    async def invalidate_civil_majority(
        self, req: CivilMajorityInvalidationRequest, *, recovery_key: str
    ) -> CivilMajorityInvalidationData:
        key_id = presented_key_matches(recovery_key)
        if key_id is None:
            raise OpsRecoveryForbiddenError()
        audit_meta = break_glass_audit_metadata(
            key_id=key_id,
            operator_id=req.operator_id,
            ticket_ref=req.ticket_ref,
        )
        audit_meta["review_status"] = "invalidated"
        audit_meta["invalidated"] = "true"
        existing_key = await self.guardian_repo.get_transition_by_invalidation_key(req.idempotency_key)
        if existing_key is not None:
            return CivilMajorityInvalidationData.model_validate(existing_key)
        profile = await self.profile_repo.get_for_update(req.profile_id)
        if profile is None:
            raise ProfileNotFoundError()
        active = await self.guardian_repo.get_active_transition(profile.id)
        if active is None:
            raise ProfileNotFoundError()
        now = datetime.now(tz=timezone.utc)
        open_deletion = await self.guardian_repo.open_deletion(profile.id)
        if open_deletion is not None or profile.lifecycle_status in {
            LifecycleStatus.PENDING_DELETE,
            LifecycleStatus.DELETED,
        }:
            active.review_status = "needs_review"
            active.invalidated_reason = req.reason
            active.previous_birth_date = req.previous_birth_date
            active.new_birth_date = req.new_birth_date
            active.invalidation_idempotency_key = req.idempotency_key
            await record_audit(
                self.session,
                actor_account_id=None,
                household_id=profile.household_id,
                event_type="ops.civil_majority_review",
                target_ref=str(active.id),
                event_metadata={
                    **break_glass_audit_metadata(
                        key_id=key_id,
                        operator_id=req.operator_id,
                        ticket_ref=req.ticket_ref,
                    ),
                    "review_status": "needs_review",
                    "idempotent": "false",
                },
            )
            await self.session.commit()
            await self.session.refresh(active)
            return CivilMajorityInvalidationData.model_validate(active)
        active.invalidated_at = now
        active.invalidated_reason = req.reason
        active.review_status = "invalidated"
        active.previous_birth_date = req.previous_birth_date
        active.new_birth_date = req.new_birth_date
        active.invalidation_idempotency_key = req.idempotency_key
        profile.adult_transitioned_at = None
        apply_age_flags(profile)
        profile.row_version += 1
        household = await self.household_repo.get_for_update(profile.household_id)
        if household is not None:
            await bump_session_epoch(self.session, household, self.redis)
        from app.repositories.member_pin_repository import MemberPinRepository

        await MemberPinRepository(self.session).revoke_sessions(profile.id)
        await record_audit(
            self.session,
            actor_account_id=None,
            household_id=profile.household_id,
            event_type="ops.civil_majority_invalidated",
            target_ref=str(active.id),
            event_metadata=audit_meta,
        )
        await self.session.commit()
        await self.session.refresh(active)
        return CivilMajorityInvalidationData.model_validate(active)
