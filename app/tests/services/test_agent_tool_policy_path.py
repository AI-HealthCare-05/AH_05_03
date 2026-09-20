from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import date
from typing import Any, cast

import pytest

from app.dtos.health_assistant import (
    ChatMessage,
    HealthAssistantChatRequest,
    HealthAssistantLlmResponse,
    HealthAssistantResponse,
    HealthAssistantScopeDecision,
    ProfileContext,
)
from app.dtos.health_record_query import HealthRecordQueryMatch, HealthRecordQueryPeriod, HealthRecordQueryResult
from app.models.profiles import MemberRole
from app.models.service_accounts import ServiceAccount
from app.services.agent_tools.policy import (
    ToolPolicyAuth,
    allowed_tools_for,
    tool_policy_context,
)
from app.services.agent_tools.project import TOOL_POLICY_CONTEXT_REQUIRED
from app.services.health_assistant import HealthAssistantService
from app.services.health_records import HealthRecordService
from app.services.profile_capabilities import ProfileCapability

_BP_QUESTION = "지난 3개월 동안 혈압 140을 넘은 날이 며칠이야?"
_QUERY_ARGS = {
    "record_type": "blood_pressure",
    "period": {"type": "relative_months", "value": 3},
    "metric": "systolic",
    "operator": "gt",
    "threshold": 140,
    "aggregation": "count_days",
}


def _ctx(
    *,
    account_id: uuid.UUID,
    profile_id: uuid.UUID,
    role: MemberRole = MemberRole.ADULT_MEMBER,
    caps: frozenset[ProfileCapability] | None = None,
    session_type: str = "account",
    pin_session_valid: bool = True,
    actor_profile_id: uuid.UUID | None = None,
    pin_actor_id: uuid.UUID | None = None,
    current_pin_actor_id: uuid.UUID | None = None,
    session_epoch: int | None = 1,
    current_session_epoch: int | None = 1,
):
    return tool_policy_context(
        account_id=account_id,
        active_profile_id=profile_id,
        household_id=uuid.uuid4(),
        session_type=session_type,  # type: ignore[arg-type]
        actor_role=role,
        capabilities=caps or frozenset({ProfileCapability.VIEW_OWN_RECORDS, ProfileCapability.VIEW_PUBLIC_SUMMARY}),
        minor_policy_state="none",
        pin_session_valid=pin_session_valid,
        actor_profile_id=profile_id if actor_profile_id is None else actor_profile_id,
        pin_actor_id=pin_actor_id,
        current_pin_actor_id=current_pin_actor_id if current_pin_actor_id is not None else pin_actor_id,
        session_epoch=session_epoch,
        current_session_epoch=current_session_epoch,
    )


class _FixedSource:
    def __init__(self, ctx: object) -> None:
        self.ctx = ctx
        self.loads = 0

    async def load(self, **_kwargs: Any) -> object:
        self.loads += 1
        return self.ctx


class _ScriptedSource:
    def __init__(self, first: object, second: object) -> None:
        self.first = first
        self.second = second
        self.loads = 0

    async def load(self, **_kwargs: Any) -> object:
        self.loads += 1
        return self.first if self.loads == 1 else self.second


class _RecordService:
    async def query_numeric_summary(self, *_args: Any, **_kwargs: Any) -> HealthRecordQueryResult:
        return HealthRecordQueryResult(
            record_type="blood_pressure",
            metric="systolic",
            operator="gt",
            threshold=140,
            period=HealthRecordQueryPeriod(date_from=date(2026, 6, 8), date_to=date(2026, 9, 8)),
            matched_days=7,
            matched_measurements=9,
            total_measurements=42,
            latest_matches=[HealthRecordQueryMatch(date=date(2026, 9, 3), value=145)],
            message="지난 3개월 동안 수축기 혈압이 140mmHg를 초과한 날은 총 7일입니다.",
        )


