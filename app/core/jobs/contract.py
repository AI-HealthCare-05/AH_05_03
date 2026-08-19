"""ai-worker 작업 큐의 전송 계약.

app이 작업을 넣고 ai_worker가 꺼낸다. 두 이미지가 같은 정의를 보게 하려고
계약을 app 아래에 두고, 워커 이미지가 app 패키지를 함께 복사한다.
의존 방향은 ai_worker -> app 한쪽이다. app은 ai_worker를 import하지 않는다.

경계: 검진문서 이미지는 건강정보이고 docs/05_tech_architecture.md 2절이
서버 보관을 금지한다. 그래서 페이로드는 짧은 TTL로만 Redis에 두고 워커가
처리 직후 지운다. 결과 레코드에는 인식된 수치만 남고 원본 이미지는 남지 않는다.
"""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel

from app.core.utils.enums import StrEnum

#: 워커들이 공유하는 소비자 그룹. 그룹이 하나라서 한 작업은 한 워커만 집는다.
CONSUMER_GROUP = "ai-worker"


class TaskName(StrEnum):
    OCR_EXTRACT = "ocr.extract"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"

    @property
    def is_terminal(self) -> bool:
        return self in (JobStatus.SUCCEEDED, JobStatus.FAILED)


class JobRecord(BaseModel):
    """작업 하나의 현재 상태. 폴링 응답의 원본이다."""

    job_id: uuid.UUID
    task: TaskName
    status: JobStatus
    #: 작업을 넣은 계정. 결과에 건강정보가 들어가므로 조회할 때 이 값을 대조한다.
    #: job_id가 UUID4라 추측이 어렵긴 해도, 그것만을 권한으로 삼지는 않는다.
    owner_account_id: uuid.UUID
    #: 워커가 이 작업을 집어든 횟수. 워커가 죽어 재배달될 때마다 늘어난다.
    attempts: int = 0
    #: 성공했을 때만 채워진다. 태스크별 결과 스키마는 호출자가 검증한다.
    result: dict[str, Any] | None = None
    error_code: str | None = None
    error_message: str | None = None


class JobKeys:
    """키 조립만 담당한다. 접두사는 앱과 Redis 네임스페이스를 공유한다."""

    def __init__(self, prefix: str) -> None:
        self._prefix = prefix

    @property
    def stream(self) -> str:
        return f"{self._prefix}:jobs:stream"

    def payload(self, job_id: uuid.UUID) -> str:
        return f"{self._prefix}:jobs:payload:{job_id}"

    def record(self, job_id: uuid.UUID) -> str:
        return f"{self._prefix}:jobs:record:{job_id}"
