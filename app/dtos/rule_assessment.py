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
    # 규칙 엔진이 다루지 않는 영역. `app/services/lab_staging.py` 가 KDIGO·WHO 기준으로
    # 단계를 매긴다. 벤더 엔진은 이 값을 무시하므로(extra="ignore") 그대로 넘겨도 안전하다.
    creatinine: float | None = Field(default=None, gt=0.1, le=20, description="혈청 크레아티닌 mg/dL")
    urine_acr: float | None = Field(default=None, ge=0, le=20000, description="요알부민/크레아티닌비 mg/g")
    ast: float | None = Field(default=None, gt=0, le=2000, description="AST(SGOT) IU/L")
    alt: float | None = Field(default=None, gt=0, le=2000, description="ALT(SGPT) IU/L")
    ggt: float | None = Field(default=None, gt=0, le=3000, description="감마지티피 IU/L")
    uric_acid: float | None = Field(default=None, gt=0.1, le=30, description="요산 mg/dL")
    hemoglobin: float | None = Field(default=None, gt=3, le=25, description="혈색소 g/dL")

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


class RiskContributor(BaseSerializerModel):
    """질환 위험을 올린 신호 하나와 그 근거."""

    key: str
    label: str
    detail: str = Field(description="어떤 값이 어느 기준을 넘었는지")
    weight: int = Field(description="1=약함 2=중등도 3=강함. 효과크기로 매긴다", ge=1, le=3)
    effect: str = Field(description="상대위험도·위험비 등 보고된 효과크기")
    source: str = Field(description="지침 또는 코호트·메타분석 출처")
    causal: bool | None = Field(
        description=(
            "인과 근거가 있는가. `false`는 '따져봤더니 인과가 아니었다'(예: γ-GTP는 "
            "멘델 무작위화에서 귀무), `null`은 '따로 따져본 적 없다'로 서로 다른 뜻이다."
        )
    )


class DiseaseRiskAssessment(BaseSerializerModel):
    """질환 하나에 대해 여러 수치가 모여 만든 위험. `DomainAssessment`에 근거 목록을 더한 형태."""

    category: str
    risk_level: Literal["INSUFFICIENT_DATA", "NORMAL", "CAUTION", "HIGH", "VERY_HIGH"]
    sub_status: str
    display_label: str
    reason: str
    input_values: dict[str, Any]
    criteria_reference: str
    recommendation: str
    flags: list[str] = []
    missing_fields: list[str] = []
    contributors: list[RiskContributor] = Field(default=[], description="위험을 올린 신호. 센 것부터")
    score: int = Field(description="같은 재료를 두 번 세지 않고 합산한 가중 점수")
    disclaimer: str


class RuleAssessmentData(BaseSerializerModel):
    engine: str = Field(description="판정 엔진 출처")
    domains: dict[str, DomainAssessment]
    evaluated: int = Field(description="판정이 나온 영역 수")
    insufficient: list[str] = Field(description="입력이 부족해 판정하지 못한 영역")
    disease_risks: dict[str, DiseaseRiskAssessment] = Field(
        default={},
        description=(
            "영역 판정의 전치. 영역 판정이 '여러 수치 → 이 장기의 현재 상태'라면 이쪽은 "
            "'수치 하나 → 여러 질환의 앞날'이다. 같은 값이 양쪽에 나올 수 있고 뜻이 다르다."
        ),
    )
