"""검진문서 OCR 작업.

인식 로직은 app.services.documents가 정본이고 워커는 그것을 호출만 한다.
같은 코드를 두 벌 두면 API 응답과 워커 결과가 갈라진다.

무거운 쪽은 RapidOCR 추론이고 CPU 바운드다. 엔진이 프로세스당 하나뿐이라
동시 처리량을 늘리는 방법은 워커 컨테이너를 늘리는 것이다.
"""

from __future__ import annotations

from typing import Any

from app.services.documents import DocumentOcrService

_service = DocumentOcrService()


async def extract_checkup_values(payload: bytes) -> dict[str, Any]:
    data = await _service.extract(content=payload)
    # date를 그대로 두면 JSON 직렬화에서 죽는다.
    return data.model_dump(mode="json")
