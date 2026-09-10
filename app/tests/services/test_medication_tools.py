"""의약품 도구 선언 및 실행기 단위 테스트."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.dtos.medication import MedicationSearchResult
from app.services.medication_tools import (
    MEDICATION_TOOL_DECLARATION,
    execute_medication_tool,
    get_medication_tools,
)


def test_medication_tool_declaration_schema() -> None:
    """도구 선언에 drug_name과 target_drug_name 파라미터가 포함되어 있어야 한다."""
    assert MEDICATION_TOOL_DECLARATION.name == "search_medication_info"
    schema = MEDICATION_TOOL_DECLARATION.parameters_json_schema
    assert schema is not None
    props = schema.get("properties", {})
    assert "drug_name" in props
    assert "target_drug_name" in props
    assert schema.get("required") == ["drug_name"]


def test_get_medication_tools() -> None:
    tools = get_medication_tools()
    assert len(tools) == 1
    decls = tools[0].function_declarations
    assert decls is not None
    assert len(decls) == 1
    assert decls[0].name == "search_medication_info"


@pytest.mark.asyncio
async def test_execute_medication_tool_single_drug() -> None:
    mock_client = AsyncMock()
    mock_client.search_medication.return_value = MedicationSearchResult(
        query="타이레놀",
        items=[],
        message="타이레놀 조회 완료",
    )

    res = await execute_medication_tool(
        "search_medication_info",
        {"drug_name": "타이레놀"},
        mock_client,
    )

    assert res is not None
    assert res.query == "타이레놀"
    mock_client.search_medication.assert_awaited_once_with("타이레놀", target_drug_name=None)


@pytest.mark.asyncio
async def test_execute_medication_tool_with_target_drug() -> None:
    mock_client = AsyncMock()
    mock_client.search_medication.return_value = MedicationSearchResult(
        query="타이레놀, 아스피린",
        items=[],
        has_interaction_danger=True,
        message="DUR 병용금기 주의",
    )

    res = await execute_medication_tool(
        "search_medication_info",
        {"drug_name": "타이레놀", "target_drug_name": "아스피린"},
        mock_client,
    )

    assert res is not None
    assert res.has_interaction_danger is True
    mock_client.search_medication.assert_awaited_once_with("타이레놀", target_drug_name="아스피린")


@pytest.mark.asyncio
async def test_execute_medication_tool_invalid_name() -> None:
    mock_client = AsyncMock()
    res = await execute_medication_tool("invalid_tool", {"drug_name": "타이레놀"}, mock_client)
    assert res is None
    mock_client.search_medication.assert_not_awaited()
