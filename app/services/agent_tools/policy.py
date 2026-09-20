"""도구 capability·프로필 범위 정책. 러너 없이 검증한다. #206.

권한은 세 층이다. 도구 허용, 프로필·기간·필드 범위, 반환 결과 필터.
위임 PIN은 실행 중 철회될 수 있으므로 목록을 열 때와 각 호출 직전에 다시 본다.
컨텍스트 값은 호출자가 DB에서 다시 읽어 넣어야 한다. 이 모듈은 전달값을 비교할 뿐이다.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from app.dtos.health_record_query import (
    HealthRecordQueryArguments,
    HealthRecordQueryResult,
    RelativePeriod,
)
from app.models.profiles import MemberRole
from app.services.agent_tools.project import (
    TOOL_DISABLED,
    TOOL_NOT_AUTHORIZED,
    TOOL_NOT_MODEL_SELECTABLE,
    TOOL_NOT_REGISTERED,
    TOOL_POLICY_CONTEXT_REQUIRED,
    TOOL_SCOPE_DENIED,
    TOOL_SESSION_CONTEXT_INCOMPLETE,
    TOOL_SESSION_REVOKED,
    ToolPolicyError,
)
from app.services.agent_tools.registry import TOOLS_BY_NAME, project_health_record_query_result
from app.services.profile_capabilities import ProfileCapability

SessionType = Literal["account", "pin", "wall"]
MinorPolicyState = Literal[
    "none",
    "privacy_self_determination",
    "civil_majority_pending",
    "civil_majority_completed",
]

HEALTH_RECORD_TOOLS = frozenset({"query_health_records", "get_alcohol_consultation_snapshot"})
DEFAULT_MAX_PERIOD_MONTHS = 12
SELF_ONLY_MAX_PERIOD_MONTHS = 3
RESTRICTED_MAX_PERIOD_MONTHS = 1
CIVIL_MAJORITY_PENDING_MAX_PERIOD_MONTHS = 1
_PIN_LIKE_SESSIONS = frozenset({"pin", "wall"})


@dataclass(frozen=True)
class ToolPolicyContext:
    account_id: UUID
    active_profile_id: UUID
    household_id: UUID
    session_type: SessionType
    actor_role: MemberRole
    capabilities: frozenset[ProfileCapability]
    minor_policy_state: str
    pin_session_valid: bool = True
    actor_profile_id: UUID | None = None
    pin_actor_id: UUID | None = None
    current_pin_actor_id: UUID | None = None
    session_epoch: int | None = None
    current_session_epoch: int | None = None


@dataclass(frozen=True)
class ToolPolicyAuth:
    """HTTP 인증에서 확정한 값. 클라이언트 JSON으로 만들지 않는다."""

    session_type: SessionType = "account"
    member_session_id: UUID | None = None
    bound_pin_actor_id: UUID | None = None
    bound_issued_epoch: int | None = None


def tool_policy_context(
    *,
    account_id: UUID,
    active_profile_id: UUID,
    household_id: UUID,
    session_type: SessionType,
    actor_role: MemberRole | str,
    capabilities: Iterable[ProfileCapability | str],
    minor_policy_state: str,
    pin_session_valid: bool = True,
    actor_profile_id: UUID | None = None,
    pin_actor_id: UUID | None = None,
    current_pin_actor_id: UUID | None = None,
    session_epoch: int | None = None,
    current_session_epoch: int | None = None,
) -> ToolPolicyContext:
    role = actor_role if isinstance(actor_role, MemberRole) else MemberRole(actor_role)
    caps = frozenset(cap if isinstance(cap, ProfileCapability) else ProfileCapability(cap) for cap in capabilities)
    return ToolPolicyContext(
        account_id=account_id,
        active_profile_id=active_profile_id,
        household_id=household_id,
        session_type=session_type,
        actor_role=role,
        capabilities=caps,
        minor_policy_state=minor_policy_state,
        pin_session_valid=pin_session_valid,
        actor_profile_id=actor_profile_id,
        pin_actor_id=pin_actor_id,
        current_pin_actor_id=current_pin_actor_id,
        session_epoch=session_epoch,
        current_session_epoch=current_session_epoch,
    )


def session_context_incomplete(ctx: ToolPolicyContext) -> bool:
    if ctx.session_type not in _PIN_LIKE_SESSIONS:
        return False
    return (
        ctx.actor_profile_id is None
        or ctx.pin_actor_id is None
        or ctx.current_pin_actor_id is None
        or ctx.session_epoch is None
        or ctx.current_session_epoch is None
    )


def session_revoked(ctx: ToolPolicyContext) -> bool:
    if session_context_incomplete(ctx):
        return True
    if not ctx.pin_session_valid:
        return True
    if ctx.session_type in _PIN_LIKE_SESSIONS:
        if ctx.session_epoch != ctx.current_session_epoch:
            return True
        if ctx.pin_actor_id != ctx.current_pin_actor_id:
            return True
    return False


def _require_session(ctx: ToolPolicyContext) -> None:
    if ctx.session_type in _PIN_LIKE_SESSIONS and session_context_incomplete(ctx):
        raise ToolPolicyError(TOOL_SESSION_CONTEXT_INCOMPLETE)
    if session_revoked(ctx):
        raise ToolPolicyError(TOOL_SESSION_REVOKED)


def can_read_records(ctx: ToolPolicyContext, target_profile_id: UUID) -> bool:
    """세션의 활성 프로필만 읽는다. 도구 인자로 대상을 바꿀 수 없다."""
    if session_context_incomplete(ctx) or session_revoked(ctx):
        return False
    if target_profile_id != ctx.active_profile_id:
        return False
    self_target = ctx.actor_profile_id is not None and ctx.actor_profile_id == ctx.active_profile_id
    if ctx.minor_policy_state == "civil_majority_pending" and not self_target:
        return False
    if self_target:
        return ProfileCapability.VIEW_OWN_RECORDS in ctx.capabilities
    if ctx.actor_role is MemberRole.SELF_ONLY:
        return False
    return ProfileCapability.VIEW_HOUSEHOLD_RECORDS in ctx.capabilities


def period_limit_months(ctx: ToolPolicyContext) -> int:
    if ctx.minor_policy_state == "civil_majority_pending":
        return CIVIL_MAJORITY_PENDING_MAX_PERIOD_MONTHS
    if ctx.actor_role is MemberRole.RESTRICTED:
        return RESTRICTED_MAX_PERIOD_MONTHS
    if ctx.actor_role is MemberRole.SELF_ONLY:
        return SELF_ONLY_MAX_PERIOD_MONTHS
    return DEFAULT_MAX_PERIOD_MONTHS


def _enabled_names(exposure: str) -> frozenset[str]:
    return frozenset(
        spec.name
        for spec in TOOLS_BY_NAME.values()
        if spec.enabled and spec.exposure == exposure and spec.name not in HEALTH_RECORD_TOOLS
    )


def allowed_tools(
    *,
    account_id: UUID,
    active_profile_id: UUID,
    household_id: UUID,
    session_type: SessionType,
    actor_role: MemberRole | str,
    capabilities: Iterable[ProfileCapability | str],
    minor_policy_state: str,
    pin_session_valid: bool = True,
    actor_profile_id: UUID | None = None,
    pin_actor_id: UUID | None = None,
    current_pin_actor_id: UUID | None = None,
    session_epoch: int | None = None,
    current_session_epoch: int | None = None,
) -> frozenset[str]:
    ctx = tool_policy_context(
        account_id=account_id,
        active_profile_id=active_profile_id,
        household_id=household_id,
        session_type=session_type,
        actor_role=actor_role,
        capabilities=capabilities,
        minor_policy_state=minor_policy_state,
        pin_session_valid=pin_session_valid,
        actor_profile_id=actor_profile_id,
        pin_actor_id=pin_actor_id,
        current_pin_actor_id=current_pin_actor_id,
        session_epoch=session_epoch,
        current_session_epoch=current_session_epoch,
    )
    return allowed_tools_for(ctx)


def allowed_tools_for(ctx: ToolPolicyContext) -> frozenset[str]:
    """모델에 열 도구. server_prefetch는 여기 없다."""
    if session_context_incomplete(ctx) or session_revoked(ctx):
        return frozenset()
    names = set(_enabled_names("model_selectable"))
    if can_read_records(ctx, ctx.active_profile_id):
        names.add("query_health_records")
    names.discard("document_vision")
    return frozenset(names)


def allowed_prefetch_tools_for(ctx: ToolPolicyContext) -> frozenset[str]:
    if session_context_incomplete(ctx) or session_revoked(ctx):
        return frozenset()
    names = set(_enabled_names("server_prefetch"))
    if can_read_records(ctx, ctx.active_profile_id) and ctx.actor_role is not MemberRole.RESTRICTED:
        names.add("get_alcohol_consultation_snapshot")
    return frozenset(names)


def require_policy_context(ctx: ToolPolicyContext | None) -> ToolPolicyContext:
    if ctx is None:
        raise ToolPolicyError(TOOL_POLICY_CONTEXT_REQUIRED)
    return ctx


def _require_registered(name: str) -> None:
    spec = TOOLS_BY_NAME.get(name)
    if spec is None:
        raise ToolPolicyError(TOOL_NOT_REGISTERED)
    if not spec.enabled:
        raise ToolPolicyError(TOOL_DISABLED)
    if spec.exposure == "not_agent_callable":
        raise ToolPolicyError(TOOL_NOT_MODEL_SELECTABLE)


def authorize_tool(
    name: str,
    ctx: ToolPolicyContext,
    *,
    target_profile_id: UUID | None = None,
    requested_period_months: int | None = None,
    for_model: bool = True,
) -> None:
    _require_session(ctx)
    _require_registered(name)
    spec = TOOLS_BY_NAME[name]
    if for_model:
        if spec.exposure != "model_selectable":
            raise ToolPolicyError(TOOL_NOT_MODEL_SELECTABLE)
        allowed = allowed_tools_for(ctx)
    else:
        allowed = allowed_prefetch_tools_for(ctx)
    if name not in allowed:
        raise ToolPolicyError(TOOL_NOT_AUTHORIZED)
    target = target_profile_id or ctx.active_profile_id
    if name in HEALTH_RECORD_TOOLS:
        if not can_read_records(ctx, target):
            raise ToolPolicyError(TOOL_SCOPE_DENIED)
        if requested_period_months is not None and requested_period_months > period_limit_months(ctx):
            raise ToolPolicyError(TOOL_SCOPE_DENIED)


def constrain_query_arguments(
    query: HealthRecordQueryArguments,
    ctx: ToolPolicyContext,
) -> HealthRecordQueryArguments:
    limit = period_limit_months(ctx)
    if query.period.value <= limit:
        return query
    return query.model_copy(update={"period": RelativePeriod(type="relative_months", value=limit)})


def filter_query_result(
    result: HealthRecordQueryResult,
    ctx: ToolPolicyContext,
    *,
    target_profile_id: UUID,
    requested_period_months: int,
) -> HealthRecordQueryResult:
    if not can_read_records(ctx, target_profile_id):
        raise ToolPolicyError(TOOL_SCOPE_DENIED)
    limit = period_limit_months(ctx)
    if requested_period_months > limit:
        raise ToolPolicyError(TOOL_SCOPE_DENIED)
    projected = project_health_record_query_result(result)
    if ctx.actor_role is MemberRole.RESTRICTED:
        return projected.model_copy(update={"latest_matches": []})
    return projected
