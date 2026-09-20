from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from app.dtos.health_record_query import HealthRecordQueryResult
from app.services.food_nutrition_tools import FOOD_NUTRITION_TOOL_DECLARATION
from app.services.health_knowledge_tools import SEARCH_HEALTH_KNOWLEDGE_DECLARATION
from app.services.health_record_tools import QUERY_HEALTH_RECORDS_DECLARATION
from app.services.medical_facility_tools import FACILITY_TOOL_DECLARATIONS
from app.services.medication_tools import MEDICATION_TOOL_DECLARATION
from app.services.outdoor_conditions_tools import OUTDOOR_CONDITIONS_TOOL_DECLARATION

Access = Literal["read", "write"]
Risk = Literal["low", "medium", "high"]
Exposure = Literal["model_selectable", "server_prefetch", "not_agent_callable"]
CostClass = Literal["low", "medium", "high"]

FACILITY_RESULT_FIELDS = frozenset({"facility_type", "total_count", "message", "items"})
FACILITY_ITEM_FIELDS = frozenset({"name", "address_summary", "distance_m", "phone_available", "open_now"})
MEDICATION_RESULT_FIELDS = frozenset({"query", "message", "has_interaction_danger", "items"})
MEDICATION_ITEM_FIELDS = frozenset({"product_name", "ingredient_summary", "precautions", "source"})
FOOD_RESULT_FIELDS = frozenset({"query", "message", "items"})
FOOD_ITEM_FIELDS = frozenset({"food_name", "serving_size", "calories", "nutrient_summary", "source"})
KNOWLEDGE_RESULT_FIELDS = frozenset({"query", "message", "items"})
KNOWLEDGE_ITEM_FIELDS = frozenset({"title", "summary", "url", "source"})
OUTDOOR_RESULT_FIELDS = frozenset({"weather", "air_quality", "errors"})
LOCATION_RESULT_FORBIDDEN = frozenset({"latitude", "longitude", "phone", "emergency_room_phone"})
QUERY_HEALTH_RECORDS_RESULT_FIELDS = frozenset(HealthRecordQueryResult.model_fields)
QUERY_HEALTH_RECORDS_FORBIDDEN_RESULT_FIELDS = frozenset(
    {
        "name",
        "patient_name",
        "document",
        "document_id",
        "text",
        "tables",
        "prompt",
        "files",
        "bytes",
        "ocr",
    }
)


@dataclass(frozen=True)
class ToolLimits:
    """호출 한도 자리. 값 강제는 에이전트 4단계(러너)에서 한다."""

    max_calls_per_turn: int
    timeout_ms: int
    cost_class: CostClass


@dataclass(frozen=True)
class ToolSpec:
    name: str
    access: Access
    risk: Risk
    exposure: Exposure
    enabled: bool
    input_fields: frozenset[str]
    result_fields: frozenset[str]
    item_fields: frozenset[str]
    forbidden_result_fields: frozenset[str]
    limits: ToolLimits
    source_module: str


def _schema_fields(declaration: Any) -> frozenset[str]:
    schema = declaration.parameters_json_schema or {}
    properties = schema.get("properties") or {}
    return frozenset(properties)


_LOW = ToolLimits(max_calls_per_turn=1, timeout_ms=4_000, cost_class="low")
_MEDIUM = ToolLimits(max_calls_per_turn=1, timeout_ms=8_000, cost_class="medium")
_HIGH = ToolLimits(max_calls_per_turn=1, timeout_ms=45_000, cost_class="high")
_FACILITY_BY_NAME = {declaration.name: declaration for declaration in FACILITY_TOOL_DECLARATIONS}

