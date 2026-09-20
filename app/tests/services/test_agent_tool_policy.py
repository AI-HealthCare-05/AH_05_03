from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest

from app.dtos.health_record_query import (
    HealthRecordQueryArguments,
    HealthRecordQueryMatch,
    HealthRecordQueryPeriod,
    HealthRecordQueryResult,
    RelativePeriod,
)
from app.models.profiles import MemberRole
from app.services.agent_tools.policy import (
    allowed_tools,
    authorize_tool,
    constrain_query_arguments,
    filter_query_result,
    period_limit_months,
    tool_policy_context,
)
from app.services.agent_tools.project import (
    TOOL_DISABLED,
    TOOL_NOT_AUTHORIZED,
    TOOL_NOT_MODEL_SELECTABLE,
    TOOL_SCOPE_DENIED,
    TOOL_SESSION_REVOKED,
    ToolPolicyError,
)
from app.services.profile_capabilities import ProfileCapability

_ADULT_CAPS = frozenset(
    {
        ProfileCapability.VIEW_OWN_RECORDS,
        ProfileCapability.VIEW_HOUSEHOLD_RECORDS,
        ProfileCapability.VIEW_PUBLIC_SUMMARY,
    }
)
_SELF_CAPS = frozenset({ProfileCapability.VIEW_OWN_RECORDS, ProfileCapability.VIEW_PUBLIC_SUMMARY})
_RESTRICTED_CAPS = frozenset({ProfileCapability.VIEW_OWN_RECORDS, ProfileCapability.VIEW_PUBLIC_SUMMARY})
_PENDING_GUARDIAN_CAPS = frozenset({ProfileCapability.VIEW_PUBLIC_SUMMARY})


def _ids() -> tuple:
    return uuid4(), uuid4(), uuid4(), uuid4()


def _ctx(
    *,
    role: MemberRole = MemberRole.ADULT_MEMBER,
    caps: frozenset[ProfileCapability] = _ADULT_CAPS,
    minor: str = "none",
    pin_session_valid: bool = True,
    actor_profile_id=None,
    pin_actor_id=None,
    current_pin_actor_id=None,
    session_epoch: int | None = 1,
    current_session_epoch: int | None = 1,
    session_type: str = "account",
):
    account_id, active_profile_id, household_id, actor = _ids()
    return tool_policy_context(
        account_id=account_id,
        active_profile_id=active_profile_id,
        household_id=household_id,
        session_type=session_type,  # type: ignore[arg-type]
        actor_role=role,
        capabilities=caps,
        minor_policy_state=minor,
        pin_session_valid=pin_session_valid,
        actor_profile_id=actor_profile_id if actor_profile_id is not None else active_profile_id,
        pin_actor_id=pin_actor_id,
        current_pin_actor_id=current_pin_actor_id if current_pin_actor_id is not None else pin_actor_id,
        session_epoch=session_epoch,
        current_session_epoch=current_session_epoch,
    )


def _query_result(*, months: int = 3, with_match: bool = True) -> HealthRecordQueryResult:
    matches = [HealthRecordQueryMatch(date=date(2026, 9, 1), value=148.0)] if with_match else []
    return HealthRecordQueryResult(
        record_type="blood_pressure",
        metric="systolic",
        unit="mmHg",
        operator="gt",
        threshold=140,
        period=HealthRecordQueryPeriod(date_from=date(2026, 6, 20), date_to=date(2026, 9, 20)),
        matched_days=1 if with_match else 0,
        matched_measurements=1 if with_match else 0,
        total_measurements=4,
        latest_matches=matches,
        empty_reason=None if with_match else "no_matches",
        message="ok",
    )


def test_allowed_tools_signature_matches_baseline() -> None:
    account_id, profile_id, household_id, _ = _ids()
    names = allowed_tools(
        account_id=account_id,
        active_profile_id=profile_id,
        household_id=household_id,
        session_type="account",
        actor_role="adult_member",
        capabilities=_ADULT_CAPS,
        minor_policy_state="none",
    )
    assert "query_health_records" in names
    assert "search_nearby_hospital" in names
    assert "document_vision" not in names


def test_query_allowed_does_not_open_other_family() -> None:
    ctx = _ctx()
    other = uuid4()
    authorize_tool("query_health_records", ctx, target_profile_id=ctx.active_profile_id, for_model=True)
    with pytest.raises(ToolPolicyError) as ex:
        authorize_tool("query_health_records", ctx, target_profile_id=other)
    assert ex.value.reason == TOOL_SCOPE_DENIED


def test_self_only_cannot_read_household_records() -> None:
    ctx = _ctx(role=MemberRole.SELF_ONLY, caps=_SELF_CAPS, actor_profile_id=uuid4())
    assert "query_health_records" not in allowed_tools_for_ctx(ctx)
    with pytest.raises(ToolPolicyError) as ex:
        authorize_tool("query_health_records", ctx, target_profile_id=ctx.active_profile_id)
    assert ex.value.reason == TOOL_NOT_AUTHORIZED
    own = _ctx(role=MemberRole.SELF_ONLY, caps=_SELF_CAPS)
    assert "query_health_records" in allowed_tools_for_ctx(own)
    assert period_limit_months(own) == 3


