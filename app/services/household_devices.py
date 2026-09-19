"""공용 벽 기기 페어링. 구성원 PIN으로는 등록하지 않는다."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends
from redis.asyncio import Redis

from app.core.db.session import SessionDep
from app.core.redis.client import get_redis_optional
from app.core.utils.security import verify_password_async
from app.dtos.household_devices import (
    DevicePairingCreatedData,
    EmergencyDeviceRevocationData,
    HouseholdDeviceClaimedData,
    HouseholdDeviceData,
    HouseholdDeviceListData,
    WallProfileCardData,
    WallProfileListData,
)
from app.exceptions import (
    CredentialsInvalidError,
    DeviceNotFoundError,
    DeviceRevokedError,
    HouseholdMasterRequiredError,
    HouseholdNotFoundError,
    PairingConsumedError,
    PairingExpiredError,
    PairingNotFoundError,
    ProfileNotFoundError,
    VersionMismatchError,
)
from app.models.household_devices import HouseholdDevice, HouseholdDevicePairing, HouseholdDeviceStatus
from app.models.households import HouseholdStatus
from app.models.service_accounts import ServiceAccount
from app.repositories.household_device_repository import HouseholdDeviceRepository
from app.repositories.household_repository import HouseholdRepository
from app.repositories.member_pin_repository import MemberPinRepository
from app.repositories.profile_repository import ProfileRepository
from app.services.household_session import bump_session_epoch
from app.services.profile_access import record_audit

PAIRING_TTL = timedelta(minutes=5)
_PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def digest_secret(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def generate_pairing_code() -> str:
    return "".join(secrets.choice(_PAIRING_ALPHABET) for _ in range(8))


def get_household_device_repository(session: SessionDep) -> HouseholdDeviceRepository:
    return HouseholdDeviceRepository(session)


def get_household_repository(session: SessionDep) -> HouseholdRepository:
    return HouseholdRepository(session)


def get_profile_repository(session: SessionDep) -> ProfileRepository:
    return ProfileRepository(session)


class HouseholdDeviceService:
    def __init__(
        self,
        session: SessionDep,
        device_repo: Annotated[HouseholdDeviceRepository, Depends(get_household_device_repository)],
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
        profile_repo: Annotated[ProfileRepository, Depends(get_profile_repository)],
        redis: Annotated[Redis | None, Depends(get_redis_optional)] = None,
    ) -> None:
        self.session = session
        self.device_repo = device_repo
        self.household_repo = household_repo
        self.profile_repo = profile_repo
        self.redis = redis

    async def _require_master(self, household_id: uuid.UUID, account: ServiceAccount):
        household = await self.household_repo.get(household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        if household.master_account_id != account.id:
            raise HouseholdMasterRequiredError()
        return household

    async def _reauth(self, account: ServiceAccount, password: str) -> None:
        if not await verify_password_async(password, account.password_hash):
            raise CredentialsInvalidError()

    async def create_pairing(
        self, household_id: uuid.UUID, account: ServiceAccount, password: str
    ) -> DevicePairingCreatedData:
        await self._require_master(household_id, account)
        await self._reauth(account, password)
        code = generate_pairing_code()
        pairing = await self.device_repo.create_pairing(
            HouseholdDevicePairing(
                household_id=household_id,
                created_by_account_id=account.id,
                code_hash=digest_secret(code),
                expires_at=datetime.now(tz=timezone.utc) + PAIRING_TTL,
            )
        )
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=household_id,
            event_type="household_device.pairing_created",
            target_ref=str(pairing.id),
            event_metadata={"ttl_seconds": str(int(PAIRING_TTL.total_seconds()))},
        )
        await self.session.commit()
        await self.session.refresh(pairing)
        return DevicePairingCreatedData(
            pairing_id=pairing.id,
            household_id=household_id,
            code=code,
            expires_at=pairing.expires_at,
        )

    async def claim_device(
        self,
        *,
        pairing_code: str,
        household_id: uuid.UUID,
        display_name: str,
        device_ref: str,
    ) -> HouseholdDeviceClaimedData:
        pairing = await self.device_repo.get_pairing_by_hash(digest_secret(pairing_code.strip().upper()))
        if pairing is None or pairing.household_id != household_id:
            raise PairingNotFoundError()
        now = datetime.now(tz=timezone.utc)
        if pairing.consumed_at is not None:
            raise PairingConsumedError()
        if pairing.expires_at <= now:
            raise PairingExpiredError()
        household = await self.household_repo.get(household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()

        raw_token = secrets.token_urlsafe(32)
        pairing.consumed_at = now
        device = await self.device_repo.create_device(
            HouseholdDevice(
                household_id=household_id,
                pairing_id=pairing.id,
                created_by_account_id=pairing.created_by_account_id,
                display_name=display_name,
                device_ref=device_ref,
                token_hash=digest_secret(raw_token),
                status=HouseholdDeviceStatus.ACTIVE,
                issued_session_epoch=household.session_epoch,
            )
        )
        await record_audit(
            self.session,
            actor_account_id=pairing.created_by_account_id,
            household_id=household_id,
            event_type="household_device.claimed",
            target_ref=str(device.id),
            event_metadata={"display_name_len": str(len(display_name))},
        )
        await self.session.commit()
        await self.session.refresh(device)
        return HouseholdDeviceClaimedData(
            id=device.id,
            household_id=device.household_id,
            display_name=device.display_name,
            device_token=raw_token,
            status=device.status.value,
            row_version=device.row_version,
            created_at=device.created_at,
        )

    async def list_devices(self, household_id: uuid.UUID, account: ServiceAccount) -> HouseholdDeviceListData:
        await self._require_master(household_id, account)
        devices = await self.device_repo.list_for_household(household_id)
        return HouseholdDeviceListData(items=[_to_data(item) for item in devices])

    async def revoke(
        self,
        household_id: uuid.UUID,
        device_id: uuid.UUID,
        account: ServiceAccount,
        password: str,
        *,
        expected_version: int | None = None,
    ) -> None:
        await self._require_master(household_id, account)
        await self._reauth(account, password)
        device = await self.device_repo.get_device_for_update(device_id)
        if device is None or device.household_id != household_id:
            raise DeviceNotFoundError()
        if expected_version is not None and device.row_version != expected_version:
            raise VersionMismatchError()
        if device.status is HouseholdDeviceStatus.REVOKED:
            return
        device.status = HouseholdDeviceStatus.REVOKED
        device.revoked_at = datetime.now(tz=timezone.utc)
        device.row_version += 1
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=household_id,
            event_type="household_device.revoked",
            target_ref=str(device.id),
            event_metadata={},
        )
        await self.session.commit()

    async def emergency_revoke_all(
        self, household_id: uuid.UUID, account: ServiceAccount, password: str
    ) -> EmergencyDeviceRevocationData:
        await self._require_master(household_id, account)
        await self._reauth(account, password)
        household = await self.household_repo.get_for_update(household_id)
        if household is None:
            raise HouseholdNotFoundError()
        now = datetime.now(tz=timezone.utc)
        devices = await self.device_repo.list_for_household(household_id)
        revoked_devices = 0
        for device in devices:
            if device.status is HouseholdDeviceStatus.REVOKED:
                continue
            device.status = HouseholdDeviceStatus.REVOKED
            device.revoked_at = now
            device.row_version += 1
            revoked_devices += 1
        revoked_sessions = await MemberPinRepository(self.session).revoke_sessions_for_household(household_id)
        epoch = household.session_epoch
        if revoked_devices or revoked_sessions:
            epoch = await bump_session_epoch(self.session, household, self.redis)
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=household_id,
            event_type="household_device.emergency_revoked",
            target_ref=str(household_id),
            target_type="household",
            event_metadata={
                "revoked_device_count": str(revoked_devices),
                "revoked_session_count": str(revoked_sessions),
                "session_epoch": str(epoch),
            },
        )
        await self.session.commit()
        return EmergencyDeviceRevocationData(
            id=household_id,
            household_id=household_id,
            revoked_device_count=revoked_devices,
            revoked_session_count=revoked_sessions,
        )

    async def resolve_device_token(self, raw_token: str) -> HouseholdDevice:
        device = await self.device_repo.get_by_token_hash(digest_secret(raw_token))
        if device is None:
            raise DeviceNotFoundError()
        if device.status is HouseholdDeviceStatus.REVOKED:
            raise DeviceRevokedError()
        household = await self.household_repo.get(device.household_id)
        if household is None or device.issued_session_epoch < household.session_epoch:
            raise DeviceRevokedError()
        return device

    async def wall_profiles(self, device: HouseholdDevice) -> WallProfileListData:
        await self.device_repo.touch(device)
        await self.session.commit()
        profiles = await self.profile_repo.list_by_household(device.household_id, include_hidden=False)
        items = [
            WallProfileCardData(
                id=profile.id,
                display_name=profile.display_name,
                relationship=profile.relationship,
                member_role=profile.member_role.value,
            )
            for profile in profiles
        ]
        return WallProfileListData(household_id=device.household_id, items=items)

    async def pin_challenge(self, device: HouseholdDevice, profile_id: uuid.UUID) -> None:
        await self.device_repo.touch(device)
        profile = await self.profile_repo.get(profile_id)
        if profile is None or profile.household_id != device.household_id:
            raise ProfileNotFoundError()
        if profile.status != "active":
            raise ProfileNotFoundError()
        await self.session.commit()


def _to_data(device: HouseholdDevice) -> HouseholdDeviceData:
    return HouseholdDeviceData(
        id=device.id,
        household_id=device.household_id,
        display_name=device.display_name,
        status=device.status.value,
        last_seen_at=device.last_seen_at,
        created_at=device.created_at,
        row_version=device.row_version,
    )
