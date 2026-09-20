from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from app.dtos.health_record_query import (
    HealthRecordQueryArguments,
    HealthRecordQueryMatch,
    HealthRecordQueryPeriod,
    HealthRecordQueryResult,
    RelativePeriod,
)
from app.services.agent_tools.project import (
    TOOL_DISABLED,
    TOOL_NOT_MODEL_SELECTABLE,
    TOOL_NOT_REGISTERED,
    ToolPolicyError,
    project_for_model,
    require_model_selectable,
)
from app.services.agent_tools.registry import (
    QUERY_HEALTH_RECORDS_FORBIDDEN_RESULT_FIELDS,
    QUERY_HEALTH_RECORDS_RESULT_FIELDS,
    TOOL_SPECS,
    TOOLS_BY_NAME,
    declared_llm_tool_names,
    is_model_selectable,
    model_selectable_names,
    project_health_record_query_result,
)
from app.services.food_nutrition_tools import get_food_nutrition_tools
from app.services.health_record_tools import get_health_record_tools
from app.services.medical_facility_tools import get_facility_tools
from app.services.medication_tools import get_medication_tools

_DOCS = Path(__file__).resolve().parents[3] / "docs" / "55_tool_registry.md"
_INVENTED = frozenset(
    {
        "search_hospital",
        "search_ocr",
        "ocr_extract",
        "rapidocr",
        "recognize_document",
        "create_health_record",
    }
)


def _offered_declaration_names() -> set[str]:
    names: set[str] = set()
    for group in (
        get_health_record_tools(),
        get_facility_tools(),
        get_medication_tools(),
        get_food_nutrition_tools(),
    ):
        for tool in group:
            for declaration in tool.function_declarations or []:
                names.add(str(declaration.name))
    return names


def test_registry_matches_function_declarations() -> None:
    declared = declared_llm_tool_names()
    registered_declared = {spec.name for spec in TOOL_SPECS if spec.exposure != "not_agent_callable"}
    assert declared == registered_declared
    assert "document_vision" in TOOLS_BY_NAME
    assert declared == {spec.name for spec in TOOL_SPECS} - {"document_vision"}


def test_docs_list_matches_registry() -> None:
    body = _DOCS.read_text(encoding="utf-8")
    for spec in TOOL_SPECS:
        assert f"`{spec.name}`" in body
        assert spec.access in body
        assert spec.risk in body


def test_model_offered_tools_are_registry_selectable() -> None:
    offered = _offered_declaration_names()
    assert offered == model_selectable_names()
    assert not offered & _INVENTED
    assert "document_vision" not in offered
    assert "search_health_knowledge" not in offered
    assert "get_outdoor_health_conditions" not in offered


def test_invented_tools_are_not_registered() -> None:
    assert _INVENTED.isdisjoint(TOOLS_BY_NAME)
    assert not is_model_selectable("document_vision")
    assert not is_model_selectable("search_health_knowledge")
    vision = TOOLS_BY_NAME["document_vision"]
    assert vision.enabled is False
    assert vision.exposure == "not_agent_callable"
    assert vision.access == "read"
    assert vision.risk == "high"


def test_every_spec_has_limits_and_access() -> None:
    for spec in TOOL_SPECS:
        assert spec.access in {"read", "write"}
        assert spec.risk in {"low", "medium", "high"}
        assert spec.limits.max_calls_per_turn >= 1
        assert spec.limits.timeout_ms >= 1
        assert spec.limits.cost_class in {"low", "medium", "high"}


def test_health_record_query_contract_omits_identity_and_document() -> None:
    query = HealthRecordQueryArguments(
        record_type="blood_pressure",
        period=RelativePeriod(type="relative_months", value=3),
        metric="systolic",
        operator="gte",
        threshold=140,
        aggregation="count_days",
    )
    assert query.record_type == "blood_pressure"
    assert "account_id" not in HealthRecordQueryArguments.model_fields
    assert "profile_id" not in HealthRecordQueryArguments.model_fields
    result = HealthRecordQueryResult(
        record_type="blood_pressure",
        metric="systolic",
        operator="gte",
        threshold=140,
        period=HealthRecordQueryPeriod(date_from=date(2026, 6, 20), date_to=date(2026, 9, 20)),
        matched_days=2,
        matched_measurements=2,
        total_measurements=10,
        latest_matches=[HealthRecordQueryMatch(date=date(2026, 9, 1), value=142)],
        empty_reason=None,
        message="최근 3개월 수축기 혈압 140 이상인 날이 2일입니다.",
    )
    projected = project_health_record_query_result(result)
    keys = set(projected.model_dump())
    assert keys == QUERY_HEALTH_RECORDS_RESULT_FIELDS
    assert keys.isdisjoint(QUERY_HEALTH_RECORDS_FORBIDDEN_RESULT_FIELDS)
    assert "name" not in keys
    assert "tables" not in keys
    assert "text" not in keys
    assert TOOLS_BY_NAME["query_health_records"].input_fields.isdisjoint({"account_id", "profile_id"})


