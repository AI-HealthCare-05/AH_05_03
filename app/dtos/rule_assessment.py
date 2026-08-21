"""규칙 기반 만성질환 판정 요청·응답 DTO.

판정 로직은 `chronic_disease_engine`(PR #4, ts04042-cell)이 담당하고 이 모듈은
API 경계만 만든다. 엔진 코드는 손대지 않는다 —
`chronic_disease_engine/PROVENANCE.md` 참조.

요청 스키마를 엔진의 `HealthProfileInput`을 그대로 노출하지 않고 여기에 다시 쓴 이유는
두 가지다. 첫째, 우리 API 규약은 정의되지 않은 필드를 거부한다(`extra="forbid"`).
엔진은 `extra="ignore"`다. 둘째, OpenAPI 문서에 단위와 설명이 필요하다.

베껴 쓴 대가로 드리프트 위험이 생기므로 `test_rule_assessment_apis.py`가 필드 이름이
엔진 스키마의 부분집합인지 검사한다.
"""

from typing import Any, Literal

from pydantic import Field, model_validator

from app.dtos.base import BaseRequestModel, BaseSerializerModel


class RuleAssessmentRequest(BaseRequestModel):
    """모든 항목이 선택이다. 각 규칙은 자기에게 필요한 값이 있는 만큼만 판정한다."""

    # --- 기본 ---------------------------------------------------------
    sex: Literal["M", "F"] | None = None
    age: int | None = Field(default=None, ge=1, le=120)

    # --- 신체 ---------------------------------------------------------
    height_cm: float | None = Field(default=None, gt=30, le=250)
    weight_kg: float | None = Field(default=None, gt=2, le=300)
    waist_cm: float | None = Field(default=None, gt=30, le=250, description="비만 판정에 사용")
    bmi: float | None = Field(default=None, gt=5, le=80, description="비우면 키·체중으로 계산")

    # --- 혈압 (mmHg) --------------------------------------------------
    systolic_bp: float | None = Field(default=None, gt=40, le=300)
    diastolic_bp: float | None = Field(default=None, gt=20, le=200)

    # --- 혈당 ---------------------------------------------------------
    fasting_glucose: float | None = Field(default=None, gt=20, le=600, description="mg/dL")
    hba1c: float | None = Field(default=None, gt=2.0, le=20.0, description="%")
    ogtt_2h: float | None = Field(default=None, gt=20, le=600, description="경구당부하 2시간, mg/dL")
    is_fasting: bool | None = Field(default=None, description="fasting_glucose가 공복 측정인지")

    # --- 지질 (mg/dL) -------------------------------------------------
    total_cholesterol: float | None = Field(default=None, gt=0, le=1000)
    ldl_c: float | None = Field(default=None, gt=0, le=1000)
    hdl_c: float | None = Field(default=None, gt=0, le=1000)
    triglycerides: float | None = Field(default=None, gt=0, le=2000)
    non_hdl_c: float | None = Field(default=None, gt=0, le=1000, description="비우면 총콜레스테롤-HDL로 계산")

    # --- 심혈관 위험요인 ----------------------------------------------
    smoking: bool | None = None
    has_diabetes: bool | None = None
    has_hypertension: bool | None = None
    has_ascvd_history: bool | None = Field(default=None, description="동맥경화성 심혈관질환 병력")

    @model_validator(mode="after")
    def check_blood_pressure(self) -> "RuleAssessmentRequest":
        # 엔진도 같은 검사를 하지만 그쪽 ValueError는 500으로 새어 나간다.
        # 경계에서 막아 422 봉투로 돌려준다.
        if self.systolic_bp is not None and self.diastolic_bp is not None:
            if self.systolic_bp <= self.diastolic_bp:
                raise ValueError("수축기 혈압은 이완기 혈압보다 커야 합니다.")
        return self

    def to_profile(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class DomainAssessment(BaseSerializerModel):
    """엔진의 `DomainResult`를 그대로 옮긴 응답 형태."""

    category: str
    risk_level: Literal["INSUFFICIENT_DATA", "NORMAL", "CAUTION", "HIGH", "VERY_HIGH"]
    sub_status: str = Field(description="의학적 구간 표기. 예: 고혈압 1기")
    display_label: str
    reason: str
    input_values: dict[str, Any]
    criteria_reference: str = Field(description="적용한 국내 학회 지침")
    recommendation: str
    flags: list[str] = []
    missing_fields: list[str] = []
    disclaimer: str


class RuleAssessmentData(BaseSerializerModel):
    engine: str = Field(description="판정 엔진 출처")
    domains: dict[str, DomainAssessment]
    evaluated: int = Field(description="판정이 나온 영역 수")
    insufficient: list[str] = Field(description="입력이 부족해 판정하지 못한 영역")
