"""식약처 의약품 정보 및 DUR 품목정보 조회 결과 DTO."""

from __future__ import annotations

from pydantic import BaseModel, Field


class DurItem(BaseModel):
    """DUR 금기 항목 하나."""

    prohibition_type: str = Field(description="DUR 금기 유형 (연령금기, 임부금기, 노인주의, 용량주의 등)")
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


class DrugInteractionItem(BaseModel):
    """두 의약품 간의 DUR 병용금기 정보."""

    drug_a: str = Field(description="기준 의약품명")
    drug_b: str = Field(description="병용금기 상대 의약품명")
    ingredient_a: str | None = Field(default=None, description="기준 의약품 성분명")
    ingredient_b: str | None = Field(default=None, description="상대 의약품 성분명")
    prohibition_content: str = Field(description="병용금기 사유 및 부작용 내용")
    type_name: str = Field(default="병용금기", description="금기 구분명")


class MedicationSearchResult(BaseModel):
    """의약품 검색 종합 결과."""

    query: str = Field(description="검색 질의어")
    items: list[DrugInfo] = Field(default_factory=list, description="검색된 의약품 목록")
    interaction_items: list[DrugInteractionItem] = Field(
        default_factory=list, description="두 약품 간의 DUR 병용금기 항목 목록"
    )
    has_interaction_danger: bool = Field(default=False, description="병용금기 해당 여부")
    target_drug_name: str | None = Field(default=None, description="병용 확인 대상 의약품명")
    message: str = Field(default="", description="사용자에게 전달할 요약 안내 메시지")
    errors: list[str] = Field(default_factory=list, description="조회 중 발생한 오류 목록")
