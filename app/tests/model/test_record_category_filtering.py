"""기록 범주 필터링 단위 테스트 — DB 불필요."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from app.dtos.health_assistant import HealthAssistantScopeDecision
from app.services.health_records import CATEGORY_TO_RECORD_TYPES, HealthRecordService

# ────────────────────────────────────────────────────────────────
# helpers
# ────────────────────────────────────────────────────────────────


def _make_health_record_service() -> HealthRecordService:
    """DB 없이 record_repo만 모킹한 HealthRecordService 인스턴스."""
    svc = HealthRecordService.__new__(HealthRecordService)
    svc.record_repo = MagicMock()
    svc.record_repo.list_by_profile = AsyncMock(return_value=[])
    return svc


def _queried_types(svc: HealthRecordService) -> set[str]:
    return {
        t
        for c in svc.record_repo.list_by_profile.call_args_list  # type: ignore[attr-defined]
        if (t := c.kwargs.get("record_type")) is not None
    }


# ────────────────────────────────────────────────────────────────
# get_personal_health_snapshot — repository call 검증
# ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_lab_result_queries_lab_health_screening_and_blood_glucose() -> None:
    """lab_result 범주 요청 시 lab_result·health_screening·blood_glucose 모두 조회된다."""
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        await svc.get_personal_health_snapshot(MagicMock(), uuid.uuid4(), categories=["lab_result"])

    assert _queried_types(svc) == {"lab_result", "health_screening", "blood_glucose"}


@pytest.mark.asyncio
async def test_blood_pressure_queries_only_blood_pressure() -> None:
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        await svc.get_personal_health_snapshot(MagicMock(), uuid.uuid4(), categories=["blood_pressure"])

    assert _queried_types(svc) == {"blood_pressure"}


@pytest.mark.asyncio
async def test_medication_queries_only_medication() -> None:
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        await svc.get_personal_health_snapshot(MagicMock(), uuid.uuid4(), categories=["medication"])

    assert _queried_types(svc) == {"medication"}


@pytest.mark.asyncio
async def test_empty_categories_makes_no_db_queries() -> None:
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        result = await svc.get_personal_health_snapshot(MagicMock(), uuid.uuid4(), categories=[])

    svc.record_repo.list_by_profile.assert_not_called()  # type: ignore[attr-defined]
    assert result.blood_pressure is None
    assert result.recent_alcohol_records is None
    assert result.liver_tests == []
    assert result.recent_medications == []
    assert result.today_activities == []


@pytest.mark.asyncio
async def test_lab_result_does_not_query_unrequested_types() -> None:
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        await svc.get_personal_health_snapshot(MagicMock(), uuid.uuid4(), categories=["lab_result"])

    queried = _queried_types(svc)
    for unexpected in ("blood_pressure", "medication", "alcohol", "drinking", "exercise", "walking"):
        assert unexpected not in queried, f"{unexpected} should not have been queried"


@pytest.mark.asyncio
async def test_medication_snapshot_has_no_blood_pressure_or_alcohol_data() -> None:
    """medication 범주만 요청하면 blood_pressure·alcohol 데이터가 스냅샷에 없다."""
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        result = await svc.get_personal_health_snapshot(MagicMock(), uuid.uuid4(), categories=["medication"])

    assert result.blood_pressure is None
    assert result.recent_alcohol_records is None
    assert result.liver_tests == []
    # medication fields not queried → empty list (nothing in DB mock)
    assert result.recent_medications == []

    # JSON sent to LLM should not carry alcohol or blood_pressure keys with data
    json_out = result.model_dump_json(exclude_none=True)
    assert '"recent_alcohol_records"' not in json_out


# ────────────────────────────────────────────────────────────────
# load_personal_health_evidence — 통합 prefill+snapshot 검증
# ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_load_evidence_lab_result_queries_correct_types() -> None:
    """lab_result 범주 → lab_result·health_screening·blood_glucose 조회."""
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        prefill, snapshot = await svc.load_personal_health_evidence(
            MagicMock(), uuid.uuid4(), categories=["lab_result"]
        )

    assert _queried_types(svc) == {"lab_result", "health_screening", "blood_glucose"}
    assert prefill is None  # 빈 mock 반환이므로 prefill 없음
    assert snapshot.retrieval_status == "empty"


@pytest.mark.asyncio
async def test_load_evidence_blood_pressure_queries_only_blood_pressure() -> None:
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        _, snapshot = await svc.load_personal_health_evidence(MagicMock(), uuid.uuid4(), categories=["blood_pressure"])

    assert _queried_types(svc) == {"blood_pressure"}
    assert snapshot.retrieval_status == "empty"


@pytest.mark.asyncio
async def test_load_evidence_empty_categories_returns_no_prefill_and_empty_snapshot() -> None:
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        prefill, snapshot = await svc.load_personal_health_evidence(MagicMock(), uuid.uuid4(), categories=[])

    svc.record_repo.list_by_profile.assert_not_called()  # type: ignore[attr-defined]
    assert prefill is None
    assert snapshot.retrieval_status == "empty"
    assert snapshot.blood_pressure is None
    assert snapshot.recent_alcohol_records is None


@pytest.mark.asyncio
async def test_load_evidence_does_not_query_unrequested_types() -> None:
    """lab_result만 요청하면 혈압·복약·운동 타입 조회 없음."""
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        await svc.load_personal_health_evidence(MagicMock(), uuid.uuid4(), categories=["lab_result"])

    queried = _queried_types(svc)
    for unexpected in ("blood_pressure", "medication", "alcohol", "drinking", "exercise", "walking"):
        assert unexpected not in queried, f"{unexpected} should not have been queried"


# ────────────────────────────────────────────────────────────────
# CATEGORY_TO_RECORD_TYPES 계약
# ────────────────────────────────────────────────────────────────


def test_category_mapping_covers_all_expected_categories() -> None:
    assert set(CATEGORY_TO_RECORD_TYPES) == {
        "lab_result",
        "blood_pressure",
        "medication",
        "alcohol",
        "exercise",
        "body_measurement",
    }


def test_lab_result_maps_to_lab_health_screening_and_blood_glucose() -> None:
    assert set(CATEGORY_TO_RECORD_TYPES["lab_result"]) == {"lab_result", "health_screening", "blood_glucose"}


def test_alcohol_maps_to_alcohol_and_drinking() -> None:
    assert set(CATEGORY_TO_RECORD_TYPES["alcohol"]) == {"alcohol", "drinking"}


def test_exercise_maps_to_exercise_and_walking() -> None:
    assert set(CATEGORY_TO_RECORD_TYPES["exercise"]) == {"exercise", "walking"}


def test_body_measurement_maps_to_body_measurement() -> None:
    assert CATEGORY_TO_RECORD_TYPES["body_measurement"] == ["body_measurement"]


# ────────────────────────────────────────────────────────────────
# build_prefill — record_types DB-level 필터 검증
# ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_build_prefill_with_record_types_queries_only_those_types() -> None:
    """build_prefill(record_types=...)는 지정된 record_type만 DB에서 조회한다."""
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        await svc.build_prefill(MagicMock(), uuid.uuid4(), record_types=["lab_result"])
    assert _queried_types(svc) == {"lab_result"}


@pytest.mark.asyncio
async def test_build_prefill_with_multiple_types_queries_each_type() -> None:
    """build_prefill(record_types=[A, B])는 A와 B 각각 한 번씩 조회한다."""
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        await svc.build_prefill(MagicMock(), uuid.uuid4(), record_types=["lab_result", "blood_pressure"])
    assert _queried_types(svc) == {"lab_result", "blood_pressure"}


@pytest.mark.asyncio
async def test_build_prefill_with_record_types_does_not_query_other_types() -> None:
    """lab_result만 요청하면 blood_pressure·medication 등을 조회하지 않는다."""
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        await svc.build_prefill(MagicMock(), uuid.uuid4(), record_types=["lab_result"])
    queried = _queried_types(svc)
    for unexpected in ("blood_pressure", "medication", "alcohol", "drinking", "exercise", "walking"):
        assert unexpected not in queried, f"{unexpected} should not have been queried"


@pytest.mark.asyncio
async def test_build_prefill_scanned_reflects_actual_fetched_count() -> None:
    """record_types 지정 시 scanned는 조회된 행 수를 반영한다 (전체 200이 아님)."""
    svc = _make_health_record_service()
    with patch.object(HealthRecordService, "_verify_profile_access", AsyncMock()):
        result = await svc.build_prefill(MagicMock(), uuid.uuid4(), record_types=["lab_result"])
    # mock returns [] for each type → scanned=0, not 200
    assert result.scanned == 0


# ────────────────────────────────────────────────────────────────
# HealthAssistantScopeDecision validator — required_record_categories 계약
# ────────────────────────────────────────────────────────────────


def test_categories_without_health_records_raises_validation_error() -> None:
    """required_record_categories가 비어있지 않고 required_evidence_types에
    health_records가 없으면 ValidationError가 발생한다."""
    with pytest.raises(ValidationError, match="health_records"):
        HealthAssistantScopeDecision(
            scope="health",
            request_kind="information",
            requires_authoritative_evidence=True,
            required_evidence_types=["health_knowledge"],
            required_record_categories=["lab_result"],
        )


def test_categories_with_health_records_is_valid() -> None:
    """health_records와 required_record_categories가 함께 있으면 정상 생성된다."""
    decision = HealthAssistantScopeDecision(
        scope="health",
        request_kind="personalized_advice",
        requires_authoritative_evidence=True,
        required_evidence_types=["health_records"],
        required_record_categories=["lab_result", "blood_pressure"],
    )
    assert set(decision.required_record_categories) == {"lab_result", "blood_pressure"}


def test_empty_categories_without_health_records_is_valid() -> None:
    """health_records가 필요 없는 질문에서 required_record_categories=[]는 정상이다."""
    decision = HealthAssistantScopeDecision(
        scope="health",
        request_kind="information",
        requires_authoritative_evidence=True,
        required_evidence_types=["health_knowledge"],
        required_record_categories=[],
    )
    assert decision.required_record_categories == []
