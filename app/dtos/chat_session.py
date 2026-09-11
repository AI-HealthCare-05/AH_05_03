import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.dtos.base import BaseRequestModel, BaseSerializerModel


class ChatSessionCreateRequest(BaseRequestModel):
    profile_id: str = Field(min_length=1, max_length=100, description="가족 프로필 식별자")
    title: str | None = Field(default=None, max_length=255, description="대화 세션 제목")


class ChatSessionUpdateRequest(BaseRequestModel):
    title: str = Field(min_length=1, max_length=255, description="수정할 대화 세션 제목")


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
    # 구조화 metadata 는 health-assistant 처리 경로만 기록한다. **역할은 둘 다 받는다** —
    # 서류를 확정 저장하는 경로(`HealthAssistantDrawer.handleConfirmOcrModalSave`)는
    # LLM 을 거치지 않고 확인 문장을 그 자리에서 만든다. `user` 만 받던 동안 그 대화는
    # 사용자 줄만 남거나(제목은 생기는데 답이 없다) 아예 저장되지 않았다.
    role: Literal["user", "assistant"] = Field(description="메시지 역할")
    content: str = Field(min_length=1, max_length=10000, description="메시지 내용")


class ChatMessageListData(BaseSerializerModel):
    session_id: uuid.UUID
    items: list[ChatMessageResponse]
