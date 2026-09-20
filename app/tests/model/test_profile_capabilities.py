from datetime import date
from uuid import uuid4

from app.models.profiles import LifecycleStatus, OwnershipType
from app.services.profile_capabilities import (
    CapabilityContext,
    CapabilityGrantView,
    GrantEffect,
    MemberRole,
    ProfileCapability,
    can_access_records,
    evaluate_capabilities,
    has_capability,
    infer_ownership,
    role_from_relationship,
)


def _ctx(**overrides: object) -> CapabilityContext:
    household_id = uuid4()
    requester = uuid4()
    base = {
        "requester_account_id": requester,
        "target_profile_id": uuid4(),
        "target_household_id": household_id,
        "requester_household_id": household_id,
        "is_active_member": True,
        "is_master": True,
        "ownership_type": OwnershipType.LOCAL_SLOT,
        "lifecycle_status": LifecycleStatus.ACTIVE,
        "member_role": MemberRole.ADULT_MEMBER,
        "claimed_account_id": None,
        "created_by_account_id": requester,
        "actor_profile_id": None,
        "actor_role": None,
        "grants": (),
    }
    base.update(overrides)
    return CapabilityContext(**base)  # type: ignore[arg-type]


def test_relationship_maps_to_role() -> None:
    assert role_from_relationship("자녀") is MemberRole.SELF_ONLY
    assert role_from_relationship("child") is MemberRole.SELF_ONLY
    assert role_from_relationship("기타") is MemberRole.RESTRICTED
    assert role_from_relationship("배우자") is MemberRole.ADULT_MEMBER


def test_infer_ownership_defaults() -> None:
    assert (
        infer_ownership(relationship="본인", birth_date=None, account_email=None, claimed_account_id=None)
        is OwnershipType.LOCAL_SLOT
    )
    claimed = uuid4()
    assert (
        infer_ownership(relationship="본인", birth_date="1980-01-01", account_email="a@b.c", claimed_account_id=claimed)
        is OwnershipType.CLAIMED_ADULT
    )
    assert (
        infer_ownership(relationship="자녀", birth_date="2020-01-01", account_email=None, claimed_account_id=None)
        is OwnershipType.GUARDIAN_MANAGED
    )
    assert (
        infer_ownership(
            relationship="본인",
            birth_date=date(date.today().year - 10, 1, 1).isoformat(),
            account_email="kid@example.com",
            claimed_account_id=None,
        )
        is OwnershipType.GUARDIAN_MANAGED
    )


def test_cross_household_yields_no_capabilities() -> None:
    ctx = _ctx(requester_household_id=uuid4(), is_active_member=False)
    assert evaluate_capabilities(ctx) == frozenset()
    assert can_access_records(ctx, write=False) is False


def test_unshared_claimed_owner_keeps_own_records() -> None:
    owner = uuid4()
    household = uuid4()
    ctx = _ctx(
        requester_account_id=owner,
        claimed_account_id=owner,
        ownership_type=OwnershipType.CLAIMED_ADULT,
        lifecycle_status=LifecycleStatus.UNSHARED,
        is_master=False,
        is_active_member=False,
        requester_household_id=None,
        target_household_id=household,
        created_by_account_id=uuid4(),
    )
    assert can_access_records(ctx, write=True) is True
    assert has_capability(ctx, ProfileCapability.PURGE_CLAIMED_PROFILE) is True
    master = _ctx(
        ownership_type=OwnershipType.CLAIMED_ADULT,
        claimed_account_id=owner,
        lifecycle_status=LifecycleStatus.UNSHARED,
        is_master=True,
        target_household_id=household,
        requester_household_id=household,
    )
    assert evaluate_capabilities(master) == frozenset()


def test_master_can_hide_and_unshare_but_not_purge_claimed_adult() -> None:
    owner = uuid4()
    ctx = _ctx(ownership_type=OwnershipType.CLAIMED_ADULT, claimed_account_id=owner, is_master=True)
    assert has_capability(ctx, ProfileCapability.HIDE_PROFILE) is True
    assert has_capability(ctx, ProfileCapability.UNSHARE_PROFILE) is True
    assert has_capability(ctx, ProfileCapability.PURGE_CLAIMED_PROFILE) is False
    assert can_access_records(ctx, write=True) is False


def test_claimed_owner_can_purge_own_profile() -> None:
    owner = uuid4()
    ctx = _ctx(
        requester_account_id=owner,
        claimed_account_id=owner,
        ownership_type=OwnershipType.CLAIMED_ADULT,
        is_master=False,
        created_by_account_id=uuid4(),
    )
    assert has_capability(ctx, ProfileCapability.PURGE_CLAIMED_PROFILE) is True
    assert can_access_records(ctx, write=True) is True


def test_guardian_managed_cannot_be_purged() -> None:
    ctx = _ctx(ownership_type=OwnershipType.GUARDIAN_MANAGED, member_role=MemberRole.SELF_ONLY)
    assert has_capability(ctx, ProfileCapability.PURGE_EMPTY_PROFILE) is False
    assert has_capability(ctx, ProfileCapability.PURGE_CLAIMED_PROFILE) is False
    assert has_capability(ctx, ProfileCapability.HIDE_PROFILE) is True
    assert has_capability(ctx, ProfileCapability.REQUEST_MINOR_DELETION) is False


def test_product_guardian_can_write_and_reset_pin_without_legal_delete() -> None:
    ctx = _ctx(
        is_master=False,
        is_product_guardian=True,
        ownership_type=OwnershipType.GUARDIAN_MANAGED,
        member_role=MemberRole.SELF_ONLY,
        created_by_account_id=uuid4(),
    )
    assert has_capability(ctx, ProfileCapability.WRITE_MANAGED_RECORDS) is True
    assert has_capability(ctx, ProfileCapability.RESET_MANAGED_PIN) is True
    assert has_capability(ctx, ProfileCapability.REQUEST_MINOR_DELETION) is False


