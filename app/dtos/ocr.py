from app.dtos.base import BaseSerializerModel


class OcrTableData(BaseSerializerModel):
    table_index: int
    rows: list[list[str]]


class RawOcrData(BaseSerializerModel):
    text: str
    tables: list[OcrTableData]
    status: str = "raw"
    automatically_confirmed: bool = False


class OcrJobAcceptedData(BaseSerializerModel):
    """큐에 실었다는 응답. 결과는 폴링으로 받는다."""

    job_id: str
    status: str
    poll_after_ms: int


class OcrJobStatusData(BaseSerializerModel):
    """작업 상태. **원본은 절대 실리지 않는다** — 저장소가 payload 를 빼고 준다."""

    job_id: str
    status: str
    created_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    attempts: int = 0
    error: str | None = None
    result: RawOcrData | None = None