def test_restricted_is_narrower_than_self_only() -> None:
    ctx = _ctx(role=MemberRole.RESTRICTED, caps=_RESTRICTED_CAPS)
    names = allowed_tools_for_ctx(ctx)
    assert "query_health_records" in names
    assert "get_alcohol_consultation_snapshot" not in names
    assert period_limit_months(ctx) == 1
    query = HealthRecordQueryArguments(
        record_type="blood_pressure",
        period=RelativePeriod(type="relative_months", value=12),
        metric="systolic",
        operator="gt",
        threshold=140,
        aggregation="count_days",
    )
    clamped = constrain_query_arguments(query, ctx)
    assert clamped.period.value == 1
    filtered = filter_query_result(
        _query_result(),
        ctx,
        target_profile_id=ctx.active_profile_id,
        requested_period_months=1,
    )
    assert filtered.latest_matches == []


def test_civil_majority_pending_blocks_non_self_health_tools() -> None:
    ctx = _ctx(
        role=MemberRole.ADULT_MEMBER,
        caps=_PENDING_GUARDIAN_CAPS | {ProfileCapability.VIEW_HOUSEHOLD_RECORDS},
        minor="civil_majority_pending",
        actor_profile_id=uuid4(),
    )
    names = allowed_tools_for_ctx(ctx)
    assert "query_health_records" not in names
    with pytest.raises(ToolPolicyError) as ex:
        authorize_tool("query_health_records", ctx, target_profile_id=ctx.active_profile_id)
    assert ex.value.reason == TOOL_NOT_AUTHORIZED


def test_civil_majority_pending_self_keeps_own_query_with_short_period() -> None:
    ctx = _ctx(role=MemberRole.ADULT_MEMBER, caps=_SELF_CAPS, minor="civil_majority_pending")
    assert "query_health_records" in allowed_tools_for_ctx(ctx)
    assert period_limit_months(ctx) == 1


def test_pin_revoke_rejects_next_call() -> None:
    ctx = _ctx(session_type="pin", pin_session_valid=False, pin_actor_id=uuid4())
    assert allowed_tools_for_ctx(ctx) == frozenset()
    with pytest.raises(ToolPolicyError) as ex:
        authorize_tool("search_nearby_hospital", ctx)
    assert ex.value.reason == TOOL_SESSION_REVOKED


def test_pin_actor_change_rejects_next_call() -> None:
    first = uuid4()
    ctx = _ctx(session_type="pin", pin_actor_id=first, current_pin_actor_id=uuid4())
    with pytest.raises(ToolPolicyError) as ex:
        authorize_tool("query_health_records", ctx, target_profile_id=ctx.active_profile_id)
    assert ex.value.reason == TOOL_SESSION_REVOKED


def test_session_epoch_bump_rejects_next_call() -> None:
    ctx = _ctx(session_type="wall", session_epoch=1, current_session_epoch=2)
    with pytest.raises(ToolPolicyError) as ex:
        authorize_tool("search_medication_info", ctx)
    assert ex.value.reason == TOOL_SESSION_REVOKED


def test_prefetch_alcohol_is_not_model_selectable() -> None:
    ctx = _ctx()
    with pytest.raises(ToolPolicyError) as ex:
        authorize_tool("get_alcohol_consultation_snapshot", ctx, for_model=True)
    assert ex.value.reason == TOOL_NOT_MODEL_SELECTABLE
    authorize_tool("get_alcohol_consultation_snapshot", ctx, for_model=False)


def test_document_vision_never_allowed() -> None:
    ctx = _ctx()
    assert "document_vision" not in allowed_tools_for_ctx(ctx)
    with pytest.raises(ToolPolicyError) as ex:
        authorize_tool("document_vision", ctx)
    assert ex.value.reason == TOOL_DISABLED


def test_filter_rejects_other_family_even_if_tool_was_allowed() -> None:
    ctx = _ctx()
    with pytest.raises(ToolPolicyError) as ex:
        filter_query_result(
            _query_result(),
            ctx,
            target_profile_id=uuid4(),
            requested_period_months=3,
        )
    assert ex.value.reason == TOOL_SCOPE_DENIED


def test_filter_rejects_full_period_for_restricted() -> None:
    ctx = _ctx(role=MemberRole.RESTRICTED, caps=_RESTRICTED_CAPS)
    with pytest.raises(ToolPolicyError) as ex:
        filter_query_result(
            _query_result(),
            ctx,
            target_profile_id=ctx.active_profile_id,
            requested_period_months=12,
        )
    assert ex.value.reason == TOOL_SCOPE_DENIED


def allowed_tools_for_ctx(ctx) -> frozenset[str]:
    return allowed_tools(
        account_id=ctx.account_id,
        active_profile_id=ctx.active_profile_id,
        household_id=ctx.household_id,
        session_type=ctx.session_type,
        actor_role=ctx.actor_role,
        capabilities=ctx.capabilities,
        minor_policy_state=ctx.minor_policy_state,
        pin_session_valid=ctx.pin_session_valid,
        actor_profile_id=ctx.actor_profile_id,
        pin_actor_id=ctx.pin_actor_id,
        current_pin_actor_id=ctx.current_pin_actor_id,
        session_epoch=ctx.session_epoch,
        current_session_epoch=ctx.current_session_epoch,
    )