def test_enabled_tools_declare_result_fields() -> None:
    for spec in TOOL_SPECS:
        if spec.enabled:
            assert spec.result_fields, spec.name


def test_blocked_tools_have_distinct_reason_codes() -> None:
    with pytest.raises(ToolPolicyError) as unknown:
        require_model_selectable("search_hospital")
    assert unknown.value.reason == TOOL_NOT_REGISTERED
    with pytest.raises(ToolPolicyError) as prefetch:
        require_model_selectable("search_health_knowledge")
    assert prefetch.value.reason == TOOL_NOT_MODEL_SELECTABLE
    with pytest.raises(ToolPolicyError) as vision:
        require_model_selectable("document_vision")
    assert vision.value.reason == TOOL_DISABLED
    assert vision.value.model_payload()["message"] == "요청한 기능을 지금은 사용할 수 없습니다."


def _walk_keys(value: object) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        found.update(value)
        for item in value.values():
            found.update(_walk_keys(item))
    elif isinstance(value, list):
        for item in value:
            found.update(_walk_keys(item))
    return found


def test_facility_model_view_omits_coordinates_and_phone() -> None:
    from app.dtos.medical_facility import FacilityItem, FacilitySearchResult

    result = FacilitySearchResult(
        facility_type="hospital",
        total_count=1,
        items=[
            FacilityItem(
                name="서울병원",
                address="서울시 강남구 어딘가 1",
                phone="02-123-4567",
                distance_m=120,
                latitude=37.5,
                longitude=127.0,
                is_open=True,
            )
        ],
        message="근처 병원을 찾았습니다.",
    )
    projected = project_for_model("search_nearby_hospital", result)
    spec = TOOLS_BY_NAME["search_nearby_hospital"]
    assert set(projected) == spec.result_fields
    assert set(projected["items"][0]) == spec.item_fields
    assert projected["items"][0]["phone_available"] is True
    assert projected["items"][0]["open_now"] is True
    keys = _walk_keys(projected)
    assert keys.isdisjoint(spec.forbidden_result_fields)


def test_outdoor_model_view_omits_user_coordinates() -> None:
    from app.dtos.outdoor_conditions import AirQualityConditions, OutdoorConditionsResult, WeatherConditions

    result = OutdoorConditionsResult(
        latitude=37.5665,
        longitude=126.9780,
        weather=WeatherConditions(temperature_c=24.0, precipitation_type="없음"),
        air_quality=AirQualityConditions(region_name="서울", pm10_grade="보통"),
    )
    projected = project_for_model("get_outdoor_health_conditions", result)
    assert set(projected) == TOOLS_BY_NAME["get_outdoor_health_conditions"].result_fields
    assert "latitude" not in projected
    assert "longitude" not in projected


def test_medication_and_food_model_views_use_named_fields() -> None:
    from app.dtos.food_nutrition import FoodNutritionItem, FoodNutritionSearchResult
    from app.dtos.medication import DrugInfo, MedicationSearchResult

    med = MedicationSearchResult(
        query="타이레놀",
        items=[DrugInfo(item_name="타이레놀정", class_name="해열·진통·소염제", atpn_qesitm="과량 주의")],
        message="식약처 정보를 확인했습니다.",
    )
    food = FoodNutritionSearchResult(
        query="김치찌개",
        items=[FoodNutritionItem(food_name="김치찌개", serving_size="1인분", calories_kcal=320, sodium_mg=800)],
        message="영양 정보를 확인했습니다.",
    )
    med_view = project_for_model("search_medication_info", med)
    food_view = project_for_model("search_food_nutrition", food)
    assert med_view["items"][0]["product_name"] == "타이레놀정"
    assert med_view["items"][0]["source"] == "mfds"
    assert food_view["items"][0]["calories"] == 320
    assert "나트륨" in food_view["items"][0]["nutrient_summary"]
