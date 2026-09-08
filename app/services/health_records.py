import calendar
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import Depends

from app.core.db.session import SessionDep
from app.dtos.health_record_query import (
    HealthRecordQueryArguments,
    HealthRecordQueryMatch,
    HealthRecordQueryPeriod,
    HealthRecordQueryResult,
)
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

_SEOUL = ZoneInfo("Asia/Seoul")


@dataclass(frozen=True)
class _MetricSpec:
    payload_keys: tuple[str, ...]
    unit: Literal["mmHg"]


# LLM 문자열을 JSONB 경로로 직접 사용하지 않는다. 신규 camelCase와 서버 전환 전
# 레거시 snake_case를 모두 읽되, 이 매핑에 없는 조합은 쿼리로 내려가지 않는다.
_ALLOWED_METRICS: dict[tuple[str, str], _MetricSpec] = {
    ("blood_pressure", "systolic"): _MetricSpec(
        payload_keys=("systolicMmHg", "systolic"),
        unit="mmHg",
    ),
}


def _subtract_calendar_months(value: datetime, months: int) -> datetime:
    month_index = value.year * 12 + value.month - 1 - months
    target_year, target_month_zero_based = divmod(month_index, 12)
    target_month = target_month_zero_based + 1
    target_day = min(value.day, calendar.monthrange(target_year, target_month)[1])
    return value.replace(year=target_year, month=target_month, day=target_day)


def _display_number(value: float) -> str:
    return str(int(value)) if value.is_integer() else f"{value:g}"


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

    async def query_numeric_summary(
        self,
        account: ServiceAccount,
        profile_id: uuid.UUID,
        query: HealthRecordQueryArguments,
        *,
        now: datetime | None = None,
    ) -> HealthRecordQueryResult:
        """인증된 프로필 범위에서 수치형 장기 기록을 서버가 집계한다."""

        await self._verify_profile_access(profile_id, account)
        metric_spec = _ALLOWED_METRICS.get((query.record_type, query.metric))
        if metric_spec is None:
            raise ValueError("지원하지 않는 건강기록 지표입니다.")

        current = now or datetime.now(_SEOUL)
        if current.tzinfo is None:
            raise ValueError("집계 기준 시각에는 시간대가 필요합니다.")
        current_seoul = current.astimezone(_SEOUL)
        start_seoul = _subtract_calendar_months(current_seoul, query.period.value)
        aggregate = await self.record_repo.aggregate_numeric_metric(
            profile_id=profile_id,
            record_type=query.record_type,
            payload_keys=metric_spec.payload_keys,
            operator=query.operator,
            threshold=query.threshold,
            recorded_from=start_seoul.astimezone(timezone.utc),
            recorded_to=current_seoul.astimezone(timezone.utc),
            timezone_name=str(_SEOUL),
            latest_limit=5,
        )

        latest_matches = [
            HealthRecordQueryMatch(
                date=(recorded_at if recorded_at.tzinfo else recorded_at.replace(tzinfo=timezone.utc))
                .astimezone(_SEOUL)
                .date(),
                value=value,
            )
            for recorded_at, value in aggregate.latest_matches
        ]
        threshold_text = _display_number(query.threshold)
        period_text = f"지난 {query.period.value}개월"
        condition_text = f"{threshold_text}mmHg를 초과한" if query.operator == "gt" else f"{threshold_text}mmHg 이상인"

        empty_reason: Literal["no_records", "no_matches"] | None = None
        if aggregate.total_measurements == 0:
            empty_reason = "no_records"
            message = f"{period_text} 동안 등록된 수축기 혈압 기록이 없습니다."
        elif aggregate.matched_measurements == 0:
            empty_reason = "no_matches"
            message = (
                f"{period_text} 동안 수축기 혈압이 {condition_text} 날은 없습니다. "
                f"같은 기간 유효한 측정은 총 {aggregate.total_measurements}회입니다."
            )
        else:
            message = (
                f"{period_text} 동안 수축기 혈압이 {condition_text} 날은 "
                f"총 {aggregate.matched_days}일이며, 해당 측정은 {aggregate.matched_measurements}회입니다."
            )
            if latest_matches:
                latest = latest_matches[0]
                message += (
                    f" 가장 최근에는 {latest.date.month}월 {latest.date.day}일에 "
                    f"{_display_number(latest.value)}mmHg가 기록되었습니다."
                )
            message += " 높은 혈압이 반복되면 이 기록을 의료진과 공유해 보세요."

        return HealthRecordQueryResult(
            record_type=query.record_type,
            metric=query.metric,
            unit=metric_spec.unit,
            operator=query.operator,
            threshold=query.threshold,
            period=HealthRecordQueryPeriod(
                date_from=start_seoul.date(),
                date_to=current_seoul.date(),
            ),
            matched_days=aggregate.matched_days,
            matched_measurements=aggregate.matched_measurements,
            total_measurements=aggregate.total_measurements,
            latest_matches=latest_matches,
            empty_reason=empty_reason,
            message=message,
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
                status=r.status,
                row_version=r.row_version,
            )
            saved = await self.record_repo.upsert(model)
            results.append(HealthRecordData.model_validate(saved))
        await self.session.commit()
        return HealthRecordListData(items=results, total=len(results))