TOOL_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="query_health_records",
        access="read",
        risk="high",
        exposure="model_selectable",
        enabled=True,
        input_fields=_schema_fields(QUERY_HEALTH_RECORDS_DECLARATION),
        result_fields=QUERY_HEALTH_RECORDS_RESULT_FIELDS,
        item_fields=frozenset(),
        forbidden_result_fields=QUERY_HEALTH_RECORDS_FORBIDDEN_RESULT_FIELDS,
        limits=_LOW,
        source_module="app.services.health_record_tools",
    ),
    ToolSpec(
        name="search_nearby_emergency_room",
        access="read",
        risk="low",
        exposure="model_selectable",
        enabled=True,
        input_fields=_schema_fields(_FACILITY_BY_NAME["search_nearby_emergency_room"]),
        result_fields=FACILITY_RESULT_FIELDS,
        item_fields=FACILITY_ITEM_FIELDS,
        forbidden_result_fields=LOCATION_RESULT_FORBIDDEN,
        limits=_MEDIUM,
        source_module="app.services.medical_facility_tools",
    ),
    ToolSpec(
        name="search_nearby_hospital",
        access="read",
        risk="low",
        exposure="model_selectable",
        enabled=True,
        input_fields=_schema_fields(_FACILITY_BY_NAME["search_nearby_hospital"]),
        result_fields=FACILITY_RESULT_FIELDS,
        item_fields=FACILITY_ITEM_FIELDS,
        forbidden_result_fields=LOCATION_RESULT_FORBIDDEN,
        limits=_MEDIUM,
        source_module="app.services.medical_facility_tools",
    ),
    ToolSpec(
        name="search_nearby_pharmacy",
        access="read",
        risk="low",
        exposure="model_selectable",
        enabled=True,
        input_fields=_schema_fields(_FACILITY_BY_NAME["search_nearby_pharmacy"]),
        result_fields=FACILITY_RESULT_FIELDS,
        item_fields=FACILITY_ITEM_FIELDS,
        forbidden_result_fields=LOCATION_RESULT_FORBIDDEN,
        limits=_MEDIUM,
        source_module="app.services.medical_facility_tools",
    ),
    ToolSpec(
        name="search_medication_info",
        access="read",
        risk="medium",
        exposure="model_selectable",
        enabled=True,
        input_fields=_schema_fields(MEDICATION_TOOL_DECLARATION),
        result_fields=MEDICATION_RESULT_FIELDS,
        item_fields=MEDICATION_ITEM_FIELDS,
        forbidden_result_fields=frozenset(),
        limits=_MEDIUM,
        source_module="app.services.medication_tools",
    ),
    ToolSpec(
        name="search_food_nutrition",
        access="read",
        risk="low",
        exposure="model_selectable",
        enabled=True,
        input_fields=_schema_fields(FOOD_NUTRITION_TOOL_DECLARATION),
        result_fields=FOOD_RESULT_FIELDS,
        item_fields=FOOD_ITEM_FIELDS,
        forbidden_result_fields=frozenset(),
        limits=_MEDIUM,
        source_module="app.services.food_nutrition_tools",
    ),
    ToolSpec(
        name="search_health_knowledge",
        access="read",
        risk="medium",
        exposure="server_prefetch",
        enabled=True,
        input_fields=_schema_fields(SEARCH_HEALTH_KNOWLEDGE_DECLARATION),
        result_fields=KNOWLEDGE_RESULT_FIELDS,
        item_fields=KNOWLEDGE_ITEM_FIELDS,
        forbidden_result_fields=frozenset(),
        limits=_MEDIUM,
        source_module="app.services.health_knowledge_tools",
    ),
    ToolSpec(
        name="get_outdoor_health_conditions",
        access="read",
        risk="low",
        exposure="server_prefetch",
        enabled=True,
        input_fields=_schema_fields(OUTDOOR_CONDITIONS_TOOL_DECLARATION),
        result_fields=OUTDOOR_RESULT_FIELDS,
        item_fields=frozenset(),
        forbidden_result_fields=LOCATION_RESULT_FORBIDDEN,
        limits=_MEDIUM,
        source_module="app.services.outdoor_conditions_tools",
    ),
    ToolSpec(
        name="document_vision",
        access="read",
        risk="high",
        exposure="not_agent_callable",
        enabled=False,
        input_fields=frozenset(),
        result_fields=frozenset(),
        item_fields=frozenset(),
        forbidden_result_fields=QUERY_HEALTH_RECORDS_FORBIDDEN_RESULT_FIELDS,
        limits=_HIGH,
        source_module="app.services.dev_ocr",
    ),
)

TOOLS_BY_NAME = {spec.name: spec for spec in TOOL_SPECS}


def declared_llm_tool_names() -> frozenset[str]:
    """코드에 있는 FunctionDeclaration 이름. 설계도에만 있는 이름은 여기 없다."""
    names = [
        QUERY_HEALTH_RECORDS_DECLARATION.name,
        MEDICATION_TOOL_DECLARATION.name,
        FOOD_NUTRITION_TOOL_DECLARATION.name,
        SEARCH_HEALTH_KNOWLEDGE_DECLARATION.name,
        OUTDOOR_CONDITIONS_TOOL_DECLARATION.name,
        *(declaration.name for declaration in FACILITY_TOOL_DECLARATIONS),
    ]
    return frozenset(str(name) for name in names if name)


def model_selectable_names() -> frozenset[str]:
    return frozenset(spec.name for spec in TOOL_SPECS if spec.exposure == "model_selectable" and spec.enabled)


def is_model_selectable(name: str) -> bool:
    spec = TOOLS_BY_NAME.get(name)
    return spec is not None and spec.enabled and spec.exposure == "model_selectable"


def project_health_record_query_result(result: HealthRecordQueryResult) -> HealthRecordQueryResult:
    """집계 결과에서 이름·문서 원문·전체 표 자리를 제거한다."""
    payload = result.model_dump()
    leaked = QUERY_HEALTH_RECORDS_FORBIDDEN_RESULT_FIELDS & set(payload)
    if leaked:
        raise ValueError(f"health record query result cannot include {sorted(leaked)}")
    extra = set(payload) - QUERY_HEALTH_RECORDS_RESULT_FIELDS
    for key in extra:
        payload.pop(key)
    return HealthRecordQueryResult.model_validate(payload)
