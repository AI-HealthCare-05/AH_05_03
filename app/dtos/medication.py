"""식약처 의약품 정보 및 DUR 병용금기 조회 결과 DTO."""

from __future__ import annotations

from pydantic import BaseModel, Field


class DurItem(BaseModel):
    """DUR 금기 항목 하나."""

    prohibition_type: str = Field(description="금기 유형 (병용금기, 연령금기, 임부금기, 노인주의 등)")
    ingredient_name: str | None = Field(default=None, description="금기 상대 성분명")
    reason: str | None = Field(default=None, description="금기 사유 설명")


class DrugInfo(BaseModel):
    """단일 의약품의 기본 정보."""

    item_name: str = Field(description="품목명 (예: 타이레놀정500밀리그람)")
    entp_name: str | None = Field(default=None, description="제조/수입사명")
    class_name: str | None = Field(default=None, description="분류명 (예: 해열·진통·소염제)")
    efcy_qesitm: str | None = Field(default=None, description="효능·효과")
    use_method_qesitm: str | None = Field(default=None, description="용법·용량")
    atpn_warn_qesitm: str | None = Field(default=None, description="경고 주의사항")
    atpn_qesitm: str | None = Field(default=None, description="사용 시 주의사항")
    intrc_qesitm: str | None = Field(default=None, description="상호작용")
    se_qesitm: str | None = Field(default=None, description="부작용")
    deposit_method_qesitm: str | None = Field(default=None, description="보관 방법")
    dur_items: list[DurItem] = Field(default_factory=list, description="DUR 금기 항목 목록")


class MedicationSearchResult(BaseModel):
    """의약품 검색 종합 결과."""

    query: str = Field(description="검색 질의어")
    items: list[DrugInfo] = Field(default_factory=list, description="검색된 의약품 목록")
    message: str = Field(default="", description="사용자에게 전달할 요약 안내 메시지")
    errors: list[str] = Field(default_factory=list, description="조회 중 발생한 오류 목록")

