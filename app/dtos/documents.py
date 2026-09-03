import uuid
from datetime import date

from pydantic import Field

from app.core.jobs import JobStatus
from app.dtos.base import BaseSerializerModel


class OcrRowData(BaseSerializerModel):
    """인식된 검사 항목 한 줄. 확정 전 후보값이다."""

    #: 표준 항목 코드. 항목을 특정하지 못하면 null이고 사용자가 골라야 한다.
    item_code: str | None
    item_label: str | None
    #: OCR이 읽은 라벨 원문. 한글이 깨져 있을 수 있어 검수 화면에서 참고용으로 보여준다.
    raw_label: str
    value: float | None
    raw_value: str | None
    unit: str | None
    reference: str | None
    #: 0~1
    confidence: float
    #: true면 화면에서 "확인 필요"로 표시하고 사용자 확인 없이 쓰지 않는다.
    needs_review: bool
    #: 항목을 무엇으로 특정했는지 (label·latin·reference·unit)
    signals: list[str]


class OcrExtractionData(BaseSerializerModel):
    """인식 결과 전체.

    서버는 이 응답을 만든 뒤 업로드된 이미지를 즉시 버린다. 원본 파일과
    인식 원문을 보관하지 않는다.
    """

    engine: str
    engine_version: str
    #: 문서에서 읽어낸 검진일. 못 읽으면 null이고 사용자가 입력한다.
    measured_date: date | None
    rows: list[OcrRowData]
    #: 신뢰도 임계값을 넘겨 사용자 확인 없이 쓸 수 있는 행 수
    auto_confirmable: int
    #: 사용자 확인이 필요한 행 수
    needs_review: int
    elapsed_ms: int
    #: 응답을 만든 뒤 원본 이미지를 폐기했는지. 항상 true이며 계약을 명시하기 위해 싣는다.
    image_discarded: bool = Field(default=True)


class OcrJobData(BaseSerializerModel):
    """인식 작업의 현재 상태.

    업로드는 작업을 큐에 넣고 곧바로 돌아온다. 결과는 이 응답의 job_id로
    폴링해서 받는다. status가 succeeded면 result가, failed면 error_code가 찬다.
    """

    job_id: uuid.UUID
    status: JobStatus
    #: 인식이 끝났을 때만 채워진다.
    result: OcrExtractionData | None = None
    #: 실패했을 때만 채워진다. 값은 오류 봉투의 error_code와 같은 집합이다.
    error_code: str | None = None
    error_message: str | None = None
