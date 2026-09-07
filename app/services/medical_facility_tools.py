"""주변 의료시설 조회를 위한 LLM 툴(Tool Calling) 정의 및 실행 디스패처."""

from __future__ import annotations

import logging
from typing import Any

from google.genai import types

from app.dtos.medical_facility import FacilitySearchResult
from app.services.medical_facility_client import MedicalFacilityClient

logger = logging.getLogger(__name__)

FACILITY_TOOL_DECLARATIONS = [
    types.FunctionDeclaration(
        name="search_nearby_emergency_room",
        description=(
            "사용자의 현재 위치(위도/경도) 또는 시도/시군구 지역명을 바탕으로 "
            "주변 응급실(응급의료기관) 및 실시간 가용병상 정보를 조회합니다. "
            "위치 좌표나 구체적인 지역명(시도, 시군구)이 있을 때만 호출하세요. "
            "위치 정보가 전혀 없는 경우 도구를 호출하지 말고 위치를 먼저 물어보세요."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "latitude": {
                    "type": "number",
                    "description": "사용자의 위도 (WGS84, 예: 37.4979)",
                },
                "longitude": {
                    "type": "number",
                    "description": "사용자의 경도 (WGS84, 예: 127.0276)",
                },
                "stage1": {
                    "type": "string",
                    "description": "시도 명칭 (예: 서울특별시, 경기도)",
                },
                "stage2": {
                    "type": "string",
                    "description": "시군구 명칭 (예: 강남구, 서초구, 성남시 분당구)",
                },
                "radius": {
                    "type": "integer",
                    "description": "검색 반경 (미터, 기본 10000)",
                    "default": 10000,
                },
            },
        },
    ),
    types.FunctionDeclaration(
        name="search_nearby_hospital",
        description=(
            "사용자의 위도, 경도 좌표를 기준으로 반경 내 병원 및 의원 목록을 조회합니다. "
            "위도(latitude)와 경도(longitude) 좌표가 필수입니다. "
            "위도/경도 좌표 없이 주소 문자열만 있거나 위치 정보가 전혀 없으면 "
            "도구를 임의 호출하지 말고 사용자에게 위치 권한 허용 또는 위치 정보를 요청하세요."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "latitude": {
                    "type": "number",
                    "description": "사용자의 현재 위도 (필수)",
                },
                "longitude": {
                    "type": "number",
                    "description": "사용자의 현재 경도 (필수)",
                },
                "radius": {
                    "type": "integer",
                    "description": "검색 반경 (미터 단위, 기본 3000)",
                    "default": 3000,
                },
                "keyword": {
                    "type": "string",
                    "description": "검색할 병원명 또는 진료과목 키워드 (예: 내과, 정형외과, 이비인후과 등)",
                },
            },
            "required": ["latitude", "longitude"],
        },
    ),
    types.FunctionDeclaration(
        name="search_nearby_pharmacy",
        description=(
            "사용자의 위도, 경도 좌표를 기준으로 반경 내 약국 목록 및 운영시간을 조회합니다. "
            "위도(latitude)와 경도(longitude) 좌표가 필수입니다. "
            "위도/경도 좌표가 없으면 도구를 임의 호출하지 말고 사용자에게 위치 정보를 요청하세요."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "latitude": {
                    "type": "number",
                    "description": "사용자의 현재 위도 (필수)",
                },
                "longitude": {
                    "type": "number",
                    "description": "사용자의 현재 경도 (필수)",
                },
                "radius": {
                    "type": "integer",
                    "description": "검색 반경 (미터 단위, 기본 3000)",
                    "default": 3000,
                },
            },
            "required": ["latitude", "longitude"],
        },
    ),
]


def get_facility_tools() -> list[types.Tool]:
    """Gemini 클라이언트에 등록할 Tool 객체 생성."""
    return [types.Tool(function_declarations=FACILITY_TOOL_DECLARATIONS)]


async def execute_facility_tool(
    name: str,
    args: dict[str, Any],
    client: MedicalFacilityClient,
) -> FacilitySearchResult | None:
    """도구 호출 명칭과 인자를 바탕으로 적절한 클라이언트 메서드 실행."""
    logger.info(f"의료시설 툴 실행: {name}")

    if name == "search_nearby_emergency_room":
        lat = args.get("latitude")
        lon = args.get("longitude")
        radius = args.get("radius", 10000)
        stage1 = args.get("stage1")
        stage2 = args.get("stage2")
        return await client.search_nearby_emergency_room(
            latitude=float(lat) if lat is not None else None,
            longitude=float(lon) if lon is not None else None,
            radius=int(radius),
            stage1=str(stage1) if stage1 else None,
            stage2=str(stage2) if stage2 else None,
        )

    if name == "search_nearby_hospital":
        lat = args.get("latitude")
        lon = args.get("longitude")
        if lat is None or lon is None:
            return None
        radius = args.get("radius", 3000)
        keyword = args.get("keyword")
        return await client.search_nearby_hospital(
            latitude=float(lat),
            longitude=float(lon),
            radius=int(radius),
            keyword=str(keyword) if keyword else None,
        )

    if name == "search_nearby_pharmacy":
        lat = args.get("latitude")
        lon = args.get("longitude")
        if lat is None or lon is None:
            return None
        radius = args.get("radius", 3000)
        return await client.search_nearby_pharmacy(
            latitude=float(lat),
            longitude=float(lon),
            radius=int(radius),
        )

    return None
