import uuid
from typing import Annotated

from fastapi import Depends

from app.core.db.session import SessionDep
from app.dtos.health_records import (
    HealthRecordCreateRequest,
    HealthRecordData,
    HealthRecordListData,
    HealthRecordSyncRequest,
    HealthRecordUpdateRequest,
)
from app.exceptions import (
    HealthRecordNotFoundError,
    HouseholdMembershipRequiredError,
    HouseholdNotFoundError,
    ProfileNotFoundError,
)
from app.models.health_records import HealthRecord
from app.models.households import HouseholdStatus
from app.models.service_accounts import ServiceAccount
from app.repositories.health_record_repository import HealthRecordRepository
from app.repositories.household_repository import HouseholdRepository
from app.repositories.profile_repository import ProfileRepository


def get_health_record_repository(session: SessionDep) -> HealthRecordRepository:
    return HealthRecordRepository(session)


def get_profile_repository(session: SessionDep) -> ProfileRepository:
    return ProfileRepository(session)


def get_household_repository(session: SessionDep) -> HouseholdRepository:
    return HouseholdRepository(session)


class HealthRecordService:
    def __init__(
        self,
        session: SessionDep,
        record_repo: Annotated[HealthRecordRepository, Depends(get_health_record_repository)],
        profile_repo: Annotated[ProfileRepository, Depends(get_profile_repository)],
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
    ) -> None:
        self.session = session
        self.record_repo = record_repo
        self.profile_repo = profile_repo
        self.household_repo = household_repo

    async def _verify_profile_access(self, profile_id: uuid.UUID, account: ServiceAccount) -> uuid.UUID:
        profile = await self.profile_repo.get(profile_id)
        if profile is None:
            raise ProfileNotFoundError()
        household = await self.household_repo.get(profile.household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        is_member = await self.household_repo.has_active_membership(profile.household_id, account.id)
        if not is_member:
            raise HouseholdMembershipRequiredError()
        return profile.household_id

    async def create_record(self, account: ServiceAccount, req: HealthRecordCreateRequest) -> HealthRecordData:
        await self._verify_profile_access(req.profile_id, account)

        record = HealthRecord(
            id=req.id or uuid.uuid4(),
            profile_id=req.profile_id,
            record_type=req.record_type,
            recorded_at=req.recorded_at,
            source=req.source,
            payload=req.payload,
            note=req.note,
            # 원본 서류와의 고리. 없으면 검진 이력에서 그 서류를 열 수 없다.
            source_document_id=req.source_document_id,
            status="active",
        )
        created = await self.record_repo.create(record)
        await self.session.commit()
        await self.session.refresh(created)
        return HealthRecordData.model_validate(created)

    async def list_records(
        self,
        account: ServiceAccount,
        profile_id: uuid.UUID,
        record_type: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> HealthRecordListData:
        await self._verify_profile_access(profile_id, account)

        records = await self.record_repo.list_by_profile(
            profile_id=profile_id,
            record_type=record_type,
            limit=limit,
            offset=offset,
        )
        return HealthRecordListData(
            items=[HealthRecordData.model_validate(r) for r in records],
            total=len(records),
        )

    async def get_record(self, account: ServiceAccount, record_id: uuid.UUID) -> HealthRecordData:
        record = await self.record_repo.get(record_id)
        if record is None or record.status == "deleted":
            raise HealthRecordNotFoundError()
        await self._verify_profile_access(record.profile_id, account)
        return HealthRecordData.model_validate(record)

    async def update_record(
        self, account: ServiceAccount, record_id: uuid.UUID, req: HealthRecordUpdateRequest
    ) -> HealthRecordData:
        record = await self.record_repo.get(record_id)
        if record is None or record.status == "deleted":
            raise HealthRecordNotFoundError()
        await self._verify_profile_access(record.profile_id, account)

        if req.record_type is not None:
            record.record_type = req.record_type
        if req.recorded_at is not None:
            record.recorded_at = req.recorded_at
        if req.source is not None:
            record.source = req.source
        if req.payload is not None:
            record.payload = req.payload
        if req.note is not None:
            record.note = req.note
        if req.source_document_id is not None:
            record.source_document_id = req.source_document_id
        if req.status is not None:
            record.status = req.status

        record.row_version += 1
        await self.session.commit()
        await self.session.refresh(record)
        return HealthRecordData.model_validate(record)

    async def delete_record(self, account: ServiceAccount, record_id: uuid.UUID) -> None:
        record = await self.record_repo.get(record_id)
        if record is None or record.status == "deleted":
            raise HealthRecordNotFoundError()
        await self._verify_profile_access(record.profile_id, account)

        await self.record_repo.soft_delete(record)
        record.row_version += 1
        await self.session.commit()

    async def sync_records(self, account: ServiceAccount, req: HealthRecordSyncRequest) -> HealthRecordListData:
        results: list[HealthRecordData] = []
        for r in req.records:
            await self._verify_profile_access(r.profile_id, account)
            model = HealthRecord(
                id=r.id,
                profile_id=r.profile_id,
                record_type=r.record_type,
                recorded_at=r.recorded_at,
                source=r.source,
                payload=r.payload,
                note=r.note,
                source_document_id=r.source_document_id,
                status=r.status,
                row_version=r.row_version,
            )
            saved = await self.record_repo.upsert(model)
            results.append(HealthRecordData.model_validate(saved))
        await self.session.commit()
        return HealthRecordListData(items=results, total=len(results))
