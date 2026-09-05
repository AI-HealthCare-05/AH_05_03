import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.dtos.base import BaseRequestModel, BaseSerializerModel


class ChatSessionCreateRequest(BaseRequestModel):
    profile_id: str = Field(min_length=1, max_length=100, description="가족 프로필 식별자")
    title: str | None = Field(default=None, max_length=255, description="대화 세션 제목")


class ChatSessionResponse(BaseSerializerModel):
    id: uuid.UUID
    account_id: uuid.UUID
    profile_id: str
    title: str | None = None
    created_at: datetime
    updated_at: datetime


class ChatSessionListData(BaseSerializerModel):
    items: list[ChatSessionResponse]
    total: int


class ChatMessageResponse(BaseSerializerModel):
    id: uuid.UUID
    session_id: uuid.UUID
    role: str
    content: str
    metadata: dict[str, Any] | None = Field(default=None, validation_alias="metadata_")
    sequence_number: int
    created_at: datetime


class ChatMessageCreateRequest(BaseRequestModel):
    # assistant 응답과 구조화 metadata는 health-assistant 처리 경로만 기록한다.
    role: Literal["user"] = Field(description="사용자 메시지 역할")
    content: str = Field(min_length=1, max_length=10000, description="메시지 내용")


class ChatMessageListData(BaseSerializerModel):
    session_id: uuid.UUID
    items: list[ChatMessageResponse]
