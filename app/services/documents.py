"""검진문서 OCR 서비스.

경계: 원본 파일과 인식 원문을 보관하지 않고 수치 후보만 돌려준다.
사용자가 검수·확정한 값을 어디에 기록할지는 호출자가 결정한다.

인식은 ai-worker가 큐로 받아 수행한다. 그래서 검증과 인식이 나뉜다.
- validate()는 API가 큐에 넣기 전에 호출한다. 못 쓸 파일을 워커까지
  보내지 않고 업로드 시점에 곧바로 거절한다.
- extract()는 워커가 호출한다. 이미 검증된 바이트만 들어온다.
"""

from __future__ import annotations

import time
from datetime import date

from app.dtos.documents import OcrExtractionData, OcrRowData
from app.exceptions import (
    DocumentResolutionTooLowError,
    DocumentTooLargeError,
    DocumentUnsupportedTypeError,
    OcrNoResultError,
    OcrUnavailableError,
)
from app.services.ocr import DEFAULT_REVIEW_THRESHOLD, RapidOcrEngine, extract_rows, find_measured_date

#: 업로드 상한. API 설계서 9-1이 20MB로 잡았다.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024

ALLOWED_CONTENT_TYPES = frozenset({"image/jpeg", "image/jpg", "image/png", "image/webp"})

#: 짧은 변 최소 픽셀. 실측 근거:
#:   2100x1500 합성본 → 9/9 인식
#:    600x832  저해상도 스캔 → 사전 14개 중 0개
#: 인식 가치가 없는 해상도는 시도하지 않고 재촬영을 요청한다.
MIN_SHORT_EDGE = 900


class DocumentOcrService:
    """FastAPI 의존성으로 주입해 쓴다."""

    def __init__(self) -> None:
        self._engine = RapidOcrEngine()

    async def extract(self, *, content: bytes) -> OcrExtractionData:
        started = time.perf_counter()
        try:
            tokens = await self._engine.recognize(content)
        except Exception as exc:  # noqa: BLE001 - 엔진 내부 오류를 계약된 코드로 바꾼다
            raise OcrUnavailableError from exc
        elapsed_ms = int((time.perf_counter() - started) * 1000)

        rows = extract_rows(tokens, review_threshold=DEFAULT_REVIEW_THRESHOLD)
        if not rows:
            raise OcrNoResultError

        measured = find_measured_date(tokens)
        return OcrExtractionData(
            engine=self._engine.id,
            engine_version=self._engine.version,
            measured_date=date.fromisoformat(measured) if measured else None,
            rows=[
                OcrRowData(
                    item_code=r.item_code,
                    item_label=r.item_label,
                    raw_label=r.raw_label,
                    value=r.value,
                    raw_value=r.raw_value,
                    unit=r.unit,
                    reference=r.reference,
                    confidence=r.confidence,
                    needs_review=r.needs_review,
                    signals=r.signals,
                )
                for r in rows
            ],
            auto_confirmable=sum(1 for r in rows if not r.needs_review),
            needs_review=sum(1 for r in rows if r.needs_review),
            elapsed_ms=elapsed_ms,
        )

    @staticmethod
    def validate(*, content: bytes, content_type: str | None) -> None:
        if (content_type or "").split(";")[0].strip().lower() not in ALLOWED_CONTENT_TYPES:
            raise DocumentUnsupportedTypeError
        if len(content) > MAX_UPLOAD_BYTES:
            raise DocumentTooLargeError
        if not content:
            raise DocumentUnsupportedTypeError

        short_edge = _short_edge(content)
        if short_edge is not None and short_edge < MIN_SHORT_EDGE:
            raise DocumentResolutionTooLowError(
                (f"이미지의 짧은 변이 {short_edge}px입니다. {MIN_SHORT_EDGE}px 이상으로 다시 촬영해 주세요."),
            )


def _short_edge(content: bytes) -> int | None:
    """헤더만 읽어 짧은 변 길이를 구한다. 못 읽으면 None."""
    try:
        import cv2
        import numpy as np

        array = np.frombuffer(content, dtype=np.uint8)
        image = cv2.imdecode(array, cv2.IMREAD_REDUCED_COLOR_8)
        if image is None:
            return None
        # IMREAD_REDUCED_COLOR_8은 1/8로 줄여 디코딩한다. 원본 크기로 되돌린다.
        height, width = image.shape[:2]
        return min(height, width) * 8
    except Exception:  # noqa: BLE001 - 크기를 못 재는 것이 업로드를 막을 이유는 아니다
        return None
