from app.dtos.base import BaseSerializerModel


class OcrTableData(BaseSerializerModel):
    table_index: int
    rows: list[list[str]]


class RawOcrData(BaseSerializerModel):
    text: str
    tables: list[OcrTableData]
    exam_date: str | None = None
    status: str = "raw"
    automatically_confirmed: bool = False