def test_pending_civil_majority_suspends_guardian_high_risk() -> None:
    ctx = _ctx(
        ownership_type=OwnershipType.GUARDIAN_MANAGED,
        is_product_guardian=True,
        guardian_high_risk_suspended=True,
        legal_verification_status="verified",
    )
    assert has_capability(ctx, ProfileCapability.WRITE_MANAGED_RECORDS) is False
    assert has_capability(ctx, ProfileCapability.RESET_MANAGED_PIN) is False
    assert has_capability(ctx, ProfileCapability.REQUEST_MINOR_DELETION) is False
    assert has_capability(ctx, ProfileCapability.VIEW_HOUSEHOLD_RECORDS) is False
    assert has_capability(ctx, ProfileCapability.VIEW_PUBLIC_SUMMARY) is True
    assert has_capability(ctx, ProfileCapability.CLAIM_SELF) is True
    assert has_capability(ctx, ProfileCapability.HIDE_PROFILE) is True
    assert can_access_records(ctx, write=False) is False


def test_reapproved_share_scopes_restore_selected_caps() -> None:
    ctx = _ctx(
        ownership_type=OwnershipType.CLAIMED_ADULT,
        is_product_guardian=True,
        guardian_high_risk_suspended=True,
        share_scopes=("view_public_summary", "view_sensitive_records"),
        claimed_account_id=uuid4(),
    )
    assert has_capability(ctx, ProfileCapability.VIEW_PUBLIC_SUMMARY) is True
    assert has_capability(ctx, ProfileCapability.VIEW_HOUSEHOLD_RECORDS) is True
    assert has_capability(ctx, ProfileCapability.WRITE_MANAGED_RECORDS) is False


def test_verified_legal_representative_can_request_minor_deletion() -> None:
    ctx = _ctx(
        is_master=False,
        ownership_type=OwnershipType.GUARDIAN_MANAGED,
        legal_verification_status="verified",
        created_by_account_id=uuid4(),
    )
    assert has_capability(ctx, ProfileCapability.REQUEST_MINOR_DELETION) is True
    assert has_capability(ctx, ProfileCapability.PURGE_EMPTY_PROFILE) is False


def test_self_only_actor_cannot_write_another_profile() -> None:
    actor = uuid4()
    ctx = _ctx(
        is_master=False,
        actor_profile_id=actor,
        actor_role=MemberRole.SELF_ONLY,
        target_profile_id=uuid4(),
        ownership_type=OwnershipType.LOCAL_SLOT,
        created_by_account_id=uuid4(),
    )
    assert can_access_records(ctx, write=True) is False
    assert can_access_records(ctx, write=False) is False


def test_self_only_actor_can_write_own_profile() -> None:
    actor = uuid4()
    ctx = _ctx(
        is_master=False,
        actor_profile_id=actor,
        actor_role=MemberRole.SELF_ONLY,
        target_profile_id=actor,
        ownership_type=OwnershipType.GUARDIAN_MANAGED,
        created_by_account_id=uuid4(),
    )
    assert can_access_records(ctx, write=True) is True
    assert can_access_records(ctx, write=False) is True


def test_restricted_cannot_write_managed_records() -> None:
    ctx = _ctx(
        is_master=False,
        actor_role=MemberRole.RESTRICTED,
        created_by_account_id=uuid4(),
        ownership_type=OwnershipType.LOCAL_SLOT,
    )
    assert can_access_records(ctx, write=True) is False
    assert can_access_records(ctx, write=False) is False


def test_role_change_to_self_only_drops_household_view() -> None:
    adult = _ctx(is_master=False, actor_role=MemberRole.ADULT_MEMBER, created_by_account_id=uuid4())
    child = _ctx(is_master=False, actor_role=MemberRole.SELF_ONLY, created_by_account_id=uuid4())
    assert ProfileCapability.VIEW_HOUSEHOLD_RECORDS in evaluate_capabilities(adult)
    assert ProfileCapability.VIEW_HOUSEHOLD_RECORDS not in evaluate_capabilities(child)


def test_deny_grant_removes_household_view() -> None:
    target = uuid4()
    ctx = _ctx(
        target_profile_id=target,
        grants=(
            CapabilityGrantView(
                profile_id=target,
                capability=ProfileCapability.VIEW_HOUSEHOLD_RECORDS,
                effect=GrantEffect.DENY,
            ),
        ),
    )
    assert ProfileCapability.VIEW_HOUSEHOLD_RECORDS not in evaluate_capabilities(ctx)


def test_archived_blocks_writes_but_restores() -> None:
    ctx = _ctx(lifecycle_status=LifecycleStatus.ARCHIVED)
    assert has_capability(ctx, ProfileCapability.RESTORE_PROFILE) is True
    assert can_access_records(ctx, write=True) is False
    assert can_access_records(ctx, write=False) is True


def test_pending_delete_is_restorable() -> None:
    ctx = _ctx(lifecycle_status=LifecycleStatus.PENDING_DELETE)
    assert has_capability(ctx, ProfileCapability.RESTORE_PROFILE) is True
    assert can_access_records(ctx, write=True) is False


def test_grandfather_household_member_can_write_local_slot() -> None:
    ctx = _ctx(is_master=False, actor_role=None, created_by_account_id=uuid4())
    assert can_access_records(ctx, write=True) is True
    assert can_access_records(ctx, write=False) is True
