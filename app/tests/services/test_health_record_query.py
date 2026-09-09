import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.dtos.health_record_query import HealthRecordQueryArguments
from app.exceptions import HouseholdMembershipRequiredError
from app.models.health_records import HealthRecord
from app.models.households import Household, HouseholdMembership
from app.models.profiles import FamilyProfile
from app.models.service_accounts import ServiceAccount
from app.repositories.health_record_repository import HealthRecordRepository
from app.repositories.household_repository import HouseholdRepository
from app.repositories.profile_repository import ProfileRepository
from app.services.health_records import HealthRecordService

_SEOUL = ZoneInfo("Asia/Seoul")


async def _setup_profile(
    session: AsyncSession,
) -> tuple[ServiceAccount, ServiceAccount, FamilyProfile, HealthRecordService]:
    owner = ServiceAccount(email=f"owner-{uuid.uuid4().hex}@example.com", password_hash="hash")
    outsider = ServiceAccount(email=f"outsider-{uuid.uuid4().hex}@example.com", password_hash="hash")
    session.add_all([owner, outsider])
    await session.flush()

    household = Household(created_by_account_id=owner.id, master_account_id=owner.id)
    session.add(household)
    await session.flush()
    session.add(HouseholdMembership(household_id=household.id, account_id=owner.id))
    profile = FamilyProfile(
        household_id=household.id,
        created_by_account_id=owner.id,
        display_name="본인",
        relationship="self",
    )
    session.add(profile)
    await session.flush()

    record_repo = HealthRecordRepository(session)
    service = HealthRecordService(
        session=session,
        record_repo=record_repo,
        profile_repo=ProfileRepository(session),
        household_repo=HouseholdRepository(session),
    )
    return owner, outsider, profile, service


def _query(operator: str = "gt") -> HealthRecordQueryArguments:
    return HealthRecordQueryArguments.model_validate(
        {
            "record_type": "blood_pressure",
            "period": {"type": "relative_months", "value": 3},
            "metric": "systolic",
            "operator": operator,
            "threshold": 140,
            "aggregation": "count_days",
        }
    )


@pytest.mark.asyncio
async def test_postgresql_counts_days_and_measurements_in_seoul_timezone(db_session: AsyncSession) -> None:
    owner, _, profile, service = await _setup_profile(db_session)
    records = [
        # 아래 두 기록은 UTC 날짜가 다르지만 한국 날짜로는 모두 9월 1일이다.
        HealthRecord(
            profile_id=profile.id,
            record_type="blood_pressure",
            recorded_at=datetime(2026, 8, 31, 15, 30, tzinfo=timezone.utc),
            payload={"type": "blood_pressure", "systolicMmHg": 141, "diastolicMmHg": 80},
        ),
        HealthRecord(
            profile_id=profile.id,
            record_type="blood_pressure",
            recorded_at=datetime(2026, 9, 1, 14, 30, tzinfo=timezone.utc),
            payload={"systolic": 150, "diastolic": 90},
        ),
        HealthRecord(
            profile_id=profile.id,
            record_type="blood_pressure",
            recorded_at=datetime(2026, 9, 1, 15, 30, tzinfo=timezone.utc),
            payload={"type": "blood_pressure", "systolicMmHg": 140, "diastolicMmHg": 85},
        ),
        HealthRecord(
            profile_id=profile.id,
            record_type="blood_pressure",
            recorded_at=datetime(2026, 9, 3, 3, 0, tzinfo=timezone.utc),
            payload={"type": "blood_pressure", "systolicMmHg": 139, "diastolicMmHg": 82},
        ),
        HealthRecord(
            profile_id=profile.id,
            record_type="blood_pressure",
            recorded_at=datetime(2026, 9, 4, 3, 0, tzinfo=timezone.utc),
            payload={"type": "blood_pressure", "systolicMmHg": 180, "diastolicMmHg": 100},
            status="deleted",
        ),
        HealthRecord(
            profile_id=profile.id,
            record_type="blood_pressure",
            recorded_at=datetime(2026, 9, 5, 3, 0, tzinfo=timezone.utc),
            payload={"type": "blood_pressure", "systolicMmHg": "190", "diastolicMmHg": 100},
        ),
        HealthRecord(
            profile_id=profile.id,
            record_type="blood_pressure",
            recorded_at=datetime(2026, 6, 7, 3, 0, tzinfo=timezone.utc),
            payload={"type": "blood_pressure", "systolicMmHg": 200, "diastolicMmHg": 110},
        ),
    ]
    db_session.add_all(records)
    await db_session.flush()

    now = datetime(2026, 9, 8, 12, 0, tzinfo=_SEOUL)
    exceeded = await service.query_numeric_summary(owner, profile.id, _query("gt"), now=now)
    inclusive = await service.query_numeric_summary(owner, profile.id, _query("gte"), now=now)

    assert exceeded.period.date_from.isoformat() == "2026-06-08"
    assert exceeded.period.date_to.isoformat() == "2026-09-08"
    assert exceeded.total_measurements == 4
    assert exceeded.matched_measurements == 2
    assert exceeded.matched_days == 1
    assert exceeded.latest_matches[0].date.isoformat() == "2026-09-01"
    assert exceeded.latest_matches[0].value == 150
    assert inclusive.matched_measurements == 3
    assert inclusive.matched_days == 2


