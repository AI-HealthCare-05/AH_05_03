"""구성원 위임 PIN. 계정 JWT·벽 기기 토큰과 섞지 않는 짧은 행위자 세션만 연다."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends
from redis.asyncio import Redis

from app.core import config
from app.core.db.session import SessionDep
from app.core.redis.client import get_redis_optional
from app.core.utils.pin_hash import DUMMY_PIN_HASH, hash_pin_async, verify_pin_hash_async
from app.dtos.member_pins import MemberPinIssueData, MemberSessionData
from app.exceptions import (
    HouseholdMasterRequiredError,
    PinInvalidError,
    PinLockedError,
    PinWeakError,
    ProfileAccessDeniedError,
    ProfileNotFoundError,
)
from app.models.household_devices import HouseholdDevice
from app.models.member_pins import MemberPinCredential, MemberSession
from app.models.profiles import FamilyProfile, OwnershipType
from app.models.service_accounts import ServiceAccount
from app.repositories.household_repository import HouseholdRepository
from app.repositories.member_pin_repository import MemberPinRepository
from app.repositories.profile_repository import ProfileRepository
from app.services.member_pin_policy import (
    PIN_LOCK_SECONDS,
    PIN_MAX_ATTEMPTS,
    PIN_SESSION_SECONDS,
    generate_temporary_pin,
    is_weak_pin,
)
from app.services.profile_access import record_audit


def digest_token(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def get_member_pin_repository(session: SessionDep) -> MemberPinRepository:
    return MemberPinRepository(session)


def get_profile_repository(session: SessionDep) -> ProfileRepository:
    return ProfileRepository(session)


def get_household_repository(session: SessionDep) -> HouseholdRepository:
    return HouseholdRepository(session)


class MemberPinService:
    def __init__(
        self,
        session: SessionDep,
        pin_repo: Annotated[MemberPinRepository, Depends(get_member_pin_repository)],
        profile_repo: Annotated[ProfileRepository, Depends(get_profile_repository)],
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
        redis: Annotated[Redis | None, Depends(get_redis_optional)] = None,
    ) -> None:
        self.session = session
        self.pin_repo = pin_repo
        self.profile_repo = profile_repo
        self.household_repo = household_repo
        self.redis = redis

    async def issue(self, account: ServiceAccount, profile_id: uuid.UUID) -> MemberPinIssueData:
        profile = await self._require_profile(profile_id)
        await self._require_issuer(account, profile)
        pin = generate_temporary_pin(profile.birth_date)
        pin_hash = await hash_pin_async(pin)
        existing = await self.pin_repo.get_credential_for_update(profile.id)
        if existing is None:
            existing = await self.pin_repo.add_credential(
                MemberPinCredential(
                    profile_id=profile.id,
                    household_id=profile.household_id,
                    pin_hash=pin_hash,
                    must_change=True,
                )
            )
        else:
            existing.pin_hash = pin_hash
            existing.must_change = True
            existing.failed_attempts = 0
            existing.locked_until = None
            existing.generation += 1
            existing.row_version += 1
        await self.pin_repo.revoke_sessions(profile.id)
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="member_pin.issued",
            target_ref=str(profile.id),
            event_metadata={"generation": str(existing.generation)},
        )
        await self.session.commit()
        return MemberPinIssueData(profile_id=profile.id, temporary_pin=pin, must_change=True)

    async def discard(self, account: ServiceAccount, profile_id: uuid.UUID) -> None:
        profile = await self._require_profile(profile_id)
        await self._require_issuer(account, profile)
        existing = await self.pin_repo.get_credential_for_update(profile.id)
        if existing is not None:
            await self.session.delete(existing)
        await self.pin_repo.revoke_sessions(profile.id)
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=profile.household_id,
            event_type="member_pin.discarded",
            target_ref=str(profile.id),
            event_metadata={},
        )
        await self.session.commit()

    async def open_session(
        self,
        *,
        profile_id: uuid.UUID,
        pin: str,
        account: ServiceAccount | None = None,
        device: HouseholdDevice | None = None,
    ) -> MemberSessionData:
        profile = await self._require_profile(profile_id)
        await self._bind_actor(profile, account=account, device=device)
        credential = await self._verify_pin(profile, pin, actor_account_id=account.id if account else None)
        raw = secrets.token_urlsafe(32)
        expires_at = datetime.now(tz=timezone.utc) + timedelta(seconds=PIN_SESSION_SECONDS)
        household = await self.household_repo.get(profile.household_id)
        row = await self.pin_repo.add_session(
            MemberSession(
                profile_id=profile.id,
                household_id=profile.household_id,
                device_id=device.id if device else None,
                credential_generation=credential.generation,
                issued_session_epoch=household.session_epoch if household is not None else 1,
                token_hash=digest_token(raw),
                expires_at=expires_at,
            )
        )
        await record_audit(
            self.session,
            actor_account_id=account.id if account else None,
            household_id=profile.household_id,
            event_type="member_pin.verified",
            target_ref=str(profile.id),
            event_metadata={"device_id": str(device.id) if device else "account"},
        )
        await self.session.commit()
        return MemberSessionData(
            id=row.id,
            profile_id=profile.id,
            household_id=profile.household_id,
            member_role=profile.member_role.value,
            must_change=credential.must_change,
            session_token=raw,
            expires_at=expires_at,
        )

    async def replace_pin(
        self,
        *,
        profile_id: uuid.UUID,
        current_pin: str,
        new_pin: str,
        account: ServiceAccount | None = None,
        device: HouseholdDevice | None = None,
    ) -> None:
        profile = await self._require_profile(profile_id)
        await self._bind_actor(profile, account=account, device=device)
        if is_weak_pin(new_pin, profile.birth_date):
            raise PinWeakError()
        credential = await self._verify_pin(profile, current_pin, actor_account_id=account.id if account else None)
        credential.pin_hash = await hash_pin_async(new_pin)
        credential.must_change = False
        credential.failed_attempts = 0
        credential.locked_until = None
        credential.generation += 1
        credential.row_version += 1
        await self.pin_repo.revoke_sessions(profile.id)
        await record_audit(
            self.session,
            actor_account_id=account.id if account else None,
            household_id=profile.household_id,
            event_type="member_pin.replaced",
            target_ref=str(profile.id),
            event_metadata={},
        )
        await self.session.commit()

    async def _require_profile(self, profile_id: uuid.UUID) -> FamilyProfile:
        profile = await self.profile_repo.get(profile_id)
        if profile is None or profile.status != "active":
            raise ProfileNotFoundError()
        return profile

    async def _require_issuer(self, account: ServiceAccount, profile: FamilyProfile) -> None:
        from app.services.profile_access import apply_age_flags

        household = await self.household_repo.get(profile.household_id)
        if household is None:
            raise ProfileNotFoundError()
        apply_age_flags(profile)
        if profile.adult_transition_pending_at is not None and profile.adult_transitioned_at is None:
            raise ProfileAccessDeniedError()
        if household.master_account_id == account.id:
            return
        if profile.ownership_type is OwnershipType.GUARDIAN_MANAGED:
            from app.repositories.guardian_repository import GuardianRepository

            if await GuardianRepository(self.session).is_product_guardian(profile.id, account.id):
                return
            if profile.claimed_account_id == account.id:
                return
        raise HouseholdMasterRequiredError()

    async def _bind_actor(
        self,
        profile: FamilyProfile,
        *,
        account: ServiceAccount | None,
        device: HouseholdDevice | None,
    ) -> None:
        if device is not None:
            if device.household_id != profile.household_id:
                raise ProfileNotFoundError()
            return
        if account is None:
            raise ProfileAccessDeniedError()
        if not await self.household_repo.has_active_membership(profile.household_id, account.id):
            raise ProfileNotFoundError()

    async def _verify_pin(
        self, profile: FamilyProfile, pin: str, *, actor_account_id: uuid.UUID | None
    ) -> MemberPinCredential:
        credential = await self.pin_repo.get_credential_for_update(profile.id)
        now = datetime.now(tz=timezone.utc)
        stored_hash = credential.pin_hash if credential is not None else DUMMY_PIN_HASH
        if credential is None:
            await verify_pin_hash_async(pin, stored_hash)
            raise PinInvalidError()
        if credential.locked_until is not None and credential.locked_until > now:
            raise PinLockedError()
        matched = await verify_pin_hash_async(pin, stored_hash)
        if matched:
            credential.failed_attempts = 0
            credential.locked_until = None
            return credential
        credential.failed_attempts += 1
        locked = credential.failed_attempts >= PIN_MAX_ATTEMPTS
        if locked:
            credential.locked_until = now + timedelta(seconds=PIN_LOCK_SECONDS)
        if await self._should_record_pin_lock(profile, locked=locked):
            await record_audit(
                self.session,
                actor_account_id=actor_account_id,
                household_id=profile.household_id,
                event_type="member_pin.lock" if locked else "member_pin.failed",
                target_ref=str(profile.id),
                event_metadata={"attempts": str(credential.failed_attempts)},
            )
        await self.session.commit()
        if locked:
            raise PinLockedError()
        raise PinInvalidError()

    async def _should_record_pin_lock(self, profile: FamilyProfile, *, locked: bool) -> bool:
        if not locked:
            return True
        if self.redis is None:
            return True
        profile_key = f"{config.REDIS_KEY_PREFIX}:pin-lock-alert:{profile.household_id}:{profile.id}"
        household_key = f"{config.REDIS_KEY_PREFIX}:pin-lock-hour:{profile.household_id}"
        created = await self.redis.set(profile_key, "1", nx=True, ex=config.PIN_LOCK_ALERT_COOLDOWN_SECONDS)
        count = await self.redis.incr(household_key)
        if count == 1:
            await self.redis.expire(household_key, 3600)
        if count > 10:
            return False
        return bool(created)
