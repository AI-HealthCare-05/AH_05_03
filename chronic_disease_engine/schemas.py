"""
만성질환 건강위험 판단 엔진의 공통 Enum 및 Pydantic 입출력 스키마.

"""
from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

COMMON_DISCLAIMER = (
    "본 결과는 입력된 건강정보를 기반으로 한 참고용 건강위험 정보이며, "
    "의료적 진단을 대신하지 않습니다. 정확한 판단과 상담은 의료기관을 이용해 주세요."
)

ADULT_CRITERIA_NOTICE = (
    "본 판단 기준은 만 19세 이상 성인을 대상으로 하며, 소아청소년은 별도의 기준이 필요하므로 "
    "참고용으로만 확인하시기 바랍니다."
)


class RiskLevel(str, Enum):
    """4개 건강영역 공통 위험 수준.

    공식적인 의학적 진단 분류가 아니라, 입력값과 의학적 기준을 비교하여 산출한
    참고용 건강위험 및 관리 필요 수준이다. 실제 의학적 구간(예: '고혈압 1기')은
    각 Rule 결과의 sub_status에 별도로 표시한다.
    """

    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    NORMAL = "NORMAL"
    CAUTION = "CAUTION"
    HIGH = "HIGH"
    VERY_HIGH = "VERY_HIGH"


_RISK_ORDER = [
    RiskLevel.NORMAL,
    RiskLevel.CAUTION,
    RiskLevel.HIGH,
    RiskLevel.VERY_HIGH,
]


def higher_risk(a: RiskLevel, b: RiskLevel) -> RiskLevel:
    """두 RiskLevel 중 더 위험한 쪽을 반환한다 (INSUFFICIENT_DATA는 비교 대상에서 제외)."""
    if a == RiskLevel.INSUFFICIENT_DATA:
        return b
    if b == RiskLevel.INSUFFICIENT_DATA:
        return a
    return a if _RISK_ORDER.index(a) >= _RISK_ORDER.index(b) else b


class Sex(str, Enum):
    MALE = "M"
    FEMALE = "F"


class HealthProfileInput(BaseModel):
    """사용자 건강정보 입력 스키마.

    모든 필드는 선택(Optional)이며, 각 Rule은 자신의 평가에 필요한 값이 존재하는
    만큼만 독립적으로 평가를 수행한다. 여기서 적용하는 검증(validation)은 값이
    기술적으로 유효한 범위인지만 확인하는 것이며, 건강위험 분류 기준(threshold)과는
    별개의 개념이다.
    """

    model_config = ConfigDict(extra="ignore")

    # 기본정보
    sex: Optional[Sex] = None
    age: Optional[int] = Field(default=None, ge=1, le=120)

    # 신체정보
    height_cm: Optional[float] = Field(default=None, gt=30, le=250)
    weight_kg: Optional[float] = Field(default=None, gt=2, le=300)
    waist_cm: Optional[float] = Field(default=None, gt=30, le=250)
    bmi: Optional[float] = Field(
        default=None, gt=5, le=80, description="미입력 시 height_cm/weight_kg로 자동 계산"
    )

    # 혈압 (mmHg)
    systolic_bp: Optional[float] = Field(default=None, gt=40, le=300)
    diastolic_bp: Optional[float] = Field(default=None, gt=20, le=200)

    # 혈당
    fasting_glucose: Optional[float] = Field(default=None, gt=20, le=600)
    hba1c: Optional[float] = Field(default=None, gt=2.0, le=20.0)
    ogtt_2h: Optional[float] = Field(default=None, gt=20, le=600)
    is_fasting: Optional[bool] = Field(
        default=None, description="fasting_glucose 측정이 공복 상태에서 이루어졌는지 여부"
    )

    # 지질 (mg/dL)
    total_cholesterol: Optional[float] = Field(default=None, gt=0, le=1000)
    ldl_c: Optional[float] = Field(default=None, gt=0, le=1000)
    hdl_c: Optional[float] = Field(default=None, gt=0, le=1000)
    triglycerides: Optional[float] = Field(default=None, gt=0, le=2000)
    non_hdl_c: Optional[float] = Field(
        default=None, gt=0, le=1000, description="미입력 시 total_cholesterol-hdl_c로 자동 계산"
    )

    # 이상지질혈증 관련 주요 심혈관질환 위험요인
    smoking: Optional[bool] = None
    has_diabetes: Optional[bool] = None
    has_hypertension: Optional[bool] = None
    has_ascvd_history: Optional[bool] = Field(
        default=None,
        description="동맥경화성 심혈관질환(관상동맥질환/뇌졸중/말초동맥질환 등) 병력 여부",
    )

    @model_validator(mode="after")
    def _check_blood_pressure_order(self) -> "HealthProfileInput":
        if self.systolic_bp is not None and self.diastolic_bp is not None:
            if self.systolic_bp <= self.diastolic_bp:
                raise ValueError("systolic_bp(수축기 혈압)는 diastolic_bp(이완기 혈압)보다 커야 합니다.")
        return self

    @model_validator(mode="after")
    def _derive_calculated_fields(self) -> "HealthProfileInput":
        if self.bmi is None and self.height_cm is not None and self.weight_kg is not None:
            height_m = self.height_cm / 100
            self.bmi = round(self.weight_kg / (height_m**2), 1)
        if self.non_hdl_c is None and self.total_cholesterol is not None and self.hdl_c is not None:
            self.non_hdl_c = round(self.total_cholesterol - self.hdl_c, 1)
        return self


class DomainResult(BaseModel):
    """4개 건강영역 각각에 대한 구조화된 평가 결과."""

    category: str
    risk_level: RiskLevel
    sub_status: str
    display_label: str
    reason: str
    input_values: dict[str, Any]
    criteria_reference: str
    recommendation: str
    flags: list[str] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)
    disclaimer: str = COMMON_DISCLAIMER
