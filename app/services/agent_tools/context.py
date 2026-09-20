"""서버가 검증한 계정·프로필·PIN 세션으로 도구 정책 컨텍스트를 만든다. #206.

클라이언트 JSON의 역할·capability·epoch를 그대로 쓰지 않는다.
각 도구 실행 직전에 이 로더를 다시 호출해 현재 DB 값을 읽는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profiles import FamilyProfile, MemberRole
from app.models.service_accounts import ServiceAccount
from app.repositories.household_repository import HouseholdRepository
from app.repositories.member_pin_repository import MemberPinRepository
from app.repositories.profile_repository import ProfileRepository
from app.services.agent_tools.policy import (
    SessionType,
    ToolPolicyAuth,
    ToolPolicyContext,
    tool_policy_context,
)
from app.services.profile_access import build_context
from app.services.profile_capabilities import evaluate_capabilities


def minor_policy_state_for(profile: FamilyProfile) -> str:
    if profile.adult_transitioned_at is not None:
        return "civil_majority_completed"
    if profile.adult_transition_pending_at is not None:
        return "civil_majority_pending"
    if profile.privacy_self_determined_at is not None:
        return "privacy_self_determination"
    return "none"


def _claimed_actor(profiles: list[FamilyProfile], account_id: UUID, active: FamilyProfile) -> FamilyProfile | None:
    if active.claimed_account_id == account_id:
        return active
    claimed = [row for row in profiles if row.claimed_account_id == account_id]
    if not claimed:
        return None
    return claimed[0]


@dataclass
class _PinView:
    pin_session_valid: bool
    actor_profile_id: UUID | None
    current_pin_actor_id: UUID | None
    active_profile_id: UUID


class DbToolPolicySource:
    def __init__(
        self,
        session: AsyncSession,
        *,
        profile_repo: ProfileRepository,
        household_repo: HouseholdRepository,
        pin_repo: MemberPinRepository,
    ) -> None:
        self.session = session
        self.profile_repo = profile_repo
        self.household_repo = household_repo
        self.pin_repo = pin_repo

    async def _pin_view(self, auth: ToolPolicyAuth, requested_profile_id: UUID) -> _PinView:
        if auth.session_type not in {"pin", "wall"}:
            return _PinView(True, None, None, requested_profile_id)
        member_session = None
        if auth.member_session_id is not None:
            member_session = await self.pin_repo.get_session(auth.member_session_id)
        if member_session is None:
            return _PinView(False, None, None, requested_profile_id)
        now = datetime.now(tz=timezone.utc)
        valid = member_session.revoked_at is None and member_session.expires_at > now
        credential = await self.pin_repo.get_credential(member_session.profile_id)
        if credential is None or credential.generation != member_session.credential_generation:
            valid = False
        return _PinView(valid, member_session.profile_id, member_session.profile_id, member_session.profile_id)

    async def _actor_role(
        self,
        *,
        session_type: SessionType,
        account: ServiceAccount,
        profile: FamilyProfile,
        actor_profile_id: UUID | None,
    ) -> tuple[UUID | None, MemberRole]:
        if session_type == "account":
            household_profiles = await self.profile_repo.list_by_household(profile.household_id, include_hidden=True)
            actor = _claimed_actor(household_profiles, account.id, profile)
            if actor is None:
                return None, MemberRole.ADULT_MEMBER
            return actor.id, actor.member_role
        if actor_profile_id is None:
            return None, MemberRole.ADULT_MEMBER
        actor_row = await self.profile_repo.get(actor_profile_id)
        if actor_row is None:
            return actor_profile_id, MemberRole.ADULT_MEMBER
        return actor_profile_id, actor_row.member_role

    async def load(
        self,
        *,
        account: ServiceAccount,
        requested_profile_id: UUID,
        auth: ToolPolicyAuth,
    ) -> ToolPolicyContext:
        account_id = account.id
        self.session.expire_all()
        await self.session.refresh(account, attribute_names=["id"])
        pin = await self._pin_view(auth, requested_profile_id)
        profile = await self.profile_repo.get(pin.active_profile_id)
        household = None
        if profile is not None:
            await self.session.refresh(profile, attribute_names=["household_id", "id"])
            household = await self.household_repo.get(profile.__dict__["household_id"])
        current_session_epoch = None
        if household is not None:
            await self.session.refresh(household, attribute_names=["session_epoch"])
            current_session_epoch = household.__dict__.get("session_epoch")
        if profile is None:
            return tool_policy_context(
                account_id=account_id,
                active_profile_id=pin.active_profile_id,
                household_id=pin.active_profile_id,
                session_type=auth.session_type,
                actor_role=MemberRole.ADULT_MEMBER,
                capabilities=(),
                minor_policy_state="none",
                pin_session_valid=False,
                actor_profile_id=pin.actor_profile_id,
                pin_actor_id=auth.bound_pin_actor_id,
                current_pin_actor_id=pin.current_pin_actor_id,
                session_epoch=auth.bound_issued_epoch,
                current_session_epoch=current_session_epoch,
            )
        actor_profile_id, actor_role = await self._actor_role(
            session_type=auth.session_type,
            account=account,
            profile=profile,
            actor_profile_id=pin.actor_profile_id,
        )
        cap_ctx = await build_context(
            session=self.session,
            household_repo=self.household_repo,
            profile_repo=self.profile_repo,
            account=account,
            profile=profile,
            actor_profile_id=actor_profile_id,
        )
        return tool_policy_context(
            account_id=account_id,
            active_profile_id=profile.__dict__["id"],
            household_id=profile.__dict__["household_id"],
            session_type=auth.session_type,
            actor_role=actor_role,
            capabilities=evaluate_capabilities(cap_ctx),
            minor_policy_state=minor_policy_state_for(profile),
            pin_session_valid=pin.pin_session_valid,
            actor_profile_id=actor_profile_id,
            pin_actor_id=auth.bound_pin_actor_id,
            current_pin_actor_id=pin.current_pin_actor_id,
            session_epoch=auth.bound_issued_epoch,
            current_session_epoch=current_session_epoch,
        )
