"""OCR 엔진 어댑터.

엔진은 교체 대상이다. 세 후보를 실측한 결과가 아래와 같아서 RapidOCR을 골랐다.

| 항목 | Tesseract | RapidOCR | PaddleOCR(korean) |
|---|---|---|---|
| 수치 9개 | 7/9 | **9/9 (conf 1.00)** | 9/9 |
| 한글 라벨 | 6/9 | 0/9 | 0/9 (빈 문자열) |
| `HDL-`/`LDL-` | 실패 | **성공** | 성공 |
| 속도 | ~4s | **~1.8s** | ~16s |
| 설치 | 7MB | ~50MB | 186MB+ |

RapidOCR의 한글 약점은 lexicon.py가 라틴 접두사·단위·참고치로 보완한다.
PaddleOCR은 한글 약점이 같은데 9배 느리고 4배 커서 채택하지 않았다.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol


@dataclass(frozen=True)
class OcrToken:
    """인식된 텍스트 조각 하나."""

    text: str
    #: 0~1
    confidence: float
    left: float
    right: float
    top: float
    bottom: float

    @property
    def center_y(self) -> float:
        return (self.top + self.bottom) / 2

    @property
    def height(self) -> float:
        return self.bottom - self.top


class OcrEngine(Protocol):
    """이 모양만 지키면 엔진을 바꿔 끼울 수 있다."""

    id: str
    version: str

    async def recognize(self, image: bytes) -> list[OcrToken]: ...


class RapidOcrEngine:
    """RapidOCR(PP-OCR ONNX) 어댑터.

    모델이 패키지에 동봉돼 있어 런타임 다운로드가 없다. 컨테이너 안에서
    외부 네트워크를 타지 않으므로 빌드 시점에 모든 것이 확정된다.
    """

    id = "rapidocr-onnxruntime"

    def __init__(self) -> None:
        self.version = _rapidocr_version()

    async def recognize(self, image: bytes) -> list[OcrToken]:
        # RapidOCR은 동기 · CPU 바운드다. 이벤트 루프를 막지 않도록 스레드로 보낸다.
        return await asyncio.to_thread(self._recognize_sync, image)

    def _recognize_sync(self, image: bytes) -> list[OcrToken]:
        # RapidOCR의 LoadImage가 bytes를 그대로 받는다. numpy로 감싸면
        # 1차원 버퍼로 보여 "ndim(1) of the img is not in [2, 3]"으로 죽는다.
        engine = _get_engine()
        result, _ = engine(image)
        if not result:
            return []

        tokens: list[OcrToken] = []
        for box, text, score in result:
            cleaned = (text or "").strip()
            if not cleaned:
                continue
            xs = [float(p[0]) for p in box]
            ys = [float(p[1]) for p in box]
            tokens.append(
                OcrToken(
                    text=cleaned,
                    confidence=float(score),
                    left=min(xs),
                    right=max(xs),
                    top=min(ys),
                    bottom=max(ys),
                )
            )
        return tokens


@lru_cache(maxsize=1)
def _get_engine():  # type: ignore[no-untyped-def]
    """엔진 인스턴스는 무겁다. 프로세스당 한 번만 만든다."""
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR()


def _rapidocr_version() -> str:
    try:
        from importlib.metadata import version

        return version("rapidocr-onnxruntime")
    except Exception:  # pragma: no cover - 버전 조회 실패가 기능을 막지는 않는다
        return "unknown"