class _QueryClient:
    def __init__(self) -> None:
        self.offered_tools: list[Any] | None = None

    async def generate_structured_response(self, *, response_schema: Any = None, **_kwargs: Any) -> Any:
        if response_schema is HealthAssistantLlmResponse:
            return HealthAssistantLlmResponse(
                intent="query_records", assistant_message="지금은 건강기록을 조회할 수 없습니다."
            )
        return HealthAssistantScopeDecision(
            request_kind="information",
            clinical_contexts=["none"],
            scope="health",
            requires_authoritative_evidence=False,
        )

    def stream_structured_response(self, **_kwargs: Any) -> AsyncIterator[str]:
        async def chunks() -> AsyncIterator[str]:
            yield HealthAssistantResponse(
                intent="query_records",
                assistant_message="지금은 건강기록을 조회할 수 없습니다.",
            ).model_dump_json()

        return chunks()

    async def generate_structured_response_with_tools(
        self,
        *,
        tools: Any = None,
        tool_executor: Any,
        **_kwargs: Any,
    ) -> tuple[HealthAssistantLlmResponse, Any]:
        self.offered_tools = tools
        result = await tool_executor("query_health_records", _QUERY_ARGS)
        return (
            HealthAssistantLlmResponse(intent="query_records", assistant_message="조회했습니다."),
            result,
        )

    async def stream_structured_response_with_tools(
        self,
        *,
        tools: Any = None,
        tool_executor: Any,
        **_kwargs: Any,
    ) -> tuple[AsyncIterator[str], Any]:
        self.offered_tools = tools
        result = await tool_executor("query_health_records", _QUERY_ARGS)

        async def chunks() -> AsyncIterator[str]:
            yield HealthAssistantResponse(intent="query_records", assistant_message="조회했습니다.").model_dump_json()

        return chunks(), result


def _request(profile_id: uuid.UUID) -> HealthAssistantChatRequest:
    return HealthAssistantChatRequest(
        messages=[ChatMessage(role="user", content=_BP_QUESTION)],
        profile_context=ProfileContext(profile_id=profile_id, profile_name="본인"),
    )


def _service(account: ServiceAccount, profile_id: uuid.UUID, source: object, client: _QueryClient | None = None):
    llm = client or _QueryClient()
    return HealthAssistantService(
        llm_client=cast(Any, llm),
        health_record_service=cast(HealthRecordService, _RecordService()),
        policy_source=source,
    ), llm


@pytest.mark.asyncio
async def test_respond_rejects_other_profile_health_query() -> None:
    account = ServiceAccount(id=uuid.uuid4(), email="a@example.com", password_hash="hash")
    own_id = uuid.uuid4()
    other_id = uuid.uuid4()
    source = _FixedSource(
        _ctx(
            account_id=account.id,
            profile_id=other_id,
            actor_profile_id=own_id,
            caps=frozenset({ProfileCapability.VIEW_OWN_RECORDS, ProfileCapability.VIEW_PUBLIC_SUMMARY}),
        )
    )
    service, _ = _service(account, other_id, source)
    response = await service.respond(_request(other_id), account)
    assert response.health_record_query_result is None
    assert source.loads >= 1


@pytest.mark.asyncio
async def test_stream_rejects_other_profile_health_query() -> None:
    account = ServiceAccount(id=uuid.uuid4(), email="a@example.com", password_hash="hash")
    own_id = uuid.uuid4()
    other_id = uuid.uuid4()
    source = _FixedSource(
        _ctx(
            account_id=account.id,
            profile_id=other_id,
            actor_profile_id=own_id,
            caps=frozenset({ProfileCapability.VIEW_OWN_RECORDS, ProfileCapability.VIEW_PUBLIC_SUMMARY}),
        )
    )
    service, _ = _service(account, other_id, source)
    events = [event async for event in service.stream(_request(other_id), account)]
    result = next(payload for name, payload in events if name == "result")
    assert result["health_record_query_result"] is None


@pytest.mark.asyncio
async def test_pin_revoke_rejects_next_tool_call() -> None:
    account = ServiceAccount(id=uuid.uuid4(), email="a@example.com", password_hash="hash")
    profile_id = uuid.uuid4()
    actor = uuid.uuid4()
    valid = _ctx(
        account_id=account.id,
        profile_id=profile_id,
        session_type="pin",
        actor_profile_id=profile_id,
        pin_actor_id=actor,
        pin_session_valid=True,
    )
    revoked = _ctx(
        account_id=account.id,
        profile_id=profile_id,
        session_type="pin",
        actor_profile_id=profile_id,
        pin_actor_id=actor,
        pin_session_valid=False,
    )
    source = _ScriptedSource(valid, revoked)
    service, _ = _service(
        account,
        profile_id,
        source,
    )
    service._policy_auth = ToolPolicyAuth(
        session_type="pin",
        member_session_id=uuid.uuid4(),
        bound_pin_actor_id=actor,
        bound_issued_epoch=1,
    )
    response = await service.respond(_request(profile_id), account)
    assert response.health_record_query_result is None
    assert source.loads >= 2


