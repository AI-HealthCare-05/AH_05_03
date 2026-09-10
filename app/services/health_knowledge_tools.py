from __future__ import annotations

from typing import Any

from google.genai import types

from app.dtos.health_knowledge import HealthKnowledgeSearchResult
from app.services.health_knowledge_catalog import HealthKnowledgeClientProtocol

SEARCH_HEALTH_KNOWLEDGE_TOOL_NAME = "search_health_knowledge"

SEARCH_HEALTH_KNOWLEDGE_DECLARATION = types.FunctionDeclaration(
    name=SEARCH_HEALTH_KNOWLEDGE_TOOL_NAME,
    description=(
        "질병관리청 국가건강정보포털에서 승인된 건강정보를 조회합니다. "
        "질환, 검사, 생활습관, 음주, 식이, 운동의 의학적 의미나 권고가 필요할 때 호출하세요."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {"query": {"type": "string", "description": "사용자의 건강 질문"}},
        "required": ["query"],
        "additionalProperties": False,
    },
)


def get_health_knowledge_tools() -> list[types.Tool]:
    return [types.Tool(function_declarations=[SEARCH_HEALTH_KNOWLEDGE_DECLARATION])]


async def execute_health_knowledge_tool(
    name: str, args: dict[str, Any], client: HealthKnowledgeClientProtocol
) -> HealthKnowledgeSearchResult | None:
    if name != SEARCH_HEALTH_KNOWLEDGE_TOOL_NAME:
        return None
    query = str(args.get("query") or "").strip()
    if not query:
        return None
    return await client.search(query)
