"""ORM 행을 capability 평가 입력으로 바꾼다. 판단 자체는 profile_capabilities 하나다."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import (
    HouseholdMembershipRequiredError,
    HouseholdNotFoundError,
    ProfileAccessDeniedError,
    VersionMismatchError,
)
from app.models.guardians import GuardianLinkKind
from app.models.households import HouseholdStatus
from app.models.profiles import CapabilityGrant, FamilyProfile, LifecycleStatus, MemberRole, OwnershipType
from app.models.service_accounts import ServiceAccount
from app.repositories.guardian_repository import GuardianRepository
from app.repositories.household_repository import HouseholdRepository
from app.repositories.profile_repository import ProfileRepository
from app.services.profile_capabilities import (
    SHARE_SCOPE_TO_CAPS,
    CapabilityContext,
    CapabilityGrantView,
    GrantEffect,
    ProfileCapability,
    can_access_records,
    has_capability,
)


async def load_grants(session: AsyncSession, profile_id: uuid.UUID) -> tuple[CapabilityGrantView, ...]:
    rows = (await session.scalars(select(CapabilityGrant).where(CapabilityGrant.profile_id == profile_id))).all()
    views: list[CapabilityGrantView] = []
    for row in rows:
        try:
            capability = ProfileCapability(row.capability)
            effect = GrantEffect(row.effect)
        except ValueError:
            continue
        views.append(CapabilityGrantView(profile_id=row.profile_id, capability=capability, effect=effect))
    return tuple(views)


async def build_context(
    *,
    session: AsyncSession,
    household_repo: HouseholdRepository,
    profile_repo: ProfileRepository,
    account: ServiceAccount,
    profile: FamilyProfile,
    actor_profile_id: uuid.UUID | None,
) -> CapabilityContext:
    household = await household_repo.get(profile.household_id)
    if household is None or household.status is not HouseholdStatus.ACTIVE:
        raise HouseholdNotFoundError()
    is_member = await household_repo.has_active_membership(profile.household_id, account.id)
    actor_role: MemberRole | None = None
    if actor_profile_id is not None:
        actor = await profile_repo.get(actor_profile_id)
        if actor is None or actor.household_id != profile.household_id:
            raise ProfileAccessDeniedError()
        actor_role = actor.member_role
    guardian_repo = GuardianRepository(session)
    now = datetime.now(tz=timezone.utc)
    product = await guardian_repo.is_product_guardian(profile.id, account.id)
    legal = await guardian_repo.legal_status_for_account(profile.id, account.id, now=now)
    high_risk_suspended = False
    share_scopes: tuple[str, ...] = ()
    # 민법상 성년 대기는 보호자 관리형만 민감기록을 멈춘다. 본인 슬롯(local_slot)
    # 에 생년만 있으면 가구 마스터의 통증·판정까지 같이 403 이 난다.
    pending_majority = profile.adult_transitioned_at is None and profile.adult_transition_pending_at is not None
    if pending_majority and profile.ownership_type is OwnershipType.GUARDIAN_MANAGED:
        high_risk_suspended = True
    elif profile.adult_transitioned_at is not None and profile.claimed_account_id != account.id:
        share = await guardian_repo.find_link(profile.id, account.id, GuardianLinkKind.PRODUCT_GUARDIAN)
        high_risk_suspended = not share_is_active(share, now=now)
        if share is not None and not high_risk_suspended:
            share_scopes = parse_share_scopes(share.share_capabilities)
    return CapabilityContext(
        requester_account_id=account.id,
        target_profile_id=profile.id,
        target_household_id=profile.household_id,
        requester_household_id=profile.household_id if is_member else None,
        is_master=household.master_account_id == account.id,
        is_active_member=is_member,
        ownership_type=profile.ownership_type,
        lifecycle_status=profile.lifecycle_status,
        member_role=profile.member_role,
        claimed_account_id=profile.claimed_account_id,
        created_by_account_id=profile.created_by_account_id,
        actor_profile_id=actor_profile_id,
        actor_role=actor_role,
        grants=await load_grants(session, profile.id),
        is_product_guardian=product,
        legal_verification_status=legal,
        guardian_high_risk_suspended=high_risk_suspended,
        share_scopes=share_scopes,
    )


def _claimed_owner(ctx: CapabilityContext) -> bool:
    return ctx.claimed_account_id is not None and ctx.claimed_account_id == ctx.requester_account_id


def require_capability(ctx: CapabilityContext, capability: ProfileCapability) -> None:
    if not ctx.is_active_member and not _claimed_owner(ctx):
        raise HouseholdMembershipRequiredError()
    if not has_capability(ctx, capability):
        raise ProfileAccessDeniedError()


def require_record_access(ctx: CapabilityContext, *, write: bool) -> None:
    if not ctx.is_active_member and not _claimed_owner(ctx):
        raise HouseholdMembershipRequiredError()
    if not can_access_records(ctx, write=write):
        raise ProfileAccessDeniedError()


def apply_lifecycle(profile: FamilyProfile, lifecycle: LifecycleStatus) -> None:
    from app.services.profile_capabilities import status_from_lifecycle

    profile.lifecycle_status = lifecycle
    profile.status = status_from_lifecycle(lifecycle)
    if lifecycle is LifecycleStatus.ACTIVE:
        profile.purge_after = None
        profile.purged_at = None


def apply_age_flags(profile: FamilyProfile) -> None:
    from app.services.minor_policy import has_reached_civil_majority

    if profile.adult_transitioned_at is not None:
        profile.adult_transition_pending_at = None
        return
    if has_reached_civil_majority(profile.birth_date):
        if profile.adult_transition_pending_at is None:
            profile.adult_transition_pending_at = datetime.now(tz=timezone.utc)
    else:
        profile.adult_transition_pending_at = None


def check_row_version(profile: FamilyProfile, expected_version: int | None) -> None:
    if expected_version is not None and profile.row_version != expected_version:
        raise VersionMismatchError()


def share_is_active(share: object, *, now: datetime) -> bool:
    from app.models.guardians import GuardianLink

    if not isinstance(share, GuardianLink):
        return False
    if share.share_reapproved_at is None or share.share_revoked_at is not None:
        return False
    if share.share_expires_at is None or share.share_expires_at <= now:
        return False
    return True


def parse_share_scopes(raw: str | None) -> tuple[str, ...]:
    if not raw:
        return ()
    seen: list[str] = []
    for item in raw.split(","):
        key = item.strip()
        if key in SHARE_SCOPE_TO_CAPS and key not in seen:
            seen.append(key)
    return tuple(seen)


_AUDIT_METADATA_ALLOWLIST = frozenset(
    {
        "attempts",
        "generation",
        "ttl_seconds",
        "outcome",
        "policy",
        "civil_complete",
        "auto_transfer",
        "from_role",
        "to_role",
        "ownership_type",
        "member_role",
        "lifecycle_status",
        "kind",
        "revoked_device_count",
        "revoked_session_count",
        "alert_id",
        "display_name_len",
        "error_code",
        "result",
        "capability",
        "device_id",
        "scope",
        "expires_in_days",
        "review_status",
        "invalidated",
        "idempotent",
        "adapter",
        "status",
        "session_epoch",
        "event_type",
        "asserted_operator_id",
        "asserted_ticket_ref",
        "authentication_method",
        "identity_verified",
        "key_id",
        "env",
    }
)
_SECRET_FRAGMENTS = ("pin", "password", "token", "secret", "passcode", "bearer ", "dek")


def sanitize_audit_metadata(event_metadata: object) -> dict[str, str]:
    """이벤트별 허용 필드만 남긴다. 중첩·배열·금지 값은 버린다."""
    cleaned: dict[str, str] = {}

    def walk(node: object) -> None:
        if isinstance(node, dict):
            for raw_key, value in node.items():
                key = str(raw_key).split("?", 1)[0].lower()
                if isinstance(value, dict | list):
                    walk(value)
                    continue
                if key not in _AUDIT_METADATA_ALLOWLIST:
                    continue
                text = str(value)[:80]
                lowered = text.lower()
                if any(part in lowered for part in _SECRET_FRAGMENTS):
                    continue
                cleaned[key] = text
            return
        if isinstance(node, list):
            for item in node:
                walk(item)

    walk(event_metadata)
    return cleaned


async def actor_household_id(session: AsyncSession, account_id: uuid.UUID) -> uuid.UUID | None:
    from app.models.households import Household, HouseholdMembership, HouseholdStatus, MembershipStatus

    return await session.scalar(
        select(Household.id)
        .join(HouseholdMembership, HouseholdMembership.household_id == Household.id)
        .where(
            HouseholdMembership.account_id == account_id,
            HouseholdMembership.status == MembershipStatus.ACTIVE,
            Household.status == HouseholdStatus.ACTIVE,
        )
        .limit(1)
    )


async def record_audit(
    session: AsyncSession,
    *,
    actor_account_id: uuid.UUID | None,
    household_id: uuid.UUID | None,
    event_type: str,
    target_ref: str,
    event_metadata: dict[str, str],
    target_type: str = "family_profile",
) -> None:
    from app.models.profiles import AccountAuditEvent

    session.add(
        AccountAuditEvent(
            actor_account_id=actor_account_id,
            household_id=household_id,
            event_type=event_type,
            target_type=target_type,
            target_ref=target_ref[:86],
            event_metadata=sanitize_audit_metadata(event_metadata),
        )
    )