@pytest.mark.asyncio
async def test_epoch_bump_rejects_next_tool_call() -> None:
    account = ServiceAccount(id=uuid.uuid4(), email="a@example.com", password_hash="hash")
    profile_id = uuid.uuid4()
    actor = uuid.uuid4()
    first = _ctx(
        account_id=account.id,
        profile_id=profile_id,
        session_type="wall",
        actor_profile_id=profile_id,
        pin_actor_id=actor,
        session_epoch=1,
        current_session_epoch=1,
    )
    bumped = _ctx(
        account_id=account.id,
        profile_id=profile_id,
        session_type="wall",
        actor_profile_id=profile_id,
        pin_actor_id=actor,
        session_epoch=1,
        current_session_epoch=2,
    )
    source = _ScriptedSource(first, bumped)
    service, _ = _service(account, profile_id, source)
    service._policy_auth = ToolPolicyAuth(
        session_type="wall",
        member_session_id=uuid.uuid4(),
        bound_pin_actor_id=actor,
        bound_issued_epoch=1,
    )
    events = [event async for event in service.stream(_request(profile_id), account)]
    result = next(payload for name, payload in events if name == "result")
    assert result["health_record_query_result"] is None
    assert source.loads >= 2


@pytest.mark.asyncio
async def test_restricted_query_drops_latest_matches() -> None:
    account = ServiceAccount(id=uuid.uuid4(), email="a@example.com", password_hash="hash")
    profile_id = uuid.uuid4()
    ctx = _ctx(
        account_id=account.id,
        profile_id=profile_id,
        role=MemberRole.RESTRICTED,
        caps=frozenset({ProfileCapability.VIEW_OWN_RECORDS, ProfileCapability.VIEW_PUBLIC_SUMMARY}),
    )
    source = _FixedSource(ctx)
    service, _ = _service(account, profile_id, source)
    response = await service.respond(_request(profile_id), account)
    assert response.health_record_query_result is not None
    assert response.health_record_query_result.latest_matches == []


@pytest.mark.asyncio
async def test_execute_tool_requires_policy_context_for_health_records() -> None:
    account = ServiceAccount(id=uuid.uuid4(), email="a@example.com", password_hash="hash")
    profile_id = uuid.uuid4()
    service, _ = _service(account, profile_id, source=None)
    with pytest.raises(Exception) as ex:
        await service._execute_tool(
            "query_health_records",
            _QUERY_ARGS,
            account=account,
            profile_id=profile_id,
            policy_ctx=None,
        )
    assert getattr(ex.value, "reason", None) == TOOL_POLICY_CONTEXT_REQUIRED


@pytest.mark.asyncio
async def test_missing_policy_context_rejects_health_query() -> None:
    account = ServiceAccount(id=uuid.uuid4(), email="a@example.com", password_hash="hash")
    profile_id = uuid.uuid4()
    service, _ = _service(account, profile_id, source=None)
    response = await service.respond(_request(profile_id), account)
    assert response.health_record_query_result is None


@pytest.mark.asyncio
async def test_offered_tools_match_allowed_tools() -> None:
    account = ServiceAccount(id=uuid.uuid4(), email="a@example.com", password_hash="hash")
    profile_id = uuid.uuid4()
    ctx = _ctx(account_id=account.id, profile_id=profile_id)
    source = _FixedSource(ctx)
    client = _QueryClient()
    service, llm = _service(account, profile_id, source, client)
    await service.respond(_request(profile_id), account)
    offered = HealthAssistantService._tool_declaration_names(llm.offered_tools)
    assert offered <= allowed_tools_for(ctx)
    assert offered == frozenset({"query_health_records"})
