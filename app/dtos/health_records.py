import uuid
from datetime import datetime
from typing import Any

from pydantic import Field

from app.dtos.base import BaseRequestModel, BaseSerializerModel


class HealthRecordCreateRequest(BaseRequestModel):
    id: uuid.UUID | None = Field(default=None, description="클라이언트 생성 UUID (선택)")
    profile_id: uuid.UUID = Field(..., description="가족 프로필 ID")
    record_type: str = Field(..., min_length=1, max_length=50, description="기록 유형")
    recorded_at: datetime = Field(..., description="측정/기록 일시")
    source: str = Field(default="manual", max_length=30, description="출처")
    payload: dict[str, Any] = Field(..., description="기록 상세 데이터")
    note: str | None = Field(default=None, description="메모")


class HealthRecordUpdateRequest(BaseRequestModel):
    record_type: str | None = Field(default=None, min_length=1, max_length=50)
    recorded_at: datetime | None = None
    source: str | None = Field(default=None, max_length=30)
    payload: dict[str, Any] | None = None
    note: str | None = None
    status: str | None = None


class HealthRecordData(BaseSerializerModel):
    id: uuid.UUID
    profile_id: uuid.UUID
    record_type: str
    recorded_at: datetime
    source: str
    payload: dict[str, Any]
    note: str | None = None
    status: str
    row_version: int
    created_at: datetime
    updated_at: datetime


class HealthRecordListData(BaseSerializerModel):
    items: list[HealthRecordData]
    total: int


class HealthRecordSyncItem(BaseRequestModel):
    id: uuid.UUID
    profile_id: uuid.UUID
    record_type: str = Field(..., min_length=1, max_length=50)
    recorded_at: datetime
    source: str = "manual"
    payload: dict[str, Any]
    note: str | None = None
    status: str = "active"
    row_version: int = 1


class HealthRecordSyncRequest(BaseRequestModel):
    records: list[HealthRecordSyncItem]
