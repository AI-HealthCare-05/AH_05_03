import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.household_devices import HouseholdDevice, HouseholdDevicePairing


class HouseholdDeviceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_pairing_by_hash(self, code_hash: str) -> HouseholdDevicePairing | None:
        return await self.session.scalar(
            select(HouseholdDevicePairing).where(HouseholdDevicePairing.code_hash == code_hash).with_for_update()
        )

    async def get_device(self, device_id: uuid.UUID) -> HouseholdDevice | None:
        return await self.session.get(HouseholdDevice, device_id)

    async def get_device_for_update(self, device_id: uuid.UUID) -> HouseholdDevice | None:
        return await self.session.scalar(
            select(HouseholdDevice).where(HouseholdDevice.id == device_id).with_for_update()
        )

    async def get_by_token_hash(self, token_hash: str) -> HouseholdDevice | None:
        return await self.session.scalar(select(HouseholdDevice).where(HouseholdDevice.token_hash == token_hash))

    async def list_for_household(self, household_id: uuid.UUID) -> list[HouseholdDevice]:
        result = await self.session.scalars(
            select(HouseholdDevice)
            .where(HouseholdDevice.household_id == household_id)
            .order_by(HouseholdDevice.created_at.desc())
        )
        return list(result)

    async def create_pairing(self, pairing: HouseholdDevicePairing) -> HouseholdDevicePairing:
        self.session.add(pairing)
        await self.session.flush()
        return pairing

    async def create_device(self, device: HouseholdDevice) -> HouseholdDevice:
        self.session.add(device)
        await self.session.flush()
        return device

    async def touch(self, device: HouseholdDevice) -> None:
        device.last_seen_at = datetime.now(tz=timezone.utc)
