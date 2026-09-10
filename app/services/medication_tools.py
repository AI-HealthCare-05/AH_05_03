"""식약처 의약품 정보 조회용 LLM Tool Calling 선언과 실행기."""

from __future__ import annotations

from typing import Any

from google.genai import types

from app.dtos.medication import MedicationSearchResult
from app.services.medication_client import MedicationClientProtocol

MEDICATION_TOOL_DECLARATION = types.FunctionDeclaration(
    name="search_medication_info",
    description=(
        "사용자가 특정 의약품의 효능·효과, 용법·용량, 부작용, 주의사항을 물어보거나, "
        "두 의약품을 함께 복용해도 되는지(DUR 병용금기 및 상호작용) 물어볼 때 호출합니다. "
        "식약처 e약은요 API와 DUR 품목정보/병용금기 API를 통해 공식 데이터를 조회합니다. "
        "두 약품 병용 여부 질문인 경우 drug_name과 target_drug_name에 각각의 약품명을 전달하세요. "
        "날씨, 대기질, 운동, 식단, 병원 찾기 등 의약품과 무관한 대화에서는 절대 호출하지 마세요. "
        "약품명이 명확하지 않으면 먼저 약품명을 사용자에게 확인하세요."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "drug_name": {
                "type": "string",
                "description": "조회할 의약품명 또는 병용 확인할 첫 번째 의약품명 (예: 타이레놀, 판콜에이, 노바스크)",
            },
            "target_drug_name": {
                "type": "string",
                "description": "함께 복용 여부나 상호작용(병용금기)을 확인할 두 번째 의약품명 (두 약품 병용 질문인 경우에만 선택 전달, 예: 아스피린, 게보린)",
            },
        },
        "required": ["drug_name"],
    },
)


def get_medication_tools() -> list[types.Tool]:
    """Gemini 클라이언트에 등록할 Tool 객체 생성."""
    return [types.Tool(function_declarations=[MEDICATION_TOOL_DECLARATION])]


async def execute_medication_tool(
    name: str,
    args: dict[str, Any],
    client: MedicationClientProtocol,
) -> MedicationSearchResult | None:
    """도구 호출 명칭과 인자를 바탕으로 의약품 조회 실행."""
    if name != "search_medication_info":
        return None
    drug_name = args.get("drug_name")
    if not drug_name:
        return None
    target_drug_name = args.get("target_drug_name")
    target_str = str(target_drug_name).strip() if target_drug_name else None
    return await client.search_medication(str(drug_name), target_drug_name=target_str)
