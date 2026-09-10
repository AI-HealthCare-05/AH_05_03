from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class HealthKnowledgeItem(BaseModel):
    source: Literal["질병관리청 국가건강정보포털"] = "질병관리청 국가건강정보포털"
    title: str
    url: str = Field(pattern=r"^https://health\.kdca\.go\.kr/")
    summary: str = Field(description="공식 원문에서 확인해 고정한 비변형 요약")
    topics: list[str]
    content_updated_at: str | None = None


class HealthKnowledgeSearchResult(BaseModel):
    query: str
    items: list[HealthKnowledgeItem]
    retrieved_at: datetime
    message: str
    errors: list[str] = Field(default_factory=list)
