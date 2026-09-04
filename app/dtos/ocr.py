from app.dtos.base import BaseSerializerModel


class OcrTableData(BaseSerializerModel):
    table_index: int
    rows: list[list[str]]


class OcrMeasurementRow(BaseSerializerModel):
    """표에서 읽어 낸 행 하나. 화면이 원본과 대조할 수 있게 `source` 를 같이 준다."""

    field: str
    label: str
    value: float
    unit: str
    source: list[str]
    reason: str | None = None


class OcrMeasurements(BaseSerializerModel):
    """`tables` 를 예측 입력 수치로 옮긴 결과. 판정 근거는 `ocr_measurements.py` 에 있다.

    **`values` 만 예측에 쓴다.** `review` 는 단위·참고치·범위 관문에 걸린 행이라
    사용자가 눈으로 확인하기 전에는 수치로 취급하지 않는다.
    """

    values: dict[str, float] = {}
    review: list[OcrMeasurementRow] = []
    unused: list[OcrMeasurementRow] = []
    unmatched: list[list[str]] = []


class OcrDocumentContent(BaseSerializerModel):
    """**공급자에게 강제하는 스키마.** 여기 있는 것만 모델이 만든다.

    `RawOcrData` 를 그대로 쓰면 모델에게 `status`·`automatically_confirmed` 까지
    채우라고 요구하게 된다 — 서버가 정하는 값이라 모델이 알 수 없고,
    OpenAI strict 모드는 "속성 전부 required" 라 그 칸을 억지로 채우게 만든다.
    `measurements` 는 더더욱 모델이 만들 것이 아니다(표를 우리가 다시 읽어서 만든다).
    """

    text: str
    tables: list[OcrTableData]


class RawOcrData(OcrDocumentContent):
    """API 가 돌려주는 모양. 아래 셋은 **서버가 채운다.**"""

    status: str = "raw"
    automatically_confirmed: bool = False
    measurements: OcrMeasurements | None = None


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
