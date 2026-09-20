from __future__ import annotations

from typing import Any

from app.dtos.food_nutrition import FoodNutritionSearchResult
from app.dtos.health_knowledge import HealthKnowledgeSearchResult
from app.dtos.health_record_query import AlcoholConsultationSnapshot, HealthRecordQueryResult
from app.dtos.medical_facility import FacilitySearchResult
from app.dtos.medication import MedicationSearchResult
from app.dtos.outdoor_conditions import OutdoorConditionsResult
from app.services.agent_tools.registry import (
    TOOLS_BY_NAME,
    project_health_record_query_result,
)

USER_SAFE_TOOL_MESSAGE = "요청한 기능을 지금은 사용할 수 없습니다."

TOOL_NOT_REGISTERED = "TOOL_NOT_REGISTERED"
TOOL_NOT_MODEL_SELECTABLE = "TOOL_NOT_MODEL_SELECTABLE"
TOOL_DISABLED = "TOOL_DISABLED"
TOOL_NOT_AUTHORIZED = "TOOL_NOT_AUTHORIZED"
TOOL_SCOPE_DENIED = "TOOL_SCOPE_DENIED"
TOOL_SESSION_REVOKED = "TOOL_SESSION_REVOKED"


class ToolPolicyError(Exception):
    """레지스트리·권한 정책에 어긋난 도구 호출. HTTP로 올리지 않는다."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        self.message = USER_SAFE_TOOL_MESSAGE
        super().__init__(self.message)

    def model_payload(self) -> dict[str, str]:
        return {"error": self.reason, "message": self.message}


def require_model_selectable(name: str) -> None:
    spec = TOOLS_BY_NAME.get(name)
    if spec is None:
        raise ToolPolicyError(TOOL_NOT_REGISTERED)
    if not spec.enabled:
        raise ToolPolicyError(TOOL_DISABLED)
    if spec.exposure != "model_selectable":
        raise ToolPolicyError(TOOL_NOT_MODEL_SELECTABLE)


def _pick(payload: dict[str, Any], allowed: frozenset[str]) -> dict[str, Any]:
    return {key: payload[key] for key in allowed if key in payload}


def _project_facility(result: FacilitySearchResult) -> dict[str, Any]:
    if result.facility_type == "hospital":
        spec = TOOLS_BY_NAME["search_nearby_hospital"]
    elif result.facility_type == "pharmacy":
        spec = TOOLS_BY_NAME["search_nearby_pharmacy"]
    else:
        spec = TOOLS_BY_NAME["search_nearby_emergency_room"]
    items = []
    for item in result.items:
        items.append(
            {
                "name": item.name,
                "address_summary": item.address,
                "distance_m": item.distance_m,
                "phone_available": bool(item.phone or item.emergency_room_phone),
                "open_now": item.is_open,
            }
        )
    payload = {
        "facility_type": result.facility_type,
        "total_count": result.total_count,
        "message": result.message,
        "items": items,
    }
    return _pick(payload, spec.result_fields) | {"items": [_pick(row, spec.item_fields) for row in items]}


def _project_medication(result: MedicationSearchResult) -> dict[str, Any]:
    spec = TOOLS_BY_NAME["search_medication_info"]
    items = []
    for item in result.items:
        items.append(
            {
                "product_name": item.item_name,
                "ingredient_summary": item.class_name,
                "precautions": item.atpn_qesitm or item.atpn_warn_qesitm,
                "source": "mfds",
            }
        )
    payload = {
        "query": result.query,
        "message": result.message,
        "has_interaction_danger": result.has_interaction_danger,
        "items": items,
    }
    return _pick(payload, spec.result_fields) | {"items": [_pick(row, spec.item_fields) for row in items]}


def _nutrient_summary(item: Any) -> str:
    parts: list[str] = []
    if item.sodium_mg is not None:
        parts.append(f"나트륨 {item.sodium_mg}mg")
    if item.sugar_g is not None:
        parts.append(f"당류 {item.sugar_g}g")
    if item.protein_g is not None:
        parts.append(f"단백질 {item.protein_g}g")
    return ", ".join(parts)


def _project_food(result: FoodNutritionSearchResult) -> dict[str, Any]:
    spec = TOOLS_BY_NAME["search_food_nutrition"]
    items = []
    for item in result.items:
        items.append(
            {
                "food_name": item.food_name,
                "serving_size": item.serving_size,
                "calories": item.calories_kcal,
                "nutrient_summary": _nutrient_summary(item),
                "source": "mfds",
            }
        )
    payload = {"query": result.query, "message": result.message, "items": items}
    return _pick(payload, spec.result_fields) | {"items": [_pick(row, spec.item_fields) for row in items]}


def _project_knowledge(result: HealthKnowledgeSearchResult) -> dict[str, Any]:
    spec = TOOLS_BY_NAME["search_health_knowledge"]
    items = [
        {
            "title": item.title,
            "summary": item.summary,
            "url": item.url,
            "source": item.source,
        }
        for item in result.items
    ]
    payload = {"query": result.query, "message": result.message, "items": items}
    return _pick(payload, spec.result_fields) | {"items": [_pick(row, spec.item_fields) for row in items]}


def _project_outdoor(result: OutdoorConditionsResult) -> dict[str, Any]:
    spec = TOOLS_BY_NAME["get_outdoor_health_conditions"]
    payload = {
        "weather": result.weather.model_dump() if result.weather else None,
        "air_quality": result.air_quality.model_dump() if result.air_quality else None,
        "errors": result.errors,
    }
    return _pick(payload, spec.result_fields)


def _project_known_dto(result: object) -> dict[str, Any] | None:
    if isinstance(result, HealthRecordQueryResult):
        return project_health_record_query_result(result).model_dump(mode="json")
    if isinstance(result, AlcoholConsultationSnapshot):
        return _pick(result.model_dump(mode="json"), TOOLS_BY_NAME["get_alcohol_consultation_snapshot"].result_fields)
    if isinstance(result, FacilitySearchResult):
        return _project_facility(result)
    if isinstance(result, MedicationSearchResult):
        return _project_medication(result)
    if isinstance(result, FoodNutritionSearchResult):
        return _project_food(result)
    if isinstance(result, HealthKnowledgeSearchResult):
        return _project_knowledge(result)
    if isinstance(result, OutdoorConditionsResult):
        return _project_outdoor(result)
    return None


def project_for_model(name: str, result: Any) -> Any:
    """모델에 넘길 도구 결과만 남긴다. API 응답 DTO는 그대로 둔다."""
    if result is None or (isinstance(result, dict) and result.get("error")):
        return result
    projected = _project_known_dto(result)
    if projected is not None:
        return projected
    if hasattr(result, "model_dump"):
        dumped = result.model_dump(mode="json")
        spec = TOOLS_BY_NAME.get(name)
        if spec and spec.result_fields:
            return _pick(dumped, spec.result_fields)
        return dumped
    return result
