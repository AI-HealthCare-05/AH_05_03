from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.dtos.base import BaseRequestModel


class RelativePeriod(BaseRequestModel):
    type: Literal["relative_months"] = "relative_months"
    value: int = Field(ge=1, le=12, description="현재 시점부터 거슬러 조회할 개월 수")


class HealthRecordQueryArguments(BaseRequestModel):
    """LLM이 제안할 수 있는 읽기 전용 집계 조건.

    계정과 프로필 식별자는 의도적으로 없다. 두 값은 인증된 요청 컨텍스트에서
    서버가 강제한다.
    """

    record_type: Literal["blood_pressure"]
    period: RelativePeriod
    metric: Literal["systolic"]
    operator: Literal["gt", "gte"]
    threshold: float = Field(ge=40, le=300)
    aggregation: Literal["count_days"]


class HealthRecordQueryPeriod(BaseModel):
    date_from: date
    date_to: date
    timezone: Literal["Asia/Seoul"] = "Asia/Seoul"


class HealthRecordQueryMatch(BaseModel):
    date: date
    value: float


class HealthRecordQueryResult(BaseModel):
    record_type: Literal["blood_pressure"]
    metric: Literal["systolic"]
    unit: Literal["mmHg"] = "mmHg"
    operator: Literal["gt", "gte"]
    threshold: float
    period: HealthRecordQueryPeriod
    matched_days: int = Field(ge=0)
    matched_measurements: int = Field(ge=0)
    total_measurements: int = Field(ge=0)
    latest_matches: list[HealthRecordQueryMatch] = Field(max_length=5)
    empty_reason: Literal["no_records", "no_matches"] | None = None
    message: str
