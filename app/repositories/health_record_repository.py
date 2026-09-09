import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import Float, case, cast, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.health_records import HealthRecord


@dataclass(frozen=True)
class NumericMetricAggregate:
    total_measurements: int
    matched_measurements: int
    matched_days: int
    latest_matches: list[tuple[datetime, float]]


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

    async def aggregate_numeric_metric(
        self,
        *,
        profile_id: uuid.UUID,
        record_type: str,
        payload_keys: tuple[str, ...],
        operator: Literal["gt", "gte"],
        threshold: float,
        recorded_from: datetime,
        recorded_to: datetime,
        timezone_name: str,
        latest_limit: int = 5,
    ) -> NumericMetricAggregate:
        """허용 목록에서 선택된 JSONB 수치를 PostgreSQL이 직접 집계한다.

        JSON 숫자만 대상으로 삼아 임의 문자열을 ``float``로 캐스팅하지 않는다.
        ``payload_keys``는 LLM 입력이 아니라 서버 내부 매핑에서만 전달된다.
        """

        numeric_candidates = [
            case(
                (
                    func.jsonb_typeof(HealthRecord.payload[key]) == "number",
                    cast(HealthRecord.payload[key].astext, Float),
                ),
                else_=None,
            )
            for key in payload_keys
        ]
        metric_value = func.coalesce(*numeric_candidates)
        base_conditions = (
            HealthRecord.profile_id == profile_id,
            HealthRecord.record_type == record_type,
            HealthRecord.status != "deleted",
            HealthRecord.recorded_at >= recorded_from,
            HealthRecord.recorded_at <= recorded_to,
            metric_value.is_not(None),
        )
        if operator == "gt":
            matched_condition = metric_value > threshold
        elif operator == "gte":
            matched_condition = metric_value >= threshold
        else:  # 방어적 검사: 호출자는 검증된 Literal만 넘겨야 한다.
            raise ValueError("지원하지 않는 비교 연산자입니다.")

        total_measurements = int(
            await self.session.scalar(select(func.count()).select_from(HealthRecord).where(*base_conditions)) or 0
        )
        local_date = func.date(func.timezone(timezone_name, HealthRecord.recorded_at))
        matched_row = (
            await self.session.execute(
                select(
                    func.count().label("matched_measurements"),
                    func.count(func.distinct(local_date)).label("matched_days"),
                )
                .select_from(HealthRecord)
                .where(*base_conditions, matched_condition)
            )
        ).one()
        latest_rows = (
            await self.session.execute(
                select(HealthRecord.recorded_at, metric_value.label("metric_value"))
                .where(*base_conditions, matched_condition)
                .order_by(HealthRecord.recorded_at.desc())
                .limit(min(max(latest_limit, 0), 5))
            )
        ).all()

        return NumericMetricAggregate(
            total_measurements=total_measurements,
            matched_measurements=int(matched_row.matched_measurements or 0),
            matched_days=int(matched_row.matched_days or 0),
            latest_matches=[(row.recorded_at, float(row.metric_value)) for row in latest_rows],
        )

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
