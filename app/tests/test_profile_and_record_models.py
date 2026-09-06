import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.family_histories import FamilyHistory
from app.models.health_records import HealthRecord
from app.models.households import Household
from app.models.profiles import FamilyProfile
from app.models.service_accounts import ServiceAccount


@pytest.mark.asyncio
async def test_family_profile_and_health_records_crud(db_session: AsyncSession) -> None:
    # 1. 계정 및 가구 생성
    account = ServiceAccount(
        email=f"user_{uuid.uuid4().hex[:8]}@example.com",
        password_hash="dummy_hash",
    )
    db_session.add(account)
    await db_session.flush()

    household = Household(created_by_account_id=account.id, master_account_id=account.id)
    db_session.add(household)
    await db_session.flush()

    # 2. 가족 프로필 생성
    profile = FamilyProfile(
        household_id=household.id,
        created_by_account_id=account.id,
        display_name="홍길동",
        relationship="본인",
        gender="male",
        birth_date="1985-05-12",
    )
    db_session.add(profile)
    await db_session.flush()

    assert profile.id is not None
    assert profile.status == "active"
    assert profile.row_version == 1

    # 3. 건강기록 추가 (JSONB payload)
    record = HealthRecord(
        profile_id=profile.id,
        record_type="blood_pressure",
        recorded_at=datetime.now(timezone.utc),
        source="manual",
        payload={"systolic": 120, "diastolic": 80, "pulse": 72},
        note="아침 기상 후 측정",
    )
    db_session.add(record)

    # 4. 가족력 추가
    history = FamilyHistory(
        profile_id=profile.id,
        relative_relationship="부",
        condition_name="고혈압",
        onset_age=50,
    )
    db_session.add(history)
    await db_session.flush()

    # 5. 관계 조회 검증
    stmt = select(FamilyProfile).where(FamilyProfile.id == profile.id)
    result = await db_session.execute(stmt)
    fetched_profile = result.scalar_one()

    assert fetched_profile.display_name == "홍길동"
    assert fetched_profile.gender == "male"
    assert fetched_profile.birth_date == "1985-05-12"

    record_stmt = select(HealthRecord).where(HealthRecord.profile_id == profile.id)
    records = (await db_session.execute(record_stmt)).scalars().all()
    assert len(records) == 1
    assert records[0].payload["systolic"] == 120

    history_stmt = select(FamilyHistory).where(FamilyHistory.profile_id == profile.id)
    histories = (await db_session.execute(history_stmt)).scalars().all()
    assert len(histories) == 1
    assert histories[0].condition_name == "고혈압"
