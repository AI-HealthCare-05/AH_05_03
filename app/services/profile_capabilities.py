"""프로필 소유권·역할 → capability. 서버 인가의 단일 평가기.

프런트 버튼 숨김과 같은 판단을 두 곳에 두지 않는다. 민감 API는 여기 결과를
거절 근거로 쓴다. 위임 PIN·벽 기기 세션은 평가 입력이 될 수 있으나
자격 증명 저장(#191)과 기기 등록(#190)은 이 모듈 밖이다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from uuid import UUID

from app.core.utils.enums import StrEnum
from app.models.profiles import LifecycleStatus, MemberRole, OwnershipType
from app.services.minor_policy import is_minor

_CHILD_RELATIONSHIPS = frozenset({"자녀", "child", "son", "daughter", "아들", "딸"})
_RESTRICTED_RELATIONSHIPS = frozenset({"기타", "other"})


class ProfileCapability(StrEnum):
    VIEW_OWN_RECORDS = "view_own_records"
    WRITE_OWN_RECORDS = "write_own_records"
    VIEW_HOUSEHOLD_RECORDS = "view_household_records"
    WRITE_MANAGED_RECORDS = "write_managed_records"
    HIDE_PROFILE = "hide_profile"
    ARCHIVE_PROFILE = "archive_profile"
    RESTORE_PROFILE = "restore_profile"
    UNSHARE_PROFILE = "unshare_profile"
    PURGE_EMPTY_PROFILE = "purge_empty_profile"
    PURGE_CLAIMED_PROFILE = "purge_claimed_profile"
    MANAGE_MEMBER_ROLE = "manage_member_role"
    RESET_MANAGED_PIN = "reset_managed_pin"
    REQUEST_MINOR_DELETION = "request_minor_deletion"
    VIEW_PUBLIC_SUMMARY = "view_public_summary"
    CLAIM_SELF = "claim_self"
    VIEW_HOUSEHOLD_AUDIT = "view_household_audit"
    VIEW_OWN_AUDIT = "view_own_audit"


SHARE_SCOPE_TO_CAPS: dict[str, frozenset[ProfileCapability]] = {
    "view_public_summary": frozenset({ProfileCapability.VIEW_PUBLIC_SUMMARY, ProfileCapability.HIDE_PROFILE}),
    "view_health_summary": frozenset({ProfileCapability.VIEW_HOUSEHOLD_RECORDS}),
    "view_sensitive_records": frozenset({ProfileCapability.VIEW_HOUSEHOLD_RECORDS}),
    "write_sensitive_records": frozenset({ProfileCapability.WRITE_MANAGED_RECORDS}),
    "reset_managed_pin": frozenset({ProfileCapability.RESET_MANAGED_PIN}),
}
DEFAULT_SHARE_SCOPES = ("view_public_summary",)
SHARE_POLICY_VERSION = "guardian-share-v1"
PENDING_SUSPENDED_CAPS = frozenset(
    {
        ProfileCapability.VIEW_HOUSEHOLD_RECORDS,
        ProfileCapability.WRITE_MANAGED_RECORDS,
        ProfileCapability.RESET_MANAGED_PIN,
        ProfileCapability.REQUEST_MINOR_DELETION,
        ProfileCapability.PURGE_EMPTY_PROFILE,
        ProfileCapability.PURGE_CLAIMED_PROFILE,
        ProfileCapability.ARCHIVE_PROFILE,
        ProfileCapability.UNSHARE_PROFILE,
        ProfileCapability.WRITE_OWN_RECORDS,
    }
)


class GrantEffect(StrEnum):
    ALLOW = "allow"
    DENY = "deny"


ROLE_BUNDLES: dict[MemberRole, frozenset[ProfileCapability]] = {
    MemberRole.ADULT_MEMBER: frozenset(
        {
            ProfileCapability.VIEW_OWN_RECORDS,
            ProfileCapability.WRITE_OWN_RECORDS,
            ProfileCapability.VIEW_HOUSEHOLD_RECORDS,
            ProfileCapability.WRITE_MANAGED_RECORDS,
            ProfileCapability.VIEW_OWN_AUDIT,
            ProfileCapability.CLAIM_SELF,
            ProfileCapability.VIEW_PUBLIC_SUMMARY,
        }
    ),
    MemberRole.SELF_ONLY: frozenset(
        {
            ProfileCapability.VIEW_OWN_RECORDS,
            ProfileCapability.WRITE_OWN_RECORDS,
            ProfileCapability.VIEW_OWN_AUDIT,
            ProfileCapability.CLAIM_SELF,
            ProfileCapability.VIEW_PUBLIC_SUMMARY,
        }
    ),
    MemberRole.RESTRICTED: frozenset(
        {ProfileCapability.VIEW_OWN_RECORDS, ProfileCapability.VIEW_PUBLIC_SUMMARY, ProfileCapability.VIEW_OWN_AUDIT}
    ),
}


@dataclass(frozen=True)
class CapabilityGrantView:
    profile_id: UUID
    capability: ProfileCapability
    effect: GrantEffect


@dataclass(frozen=True)
class CapabilityContext:
    requester_account_id: UUID
    target_profile_id: UUID
    target_household_id: UUID
    requester_household_id: UUID | None
    is_active_member: bool
    is_master: bool
    ownership_type: OwnershipType
    lifecycle_status: LifecycleStatus
    member_role: MemberRole
    claimed_account_id: UUID | None
    created_by_account_id: UUID
    actor_profile_id: UUID | None = None
    actor_role: MemberRole | None = None
    grants: tuple[CapabilityGrantView, ...] = field(default_factory=tuple)
    is_product_guardian: bool = False
    legal_verification_status: str | None = None
    guardian_high_risk_suspended: bool = False
    share_scopes: tuple[str, ...] = field(default_factory=tuple)


def role_from_relationship(relationship: str) -> MemberRole:
    key = relationship.strip().lower()
    if relationship.strip() in _CHILD_RELATIONSHIPS or key in _CHILD_RELATIONSHIPS:
        return MemberRole.SELF_ONLY
    if relationship.strip() in _RESTRICTED_RELATIONSHIPS or key in _RESTRICTED_RELATIONSHIPS:
        return MemberRole.RESTRICTED
    return MemberRole.ADULT_MEMBER


def infer_ownership(
    *,
    relationship: str,
    birth_date: str | None,
    account_email: str | None,
    claimed_account_id: UUID | None,
    today: date | None = None,
    adult_transitioned: bool = False,
) -> OwnershipType:
    if adult_transitioned:
        if claimed_account_id is not None or (account_email is not None and account_email.strip() != ""):
            return OwnershipType.CLAIMED_ADULT
        return OwnershipType.LOCAL_SLOT
    role = role_from_relationship(relationship)
    minor = is_minor(birth_date, today)
    if role is MemberRole.SELF_ONLY or minor is True:
        return OwnershipType.GUARDIAN_MANAGED
    if claimed_account_id is not None or (account_email is not None and account_email.strip() != ""):
        return OwnershipType.CLAIMED_ADULT
    return OwnershipType.LOCAL_SLOT


def lifecycle_from_status(status: str) -> LifecycleStatus:
    if status == "hidden":
        return LifecycleStatus.HIDDEN
    if status == "archived":
        return LifecycleStatus.ARCHIVED
    if status == "deleted":
        return LifecycleStatus.PENDING_DELETE
    if status == LifecycleStatus.UNSHARED.value:
        return LifecycleStatus.UNSHARED
    return LifecycleStatus.ACTIVE


def status_from_lifecycle(lifecycle: LifecycleStatus) -> str:
    if lifecycle in {LifecycleStatus.HIDDEN, LifecycleStatus.ARCHIVED}:
        return "hidden"
    if lifecycle in {LifecycleStatus.PENDING_DELETE, LifecycleStatus.DELETED}:
        return "deleted"
    return "active"


def _same_household(ctx: CapabilityContext) -> bool:
    return (
        ctx.is_active_member
        and ctx.requester_household_id is not None
        and ctx.requester_household_id == ctx.target_household_id
    )


def _role_caps(ctx: CapabilityContext, *, is_claimed_owner: bool) -> set[ProfileCapability]:
    actor_role = ctx.actor_role or MemberRole.ADULT_MEMBER
    caps = set(ROLE_BUNDLES[actor_role])
    if ctx.is_master:
        caps.update(
            {
                ProfileCapability.HIDE_PROFILE,
                ProfileCapability.ARCHIVE_PROFILE,
                ProfileCapability.RESTORE_PROFILE,
                ProfileCapability.UNSHARE_PROFILE,
                ProfileCapability.MANAGE_MEMBER_ROLE,
                ProfileCapability.VIEW_HOUSEHOLD_RECORDS,
                ProfileCapability.WRITE_MANAGED_RECORDS,
                ProfileCapability.RESET_MANAGED_PIN,
                ProfileCapability.VIEW_HOUSEHOLD_AUDIT,
            }
        )
        if ctx.ownership_type is OwnershipType.LOCAL_SLOT:
            caps.add(ProfileCapability.PURGE_EMPTY_PROFILE)
    if is_claimed_owner:
        caps.update(
            {
                ProfileCapability.VIEW_OWN_RECORDS,
                ProfileCapability.WRITE_OWN_RECORDS,
                ProfileCapability.HIDE_PROFILE,
                ProfileCapability.ARCHIVE_PROFILE,
                ProfileCapability.RESTORE_PROFILE,
                ProfileCapability.PURGE_CLAIMED_PROFILE,
            }
        )
    if ctx.created_by_account_id == ctx.requester_account_id and ctx.ownership_type is OwnershipType.LOCAL_SLOT:
        caps.add(ProfileCapability.PURGE_EMPTY_PROFILE)
        caps.add(ProfileCapability.HIDE_PROFILE)
        caps.add(ProfileCapability.ARCHIVE_PROFILE)
        caps.add(ProfileCapability.RESTORE_PROFILE)
    if ctx.is_product_guardian and ctx.ownership_type is OwnershipType.GUARDIAN_MANAGED:
        caps.update(
            {
                ProfileCapability.VIEW_HOUSEHOLD_RECORDS,
                ProfileCapability.WRITE_MANAGED_RECORDS,
                ProfileCapability.RESET_MANAGED_PIN,
                ProfileCapability.HIDE_PROFILE,
            }
        )
    if ctx.legal_verification_status == "verified" and ctx.ownership_type is OwnershipType.GUARDIAN_MANAGED:
        caps.add(ProfileCapability.REQUEST_MINOR_DELETION)
    _apply_pending_or_share(caps, ctx)
    return caps


def _apply_pending_or_share(caps: set[ProfileCapability], ctx: CapabilityContext) -> None:
    if not ctx.guardian_high_risk_suspended:
        return
    caps -= PENDING_SUSPENDED_CAPS
    caps.add(ProfileCapability.VIEW_PUBLIC_SUMMARY)
    caps.add(ProfileCapability.CLAIM_SELF)
    caps.add(ProfileCapability.HIDE_PROFILE)
    if not ctx.share_scopes:
        return
    allowed: set[ProfileCapability] = set()
    for scope in ctx.share_scopes:
        allowed.update(SHARE_SCOPE_TO_CAPS.get(scope, frozenset()))
    caps |= allowed
    if ProfileCapability.VIEW_HOUSEHOLD_RECORDS not in allowed:
        caps.discard(ProfileCapability.VIEW_HOUSEHOLD_RECORDS)
    if ProfileCapability.WRITE_MANAGED_RECORDS not in allowed:
        caps.discard(ProfileCapability.WRITE_MANAGED_RECORDS)


def _limit_by_ownership(caps: set[ProfileCapability], ctx: CapabilityContext, *, is_claimed_owner: bool) -> None:
    if ctx.ownership_type is OwnershipType.GUARDIAN_MANAGED:
        caps.discard(ProfileCapability.PURGE_EMPTY_PROFILE)
        caps.discard(ProfileCapability.PURGE_CLAIMED_PROFILE)
        if ctx.legal_verification_status != "verified" or ctx.guardian_high_risk_suspended:
            caps.discard(ProfileCapability.REQUEST_MINOR_DELETION)
    if ctx.ownership_type is OwnershipType.CLAIMED_ADULT and not is_claimed_owner:
        caps.discard(ProfileCapability.PURGE_CLAIMED_PROFILE)
        caps.discard(ProfileCapability.PURGE_EMPTY_PROFILE)
        caps.discard(ProfileCapability.WRITE_OWN_RECORDS)


def _apply_grants(caps: set[ProfileCapability], ctx: CapabilityContext) -> None:
    for grant in ctx.grants:
        if grant.profile_id != ctx.target_profile_id:
            continue
        if grant.effect is GrantEffect.ALLOW:
            caps.add(grant.capability)
        else:
            caps.discard(grant.capability)


def evaluate_capabilities(ctx: CapabilityContext) -> frozenset[ProfileCapability]:
    is_claimed_owner = ctx.claimed_account_id == ctx.requester_account_id
    if ctx.lifecycle_status is LifecycleStatus.UNSHARED:
        if not is_claimed_owner:
            return frozenset()
        return frozenset(
            {
                ProfileCapability.VIEW_OWN_RECORDS,
                ProfileCapability.WRITE_OWN_RECORDS,
                ProfileCapability.HIDE_PROFILE,
                ProfileCapability.ARCHIVE_PROFILE,
                ProfileCapability.RESTORE_PROFILE,
                ProfileCapability.PURGE_CLAIMED_PROFILE,
            }
        )
    if ctx.lifecycle_status is LifecycleStatus.DELETED:
        return frozenset()
    if not _same_household(ctx):
        return frozenset()
    caps = _role_caps(ctx, is_claimed_owner=is_claimed_owner)
    if ctx.lifecycle_status in {LifecycleStatus.ARCHIVED, LifecycleStatus.PENDING_DELETE}:
        caps.add(ProfileCapability.RESTORE_PROFILE)
        caps.discard(ProfileCapability.WRITE_OWN_RECORDS)
        caps.discard(ProfileCapability.WRITE_MANAGED_RECORDS)
    _limit_by_ownership(caps, ctx, is_claimed_owner=is_claimed_owner)
    _apply_grants(caps, ctx)
    _limit_by_ownership(caps, ctx, is_claimed_owner=is_claimed_owner)
    return frozenset(caps)


def has_capability(ctx: CapabilityContext, capability: ProfileCapability) -> bool:
    return capability in evaluate_capabilities(ctx)


def can_access_records(ctx: CapabilityContext, *, write: bool) -> bool:
    if ctx.lifecycle_status is LifecycleStatus.DELETED:
        return False
    caps = evaluate_capabilities(ctx)
    is_claimed_owner = ctx.claimed_account_id == ctx.requester_account_id
    is_self = ctx.actor_profile_id == ctx.target_profile_id or is_claimed_owner
    if write:
        if ctx.lifecycle_status in {LifecycleStatus.ARCHIVED, LifecycleStatus.PENDING_DELETE}:
            return False
        if ctx.ownership_type is OwnershipType.CLAIMED_ADULT:
            return is_claimed_owner and ProfileCapability.WRITE_OWN_RECORDS in caps
        if is_self and ProfileCapability.WRITE_OWN_RECORDS in caps:
            return True
        return ProfileCapability.WRITE_MANAGED_RECORDS in caps
    if is_self and ProfileCapability.VIEW_OWN_RECORDS in caps:
        return True
    return ProfileCapability.VIEW_HOUSEHOLD_RECORDS in caps
