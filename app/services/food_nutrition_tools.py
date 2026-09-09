"""식품영양성분(칼로리/나트륨/당류 등) 조회용 LLM Tool Calling 선언과 실행기."""

from __future__ import annotations

from typing import Any

from google.genai import types

from app.dtos.food_nutrition import FoodNutritionSearchResult
from app.services.food_nutrition_client import FoodNutritionClientProtocol

FOOD_NUTRITION_TOOL_DECLARATION = types.FunctionDeclaration(
    name="search_food_nutrition",
    description=(
        "사용자가 특정 음식이나 식품의 영양성분(열량/칼로리, 나트륨, 당류, 탄수화물, 단백질, 지방 등)을 물어보거나, "
        "질환(고혈압, 당뇨, 비만, 신장질환 등)과 관련하여 해당 음식을 먹어도 되는지 식단 조언을 구할 때 호출합니다. "
        "식품의약품안전처 식품영양성분 데이터베이스를 통해 공인된 영양성분 함량 정보를 조회합니다. "
        "한 번에 한 가지 음식만 조회할 수 있으므로, 음식명이 여러 개이면 가장 핵심 음식 하나를 선택하세요. "
        "날씨, 의약품, 병원 찾기 등 식품/음식 영양과 무관한 대화에서는 절대 호출하지 마세요."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "food_name": {
                "type": "string",
                "description": "조회할 음식 또는 식품명 (예: 라면, 짜장면, 김치찌개, 삼겹살, 바나나, 떡볶이)",
            },
        },
        "required": ["food_name"],
    },
)


def get_food_nutrition_tools() -> list[types.Tool]:
    """Gemini 클라이언트에 등록할 Tool 객체 생성."""
    return [types.Tool(function_declarations=[FOOD_NUTRITION_TOOL_DECLARATION])]


async def execute_food_nutrition_tool(
    name: str,
    args: dict[str, Any],
    client: FoodNutritionClientProtocol,
) -> FoodNutritionSearchResult | None:
    """도구 호출 명칭과 인자를 바탕으로 식품 영양성분 조회 실행."""
    if name != "search_food_nutrition":
        return None
    food_name = args.get("food_name")
    if not food_name:
        return None
    return await client.search_food_nutrition(str(food_name))
