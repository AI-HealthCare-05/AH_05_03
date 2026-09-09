"""식품영양성분 툴콜링(Tool Calling) 단위 테스트."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.dtos.food_nutrition import FoodNutritionItem, FoodNutritionSearchResult
from app.services.food_nutrition_tools import (
    FOOD_NUTRITION_TOOL_DECLARATION,
    execute_food_nutrition_tool,
    get_food_nutrition_tools,
)


def test_tool_declaration() -> None:
    assert FOOD_NUTRITION_TOOL_DECLARATION.name == "search_food_nutrition"
    schema = FOOD_NUTRITION_TOOL_DECLARATION.parameters_json_schema
    assert schema is not None
    assert "food_name" in schema["properties"]
    assert "food_name" in schema["required"]


def test_get_food_nutrition_tools() -> None:
    tools = get_food_nutrition_tools()
    assert len(tools) == 1
    decls = tools[0].function_declarations
    assert decls is not None
    assert len(decls) == 1
    assert decls[0].name == "search_food_nutrition"


@pytest.mark.asyncio
async def test_execute_food_nutrition_tool() -> None:
    mock_client = AsyncMock()
    mock_result = FoodNutritionSearchResult(
        query="라면",
        items=[
            FoodNutritionItem(
                food_name="라면",
                serving_size="120g",
                calories_kcal=500.0,
                sodium_mg=1790.0,
            )
        ],
        message="라면 영양성분 정보",
    )
    mock_client.search_food_nutrition.return_value = mock_result

    # 정상 실행
    res = await execute_food_nutrition_tool(
        "search_food_nutrition",
        {"food_name": "라면"},
        mock_client,
    )
    assert res == mock_result
    mock_client.search_food_nutrition.assert_awaited_once_with("라면")

    # 다른 이름인 경우 None
    res_other = await execute_food_nutrition_tool(
        "other_tool",
        {"food_name": "라면"},
        mock_client,
    )
    assert res_other is None

    # food_name이 빈 값인 경우 None
    res_empty = await execute_food_nutrition_tool(
        "search_food_nutrition",
        {"food_name": ""},
        mock_client,
    )
    assert res_empty is None
