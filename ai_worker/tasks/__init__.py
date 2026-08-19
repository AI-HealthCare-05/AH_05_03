"""워커가 처리하는 작업 종류.

작업을 추가하려면 핸들러를 만들고 REGISTRY에 등록한다. 핸들러는 페이로드
바이트를 받아 JSON으로 직렬화되는 dict를 돌려준다. 실패는 AppError로
올려야 오류 코드가 그대로 클라이언트까지 전달된다.
"""

from collections.abc import Awaitable, Callable
from typing import Any

from ai_worker.tasks.ocr import extract_checkup_values
from app.core.jobs import TaskName

TaskHandler = Callable[[bytes], Awaitable[dict[str, Any]]]

REGISTRY: dict[TaskName, TaskHandler] = {
    TaskName.OCR_EXTRACT: extract_checkup_values,
}

__all__ = ["REGISTRY", "TaskHandler"]
