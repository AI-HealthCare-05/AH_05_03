"""장기 건강기록을 조건별로 집계하는 읽기 전용 LLM 도구."""

import uuid
from typing import Any

from google.genai import types
from pydantic import ValidationError

from app.dtos.health_record_query import HealthRecordQueryArguments, HealthRecordQueryResult
from app.models.service_accounts import ServiceAccount
from app.services.health_records import HealthRecordService

QUERY_HEALTH_RECORDS_TOOL_NAME = "query_health_records"

QUERY_HEALTH_RECORDS_DECLARATION = types.FunctionDeclaration(
    name=QUERY_HEALTH_RECORDS_TOOL_NAME,
    description=(
        "현재 대화 대상 사용자의 장기 건강기록을 조건별로 조회하고 PostgreSQL이 집계한 결과를 반환합니다. "
        "'지난 3개월 동안 혈압 140을 넘은 날이 며칠이야?'처럼 기간, 혈압 기준값, 일수 집계가 "
        "모두 필요한 질문에만 호출하세요. 인사, 기록 저장, 단순 최근 기록 목록 조회에는 호출하지 마세요. "
        "계정 ID나 프로필 ID를 인자로 만들지 마세요. 두 값은 서버가 인증 컨텍스트에서 강제합니다."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "record_type": {
                "type": "string",
                "enum": ["blood_pressure"],
                "description": "조회할 건강기록 종류. 1차 범위는 혈압만 지원합니다.",
            },
            "period": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["relative_months"]},
                    "value": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 12,
                        "description": "현재 한국 시간 기준으로 거슬러 조회할 개월 수",
                    },
                },
                "required": ["type", "value"],
                "additionalProperties": False,
            },
            "metric": {
                "type": "string",
                "enum": ["systolic"],
                "description": "혈압 지표. 1차 범위는 수축기 혈압만 지원합니다.",
            },
            "operator": {
                "type": "string",
                "enum": ["gt", "gte"],
                "description": "초과는 gt, 이상은 gte로 구분합니다.",
            },
            "threshold": {
                "type": "number",
                "minimum": 40,
                "maximum": 300,
                "description": "비교할 수축기 혈압 기준값(mmHg)",
            },
            "aggregation": {
                "type": "string",
                "enum": ["count_days"],
                "description": "조건을 만족한 서로 다른 한국 날짜 수 집계",
            },
        },
        "required": ["record_type", "period", "metric", "operator", "threshold", "aggregation"],
        "additionalProperties": False,
    },
)


def get_health_record_tools() -> list[types.Tool]:
    return [types.Tool(function_declarations=[QUERY_HEALTH_RECORDS_DECLARATION])]


async def execute_health_record_tool(
    name: str,
    args: dict[str, Any],
    *,
    account: ServiceAccount,
    profile_id: uuid.UUID,
    record_service: HealthRecordService,
) -> HealthRecordQueryResult | None:
    if name != QUERY_HEALTH_RECORDS_TOOL_NAME:
        return None
    try:
        query = HealthRecordQueryArguments.model_validate(args)
    except ValidationError as ex:
        raise ValueError("건강기록 조회 조건이 허용 범위를 벗어났습니다.") from ex
    return await record_service.query_numeric_summary(account, profile_id, query)
