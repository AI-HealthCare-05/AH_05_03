import calendar
import contextlib
import json
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import Depends
from redis.asyncio import Redis

from app.core import config
from app.core.db.session import SessionDep
from app.core.redis.client import get_redis_optional
from app.dtos.anatomy_event import AnatomyEvent
from app.dtos.health_record_query import (
    ConsultationActivity,
    ConsultationBloodPressure,
    ConsultationLabValue,
    ConsultationMedication,
    HealthRecordQueryArguments,
    HealthRecordQueryMatch,
    HealthRecordQueryPeriod,
    HealthRecordQueryResult,
    PersonalHealthSnapshot,
)
from app.dtos.health_records import (
    HealthRecordCreateRequest,
    HealthRecordData,
    HealthRecordListData,
    HealthRecordPrefillData,
    HealthRecordSyncRequest,
    HealthRecordUpdateRequest,
    HealthRecordValuesData,
    PrefilledFieldData,
)
from app.exceptions import (
    HealthRecordNotFoundError,
    HealthRecordPayloadValidationError,
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
from app.services import record_prefill
from app.services.ocr_measurements import extract as extract_ocr_measurements

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
        redis: Annotated[Redis | None, Depends(get_redis_optional)] = None,
    ) -> None:
        self.session = session
        self.record_repo = record_repo
        self.profile_repo = profile_repo
        self.household_repo = household_repo
        self.redis = redis

    async def _publish_household_event(
        self,
        household_id: uuid.UUID,
        event_name: str,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if self.redis is None:
            return
        channel = f"{config.REDIS_KEY_PREFIX}:household:{household_id}:events"
        payload = {
            "event": event_name,
            "household_id": str(household_id),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **(extra or {}),
        }
        with contextlib.suppress(Exception):
            await self.redis.publish(channel, json.dumps(payload))

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

    @staticmethod
    def _validate_record_payload(payload: dict[str, object] | None) -> None:
        """기록 페이로드에 3D 해부학 이벤트가 포함된 경우 표준 계약을 강제한다."""
        if not payload:
            return
        anatomy_event = payload.get("anatomyEvent")
        if anatomy_event is not None:
            if not isinstance(anatomy_event, dict):
                raise HealthRecordPayloadValidationError("anatomyEvent 페이로드는 객체(dict)여야 합니다.")
            try:
                AnatomyEvent.model_validate(anatomy_event)
            except Exception as e:
                raise HealthRecordPayloadValidationError(f"유효하지 않은 3D 해부학 이벤트 규격입니다: {e}") from e

    async def create_record(self, account: ServiceAccount, req: HealthRecordCreateRequest) -> HealthRecordData:
        household_id = await self._verify_profile_access(req.profile_id, account)
        self._validate_record_payload(req.payload)

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
        await self._publish_household_event(
            household_id,
            "record_saved",
            {"profile_id": str(req.profile_id), "record_id": str(created.id)},
        )
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

    async def build_prefill(
        self,
        account: ServiceAccount,
        profile_id: uuid.UUID,
        limit: int = 200,
    ) -> HealthRecordPrefillData:
        """남긴 기록으로 판정 폼 값을 만든다. 판단은 `record_prefill` 한 곳에 있다.

        `limit` 을 넉넉히 두는 이유는 **칸마다 가장 최근 것**을 골라야 하기 때문이다.
        스무 개만 읽으면 최근 스무 개가 전부 혈압일 때 체중이 영영 안 잡힌다.
        기록은 프로필 단위이고 소유권 검사는 아래 한 줄이 한다.
        """
        await self._verify_profile_access(profile_id, account)

        records = await self.record_repo.list_by_profile(profile_id=profile_id, limit=limit, offset=0)
        rows = [
            {
                "id": str(record.id),
                "record_type": record.record_type,
                "recorded_at": record.recorded_at.isoformat(),
                "payload": record.payload,
            }
            for record in records
        ]
        values = record_prefill.build(rows)
        return HealthRecordPrefillData(
            items=[
                PrefilledFieldData(
                    field=item.field,
                    value=item.value,
                    measured_at=item.measured_at,
                    record_type=item.record_type,
                    record_id=item.record_id,
                )
                for item in values
            ],
            scanned=len(rows),
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

    async def get_personal_health_snapshot(
        self,
        account: ServiceAccount,
        profile_id: uuid.UUID,
        *,
        now: datetime | None = None,
    ) -> PersonalHealthSnapshot:
        """음주 상담에 필요한 최근 사실만 인증된 프로필 범위에서 조회한다."""

        await self._verify_profile_access(profile_id, account)
        current = now or datetime.now(_SEOUL)
        if current.tzinfo is None:
            raise ValueError("상담 기준 시각에는 시간대가 필요합니다.")
        current_seoul = current.astimezone(_SEOUL)

        by_type: dict[str, list[HealthRecord]] = {}
        for record_type in (
            "blood_pressure",
            "lab_result",
            "health_screening",
            "exercise",
            "walking",
            "medication",
            "alcohol",
            "drinking",
        ):
            by_type[record_type] = await self.record_repo.list_by_profile(
                profile_id=profile_id,
                record_type=record_type,
                limit=20,
            )

        blood_pressure = self._latest_blood_pressure(by_type["blood_pressure"])
        liver_tests = self._latest_liver_tests(by_type["lab_result"] + by_type["health_screening"])
        today_activities = self._today_activities(by_type["exercise"] + by_type["walking"], current_seoul.date())
        recent_cutoff = current_seoul - timedelta(days=30)
        recent_medications = self._recent_medications(by_type["medication"], recent_cutoff)
        alcohol_cutoff = current_seoul - timedelta(days=90)
        recent_alcohol_records = sum(
            1
            for record in by_type["alcohol"] + by_type["drinking"]
            if self._as_seoul(record.recorded_at) >= alcohol_cutoff
        )

        missing_sections: list[str] = []
        if blood_pressure is None:
            missing_sections.append("blood_pressure")
        if not liver_tests:
            missing_sections.append("liver_tests")
        if not recent_medications:
            missing_sections.append("recent_medications")

        facts = []
        if blood_pressure:
            facts.append("최근 혈압")
        if liver_tests:
            facts.append("최근 간기능 검사")
        if today_activities:
            facts.append("오늘 운동")
        if recent_medications:
            facts.append("최근 복약")
        message = (
            f"현재 프로필에서 {', '.join(facts)} 기록을 확인했습니다."
            if facts
            else "현재 프로필에서 음주 상담에 활용할 최근 기록을 찾지 못했습니다."
        )
        return PersonalHealthSnapshot(
            blood_pressure=blood_pressure,
            liver_tests=liver_tests,
            today_activities=today_activities,
            recent_medications=recent_medications,
            recent_alcohol_records=recent_alcohol_records,
            missing_sections=missing_sections,
            message=message,
        )

    @staticmethod
    def _as_seoul(value: datetime) -> datetime:
        aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return aware.astimezone(_SEOUL)

    @staticmethod
    def _number(value: object) -> float | None:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return float(value)

    @classmethod
    def _latest_blood_pressure(cls, records: list[HealthRecord]) -> ConsultationBloodPressure | None:
        for record in sorted(records, key=lambda item: item.recorded_at, reverse=True):
            systolic = cls._number(record.payload.get("systolicMmHg"))
            if systolic is None:
                systolic = cls._number(record.payload.get("systolic"))
            if systolic is None:
                continue
            diastolic = cls._number(record.payload.get("diastolicMmHg"))
            if diastolic is None:
                diastolic = cls._number(record.payload.get("diastolic"))
            return ConsultationBloodPressure(
                systolic=systolic,
                diastolic=diastolic,
                measured_at=record.recorded_at,
            )
        return None

    @classmethod
    def _latest_liver_tests(  # noqa: C901 - 기록 형태별 안전 파싱 관문
        cls, records: list[HealthRecord]
    ) -> list[ConsultationLabValue]:
        found: dict[str, ConsultationLabValue] = {}
        for record in sorted(records, key=lambda item: item.recorded_at, reverse=True):
            payload = record.payload
            rows: list[list[str]] = []
            if record.record_type == "lab_result":
                rows.append(
                    [
                        str(payload.get("testName") or ""),
                        str(payload.get("value") or ""),
                        str(payload.get("unit") or ""),
                        "",
                    ]
                )
            raw_items = payload.get("items")
            items = raw_items if isinstance(raw_items, list) else []
            for item in items:
                if not isinstance(item, dict):
                    continue
                rows.append(
                    [
                        str(item.get("testName") or ""),
                        str(item.get("value") or ""),
                        str(item.get("unit") or ""),
                        str(item.get("judgment") or ""),
                    ]
                )
            if not rows:
                continue
            values = extract_ocr_measurements([{"rows": rows}]).values
            for metric in ("ast", "alt", "ggt"):
                if metric in values and metric not in found:
                    found[metric] = ConsultationLabValue(
                        metric=metric,
                        value=values[metric],
                        unit="U/L" if metric in {"ast", "alt"} else "IU/L",
                        measured_at=record.recorded_at,
                    )
            if len(found) == 3:
                break
        return [found[metric] for metric in ("ast", "alt", "ggt") if metric in found]

    @classmethod
    def _today_activities(cls, records: list[HealthRecord], today: date) -> list[ConsultationActivity]:
        activities: list[ConsultationActivity] = []
        for record in sorted(records, key=lambda item: item.recorded_at, reverse=True):
            if cls._as_seoul(record.recorded_at).date() != today:
                continue
            payload = record.payload
            name = str(payload.get("exerciseName") or payload.get("sourceName") or "걷기").strip()
            activities.append(
                ConsultationActivity(
                    activity=name,
                    recorded_at=record.recorded_at,
                    duration_minutes=cls._number(payload.get("durationMinutes")),
                    weight_kg=cls._number(payload.get("weightKg")),
                    reps=int(reps) if (reps := cls._number(payload.get("reps"))) is not None else None,
                    sets=int(sets) if (sets := cls._number(payload.get("sets"))) is not None else None,
                )
            )
        return activities[:5]

    @classmethod
    def _recent_medications(cls, records: list[HealthRecord], cutoff: datetime) -> list[ConsultationMedication]:
        medications: list[ConsultationMedication] = []
        for record in sorted(records, key=lambda item: item.recorded_at, reverse=True):
            if cls._as_seoul(record.recorded_at) < cutoff:
                continue
            name = str(record.payload.get("medicationName") or "").strip()
            if not name:
                continue
            dosage = str(record.payload.get("dosage") or "").strip() or None
            medications.append(ConsultationMedication(name=name, dosage=dosage, recorded_at=record.recorded_at))
        return medications[:5]

    async def get_record(self, account: ServiceAccount, record_id: uuid.UUID) -> HealthRecordData:
        record = await self.record_repo.get(record_id)
        if record is None or record.status == "deleted":
            raise HealthRecordNotFoundError()
        await self._verify_profile_access(record.profile_id, account)
        return HealthRecordData.model_validate(record)

    async def record_values(self, account: ServiceAccount, record_id: uuid.UUID) -> HealthRecordValuesData:
        """기록 하나의 판정 칸 값. 판단은 `record_prefill` 한 곳에 있다.

        검진표를 열어 수치를 고치는 화면이 쓴다. 그 화면은 **그 기록에 담긴 것만**
        봐야 하므로 `build_prefill`(칸마다 가장 최근 것)을 쓸 수 없다 — 같은 칸을
        더 새 기록이 들고 있으면 이 기록의 값이 가려진다.
        """
        record = await self.record_repo.get(record_id)
        if record is None or record.status == "deleted":
            raise HealthRecordNotFoundError()
        await self._verify_profile_access(record.profile_id, account)

        payload = record.payload if isinstance(record.payload, dict) else {}
        return HealthRecordValuesData(
            record_id=record.id,
            record_type=record.record_type,
            values=record_prefill.fields_for(record.record_type, payload),
        )

    async def update_record(
        self, account: ServiceAccount, record_id: uuid.UUID, req: HealthRecordUpdateRequest
    ) -> HealthRecordData:
        record = await self.record_repo.get(record_id)
        if record is None or record.status == "deleted":
            raise HealthRecordNotFoundError()
        household_id = await self._verify_profile_access(record.profile_id, account)

        if req.record_type is not None:
            record.record_type = req.record_type
        if req.recorded_at is not None:
            record.recorded_at = req.recorded_at
        if req.source is not None:
            record.source = req.source
        if req.payload is not None:
            self._validate_record_payload(req.payload)
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
        await self._publish_household_event(
            household_id,
            "record_saved",
            {"profile_id": str(record.profile_id), "record_id": str(record.id)},
        )
        return HealthRecordData.model_validate(record)

    async def delete_record(self, account: ServiceAccount, record_id: uuid.UUID) -> None:
        record = await self.record_repo.get(record_id)
        if record is None or record.status == "deleted":
            raise HealthRecordNotFoundError()
        household_id = await self._verify_profile_access(record.profile_id, account)

        await self.record_repo.soft_delete(record)
        record.row_version += 1
        await self.session.commit()
        await self._publish_household_event(
            household_id,
            "record_deleted",
            {"profile_id": str(record.profile_id), "record_id": str(record.id)},
        )

    async def sync_records(self, account: ServiceAccount, req: HealthRecordSyncRequest) -> HealthRecordListData:
        results: list[HealthRecordData] = []
        affected_households: set[uuid.UUID] = set()
        for r in req.records:
            household_id = await self._verify_profile_access(r.profile_id, account)
            affected_households.add(household_id)
            self._validate_record_payload(r.payload)
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
        for hid in affected_households:
            await self._publish_household_event(hid, "record_saved")
        return HealthRecordListData(items=results, total=len(results))
