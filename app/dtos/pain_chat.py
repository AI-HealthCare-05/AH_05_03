from typing import Literal

from pydantic import Field

from app.dtos.base import BaseSerializerModel


class PainChatMessage(BaseSerializerModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class PainChatRequest(BaseSerializerModel):
    messages: list[PainChatMessage] = Field(min_length=1, max_length=12)


class PainDraft(BaseSerializerModel):
    body_area: str | None = None
    intensity: int | None = Field(default=None, ge=0, le=10)
    sensation: str | None = None
    onset_description: str | None = None
    aggravating_factors: str | None = None
    note: str | None = None


class PainChatData(BaseSerializerModel):
    assistant_message: str
    draft: PainDraft
    missing_fields: list[str]
    emergency_notice: str | None = None
