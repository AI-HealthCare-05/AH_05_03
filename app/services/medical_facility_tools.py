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
            "사용자의 현재 위치(위도/경도 좌표) 또는 특정 지역명/상권/키워드(예: '홍대 내과', '장충동 소아과', '강남역 치과')를 "
            "바탕으로 주변 병원 및 의원 목록을 초고속으로 조회합니다. "
            "위치 좌표가 있거나 구체적인 지역명/병원 키워드가 있을 때 호출하세요. "
            "위치 좌표와 지역명/병원명이 모두 전혀 없으면 도구를 임의 호출하지 말고 사용자에게 위치를 물어보세요."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "검색할 지역명 및 진료과목/병원 질의어 (예: '홍대 내과', '장충동 소아과', '내과')",
                },
                "latitude": {
                    "type": "number",
                    "description": "사용자의 현재 위도 (선택)",
                },
                "longitude": {
                    "type": "number",
                    "description": "사용자의 현재 경도 (선택)",
                },
                "radius": {
                    "type": "integer",
                    "description": "검색 반경 (미터 단위, 기본 3000)",
                    "default": 3000,
                },
                "keyword": {
                    "type": "string",
                    "description": "진료과목 키워드 (예: 내과, 정형외과, 이비인후과 등)",
                },
            },
        },
    ),
    types.FunctionDeclaration(
        name="search_nearby_pharmacy",
        description=(
            "사용자의 현재 위치(위도/경도 좌표) 또는 특정 지역명(예: '홍대 약국', '장충동 약국')을 바탕으로 "
            "주변 약국 목록 및 운영시간을 초고속으로 조회합니다. "
            "위치 좌표가 있거나 구체적인 지역명이 있을 때 호출하세요. "
            "위치 좌표와 지역명이 모두 전혀 없으면 도구를 임의 호출하지 말고 사용자에게 위치를 물어보세요."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "검색할 지역명 및 약국 질의어 (예: '홍대 약국', '장충동 약국', '강남역 약국', '약국')",
                },
                "stage1": {
                    "type": "string",
                    "description": "시/도 명칭 (예: 서울특별시, 경기도)",
                },
                "stage2": {
                    "type": "string",
                    "description": "시/군/구 명칭 (예: 강남구, 마포구)",
                },
                "latitude": {
                    "type": "number",
                    "description": "사용자의 현재 위도 (선택)",
                },
                "longitude": {
                    "type": "number",
                    "description": "사용자의 현재 경도 (선택)",
                },
                "radius": {
                    "type": "integer",
                    "description": "검색 반경 (미터 단위, 기본 3000)",
                    "default": 3000,
                },
            },
        },
    ),
]


def get_facility_tools() -> list[types.Tool]:
    """Gemini 클라이언트에 등록할 Tool 객체 생성."""
    return [types.Tool(function_declarations=FACILITY_TOOL_DECLARATIONS)]


async def _execute_emergency_room(args: dict[str, Any], client: MedicalFacilityClient) -> FacilitySearchResult:
    lat = args.get("latitude")
    lon = args.get("longitude")
    radius = args.get("radius", 10000)
    stage1 = args.get("stage1")
    stage2 = args.get("stage2")
    query = args.get("query")
    em_kwargs: dict[str, Any] = {
        "latitude": float(lat) if lat is not None else None,
        "longitude": float(lon) if lon is not None else None,
        "radius": int(radius),
        "stage1": str(stage1) if stage1 else None,
        "stage2": str(stage2) if stage2 else None,
    }
    if query is not None:
        em_kwargs["query"] = str(query)
    return await client.search_nearby_emergency_room(**em_kwargs)


async def _execute_hospital(args: dict[str, Any], client: MedicalFacilityClient) -> FacilitySearchResult | None:
    lat = args.get("latitude")
    lon = args.get("longitude")
    radius = args.get("radius", 3000)
    keyword = args.get("keyword")
    query = args.get("query")
    stage1 = args.get("stage1")
    stage2 = args.get("stage2")
    if lat is None and lon is None and not query and not keyword and not stage1 and not stage2:
        return None
    hosp_kwargs: dict[str, Any] = {
        "latitude": float(lat) if lat is not None else None,
        "longitude": float(lon) if lon is not None else None,
        "radius": int(radius),
    }
    if keyword is not None:
        hosp_kwargs["keyword"] = str(keyword)
    if query is not None:
        hosp_kwargs["query"] = str(query)
    if stage1 is not None:
        hosp_kwargs["stage1"] = str(stage1)
    if stage2 is not None:
        hosp_kwargs["stage2"] = str(stage2)
    return await client.search_nearby_hospital(**hosp_kwargs)


async def _execute_pharmacy(args: dict[str, Any], client: MedicalFacilityClient) -> FacilitySearchResult | None:
    lat = args.get("latitude")
    lon = args.get("longitude")
    radius = args.get("radius", 3000)
    query = args.get("query")
    stage1 = args.get("stage1")
    stage2 = args.get("stage2")
    if lat is None and lon is None and not query and not stage1 and not stage2:
        return None
    pharm_kwargs: dict[str, Any] = {
        "latitude": float(lat) if lat is not None else None,
        "longitude": float(lon) if lon is not None else None,
        "radius": int(radius),
    }
    if query is not None:
        pharm_kwargs["query"] = str(query)
    if stage1 is not None:
        pharm_kwargs["stage1"] = str(stage1)
    if stage2 is not None:
        pharm_kwargs["stage2"] = str(stage2)
    return await client.search_nearby_pharmacy(**pharm_kwargs)


async def execute_facility_tool(
    name: str,
    args: dict[str, Any],
    client: MedicalFacilityClient,
) -> FacilitySearchResult | None:
    """도구 호출 명칭과 인자를 바탕으로 적절한 클라이언트 메서드 실행."""
    logger.info(f"의료시설 툴 실행: {name}, args: {args}")

    if name == "search_nearby_emergency_room":
        return await _execute_emergency_room(args, client)
    if name == "search_nearby_hospital":
        return await _execute_hospital(args, client)
    if name == "search_nearby_pharmacy":
        return await _execute_pharmacy(args, client)
    return None
