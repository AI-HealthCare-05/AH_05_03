from __future__ import annotations

from datetime import date
from pathlib import Path

from app.dtos.health_record_query import (
    HealthRecordQueryArguments,
    HealthRecordQueryMatch,
    HealthRecordQueryPeriod,
    HealthRecordQueryResult,
    RelativePeriod,
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
