"""야외 건강 상황용 LLM Tool Calling 선언과 실행기."""

from __future__ import annotations

from typing import Any

from google.genai import types

from app.dtos.outdoor_conditions import OutdoorConditionsResult
from app.services.outdoor_conditions_client import OutdoorConditionsClient

OUTDOOR_CONDITIONS_TOOL_DECLARATION = types.FunctionDeclaration(
    name="get_outdoor_health_conditions",
    description=(
        "사용자의 현재 위치를 기준으로 기온, 강수, 풍속, 미세먼지(PM10), 초미세먼지(PM2.5)를 조회합니다. "
        "'오늘 밖에서 운동해도 돼?', '미세먼지 심한데 산책해도 될까?'처럼 야외 활동·외출·날씨·대기질이 "
        "건강 판단에 필요한 질문에서만 호출하세요. 위치가 없으면 호출하지 말고 위치 권한 또는 지역명을 먼저 물어보세요."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "latitude": {"type": "number", "description": "사용자 위도(WGS84)"},
            "longitude": {"type": "number", "description": "사용자 경도(WGS84)"},
        },
        "required": ["latitude", "longitude"],
    },
)


def get_outdoor_conditions_tools() -> list[types.Tool]:
    return [types.Tool(function_declarations=[OUTDOOR_CONDITIONS_TOOL_DECLARATION])]


async def execute_outdoor_conditions_tool(
    name: str,
    args: dict[str, Any],
    client: OutdoorConditionsClient,
) -> OutdoorConditionsResult | None:
    if name != "get_outdoor_health_conditions":
        return None
    latitude = args.get("latitude")
    longitude = args.get("longitude")
    if latitude is None or longitude is None:
        return None
    return await client.get_outdoor_conditions(float(latitude), float(longitude))