@pytest.mark.asyncio
async def test_query_distinguishes_no_records_from_no_matches(db_session: AsyncSession) -> None:
    owner, _, profile, service = await _setup_profile(db_session)
    now = datetime(2026, 9, 8, 12, 0, tzinfo=_SEOUL)

    no_records = await service.query_numeric_summary(owner, profile.id, _query(), now=now)
    assert no_records.empty_reason == "no_records"
    assert no_records.total_measurements == 0

    db_session.add(
        HealthRecord(
            profile_id=profile.id,
            record_type="blood_pressure",
            recorded_at=datetime(2026, 9, 1, 3, 0, tzinfo=timezone.utc),
            payload={"type": "blood_pressure", "systolicMmHg": 120, "diastolicMmHg": 80},
        )
    )
    await db_session.flush()
    no_matches = await service.query_numeric_summary(owner, profile.id, _query(), now=now)
    assert no_matches.empty_reason == "no_matches"
    assert no_matches.total_measurements == 1
    assert no_matches.matched_measurements == 0


@pytest.mark.asyncio
async def test_query_limits_latest_details_to_five(db_session: AsyncSession) -> None:
    owner, _, profile, service = await _setup_profile(db_session)
    db_session.add_all(
        [
            HealthRecord(
                profile_id=profile.id,
                record_type="blood_pressure",
                recorded_at=datetime(2026, 9, day, 3, 0, tzinfo=timezone.utc),
                payload={"type": "blood_pressure", "systolicMmHg": 140 + day, "diastolicMmHg": 80},
            )
            for day in range(1, 8)
        ]
    )
    await db_session.flush()

    result = await service.query_numeric_summary(
        owner,
        profile.id,
        _query(),
        now=datetime(2026, 9, 8, 12, 0, tzinfo=_SEOUL),
    )

    assert result.matched_measurements == 7
    assert result.matched_days == 7
    assert len(result.latest_matches) == 5
    assert result.latest_matches[0].date.isoformat() == "2026-09-07"


@pytest.mark.asyncio
async def test_query_rejects_profile_outside_authenticated_household(db_session: AsyncSession) -> None:
    _, outsider, profile, service = await _setup_profile(db_session)

    with pytest.raises(HouseholdMembershipRequiredError):
        await service.query_numeric_summary(
            outsider,
            profile.id,
            _query(),
            now=datetime(2026, 9, 8, 12, 0, tzinfo=_SEOUL),
        )
