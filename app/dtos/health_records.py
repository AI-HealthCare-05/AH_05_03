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
    source_document_id: str | None = Field(
        default=None,
        max_length=64,
        description=(
            "이 기록을 채운 원본 서류의 id. 실물은 브라우저 보관함에 있으므로 서버는 "
            "id 만 들고 있다 — 올린 기기에서만 열린다"
        ),
    )
    note: str | None = Field(default=None, description="메모")


class HealthRecordUpdateRequest(BaseRequestModel):
    record_type: str | None = Field(default=None, min_length=1, max_length=50)
    recorded_at: datetime | None = None
    source: str | None = Field(default=None, max_length=30)
    payload: dict[str, Any] | None = None
    source_document_id: str | None = Field(default=None, max_length=64)
    note: str | None = None
    status: str | None = None


class HealthRecordData(BaseSerializerModel):
    id: uuid.UUID
    profile_id: uuid.UUID
    record_type: str
    recorded_at: datetime
    source: str
    payload: dict[str, Any]
    source_document_id: str | None = None
    note: str | None = None
    status: str
    row_version: int
    created_at: datetime
    updated_at: datetime


class HealthRecordListData(BaseSerializerModel):
    items: list[HealthRecordData]
    total: int


class PrefilledFieldData(BaseSerializerModel):
    """판정 폼 칸 하나와 그 값의 출처."""

    field: str = Field(description="판정 폼 입력 이름 (예: sbp, fasting_glucose)")
    value: float = Field(description="옮긴 값. DTO 허용 범위를 통과한 것만 온다")
    measured_at: str = Field(description="그 값을 잰 시각. **화면이 반드시 같이 보여야 한다**")
    record_type: str = Field(description="어느 기록에서 왔는가")
    record_id: str | None = Field(default=None, description="그 기록의 id. 원본으로 되짚을 고리")


class HealthRecordPrefillData(BaseSerializerModel):
    """남긴 기록으로 판정 폼을 채운 결과.

    비어 있을 수 있다 — 수치 기록이 없거나, 있어도 관문을 통과하지 못한 경우다
    (`app/services/record_prefill.py`). 그때 화면은 "채울 것이 없다" 를 말해야 한다.
    """

    items: list[PrefilledFieldData]
    #: 훑어본 기록 수. 0 이면 "기록이 없다", 0 이 아닌데 `items` 가 비면 "옮길 수치가
    #: 없다" 다 — 화면에서 두 상황의 문구가 달라야 한다.
    scanned: int


class HealthRecordValuesData(BaseSerializerModel):
    """기록 **하나**의 판정 칸 값.

    `HealthRecordPrefillData` 와 다른 이유는 고르는 방식이다. 그쪽은 여러 기록에서
    칸마다 가장 최근 것 하나를 뽑으므로, 특정 기록의 값이 더 새 기록에 가려 안 나올
    수 있다. 검진표 하나를 열어 고치는 화면은 **그 기록에 담긴 것만** 봐야 한다.

    사전(표기 100개 → 판정 칸 20개)이 서버에만 있으므로 이 길이 필요하다. 클라이언트가
    직접 풀면 같은 판단이 두 곳에 살고 한쪽만 고쳐진다(AGENTS.md §2-5).
    """

    record_id: uuid.UUID
    record_type: str
    #: 판정 칸 이름 → 값. 비어 있을 수 있다(수치가 없는 종류이거나 관문을 못 넘은 것).
    values: dict[str, float]


class HealthRecordSyncItem(BaseRequestModel):
    id: uuid.UUID
    profile_id: uuid.UUID
    record_type: str = Field(..., min_length=1, max_length=50)
    recorded_at: datetime
    source: str = "manual"
    payload: dict[str, Any]
    source_document_id: str | None = None
    note: str | None = None
    status: str = "active"
    row_version: int = 1


class HealthRecordSyncRequest(BaseRequestModel):
    records: list[HealthRecordSyncItem]
