"""예측 작업 큐의 응답 DTO.

`result` 를 `RiskPredictionData` 로 타입 지정하지 않고 `dict` 로 둔 이유가 있다. 워커가
JSON 문자열로 써 둔 값을 그대로 흘려보내면 **동기 경로와 한 글자도 다르지 않다**는 것이
보장된다. 여기서 다시 파싱해 모델로 검증하면 워커 시점과 조회 시점의 스키마가 다를 때
조용히 필드가 사라진다. 큐는 시간 차가 있는 경로라 그 위험이 실재한다.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import Field

from app.core.jobs.contract import (
    FIELD_ATTEMPTS,
    FIELD_CREATED_AT,
    FIELD_ERROR,
    FIELD_FINISHED_AT,
    FIELD_RESULT,
    FIELD_STARTED_AT,
    FIELD_STATUS,
    FIELD_WORKER,
    TERMINAL_STATUSES,
)
from app.dtos.base import BaseSerializerModel

JobStatusLiteral = Literal["queued", "running", "succeeded", "failed"]


class PredictionJobAccepted(BaseSerializerModel):
    job_id: str = Field(description="무작위 UUID. 계정을 되짚을 수 없다")
    status: JobStatusLiteral
    poll_after_ms: int = Field(description="이만큼 기다린 뒤 상태를 조회하면 된다")
    expires_in_seconds: int = Field(description="작업 해시가 사라지는 시각까지")


class PredictionJobState(BaseSerializerModel):
    job_id: str
    status: JobStatusLiteral
    attempts: int = Field(default=0, description="워커가 집어 든 횟수. 재시도가 있었으면 1보다 크다")
    worker: str | None = Field(default=None, description="처리한 워커 식별자. 3대 중 어디였는지 보인다")
    created_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    poll_after_ms: int | None = Field(default=None, description="아직 안 끝났으면 이만큼 뒤에 다시")
    error: str | None = None
    result: dict[str, Any] | None = Field(
        default=None, description="동기 경로 `/predictions/risk` 의 data 와 같은 모양"
    )

    @classmethod
    def from_fields(cls, job_id: str, fields: dict[str, str]) -> PredictionJobState:
        status = fields.get(FIELD_STATUS, "queued")
        raw_result = fields.get(FIELD_RESULT)
        return cls(
            job_id=job_id,
            status=status,  # type: ignore[arg-type]
            attempts=int(fields.get(FIELD_ATTEMPTS) or 0),
            worker=fields.get(FIELD_WORKER),
            created_at=fields.get(FIELD_CREATED_AT),
            started_at=fields.get(FIELD_STARTED_AT),
            finished_at=fields.get(FIELD_FINISHED_AT),
            poll_after_ms=None if status in TERMINAL_STATUSES else 200,
            error=fields.get(FIELD_ERROR),
            result=json.loads(raw_result) if raw_result else None,
        )
