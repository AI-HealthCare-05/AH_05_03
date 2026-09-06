import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.health_records import HealthRecord


class HealthRecordRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, record_id: uuid.UUID) -> HealthRecord | None:
        return await self.session.get(HealthRecord, record_id)

    async def list_by_profile(
        self,
        profile_id: uuid.UUID,
        record_type: str | None = None,
        include_deleted: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> list[HealthRecord]:
        query = select(HealthRecord).where(HealthRecord.profile_id == profile_id)
        if not include_deleted:
            query = query.where(HealthRecord.status != "deleted")
        if record_type:
            query = query.where(HealthRecord.record_type == record_type)
        query = query.order_by(HealthRecord.recorded_at.desc()).limit(limit).offset(offset)
        result = await self.session.scalars(query)
        return list(result)

    async def create(self, record: HealthRecord) -> HealthRecord:
        self.session.add(record)
        await self.session.flush()
        return record

    async def soft_delete(self, record: HealthRecord) -> HealthRecord:
        record.status = "deleted"
        await self.session.flush()
        return record

    async def upsert(self, record: HealthRecord) -> HealthRecord:
        stmt = (
            pg_insert(HealthRecord)
            .values(
                id=record.id,
                profile_id=record.profile_id,
                record_type=record.record_type,
                recorded_at=record.recorded_at,
                source=record.source,
                payload=record.payload,
                note=record.note,
                status=record.status,
                row_version=record.row_version,
            )
            .on_conflict_do_update(
                index_elements=[HealthRecord.id],
                set_={
                    "record_type": record.record_type,
                    "recorded_at": record.recorded_at,
                    "source": record.source,
                    "payload": record.payload,
                    "note": record.note,
                    "status": record.status,
                    "row_version": record.row_version,
                },
            )
            .returning(HealthRecord)
        )
        result = await self.session.scalar(stmt)
        return result or record
