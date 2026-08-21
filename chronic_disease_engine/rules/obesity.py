"""
비만 관련 건강위험 수준 판단 Rule.

기준 출처
---------
대한비만학회(Korean Society for the Study of Obesity, KSSO) 비만 진료지침(2024년, 8판)
- 한국 성인 체질량지수(BMI, kg/m^2) 기준
    저체중        : BMI < 18.5
    정상 체중      : 18.5 ≤ BMI < 23.0
    비만전단계(과체중) : 23.0 ≤ BMI < 25.0
    1단계 비만     : 25.0 ≤ BMI < 30.0
    2단계 비만     : 30.0 ≤ BMI < 35.0
    3단계 비만(고도비만) : BMI ≥ 35.0
- 허리둘레(복부비만) 기준: 성인 남성 90cm 이상 / 여성 85cm 이상
  (측정법: WHO 권고에 따라 갈비뼈 최하단과 골반 장골능 사이 중간 지점에서 측정)

BMI는 키(height_cm)와 체중(weight_kg)이 있으면 schemas.HealthProfileInput에서
자동으로 계산되며, 이 모듈은 계산된 BMI 값을 그대로 사용한다.
"""
from __future__ import annotations

from ..schemas import (
    COMMON_DISCLAIMER,
    DomainResult,
    HealthProfileInput,
    RiskLevel,
    Sex,
    higher_risk,
)

CATEGORY = "obesity"

CRITERIA_REFERENCE = (
    "대한비만학회(KSSO) 2024년 비만 진료지침 - 한국 성인 BMI 기준 및 성별 허리둘레(복부비만) 기준"
)

_WAIST_CUTOFF_CM = {Sex.MALE: 90.0, Sex.FEMALE: 85.0}

_DISPLAY_LABEL = {
    RiskLevel.NORMAL: "체중은 정상 범위예요.",
    RiskLevel.CAUTION: "체중 관리가 권장돼요.",
    RiskLevel.HIGH: "체중 관련 위험 수준이 높아요.",
    RiskLevel.VERY_HIGH: "체중 관련 위험 수준이 매우 높아요.",
}

_RECOMMENDATION = {
    RiskLevel.NORMAL: "현재의 식습관과 활동량을 유지하세요.",
    RiskLevel.CAUTION: "균형 잡힌 식사와 규칙적인 운동을 통한 체중 관리가 권장됩니다.",
    RiskLevel.HIGH: "생활습관 개선과 함께 의료기관 상담을 권장합니다.",
    RiskLevel.VERY_HIGH: "적극적인 체중 관리를 위해 의료기관 상담을 권장합니다.",
}


def _bmi_tier(bmi: float) -> tuple[str, RiskLevel]:
    if bmi < 18.5:
        return "저체중", RiskLevel.CAUTION
    if bmi < 23.0:
        return "정상 체중", RiskLevel.NORMAL
    if bmi < 25.0:
        return "비만전단계(과체중)", RiskLevel.CAUTION
    if bmi < 30.0:
        return "1단계 비만", RiskLevel.HIGH
    if bmi < 35.0:
        return "2단계 비만", RiskLevel.HIGH
    return "3단계 비만(고도비만)", RiskLevel.VERY_HIGH


def evaluate_obesity(profile: HealthProfileInput) -> DomainResult:
    """BMI와 허리둘레를 기준으로 비만 관련 건강위험 수준을 판단한다."""
    bmi, waist, sex = profile.bmi, profile.waist_cm, profile.sex

    missing_fields: list[str] = []
    if bmi is None:
        missing_fields.append("bmi (또는 height_cm & weight_kg)")
    if waist is None:
        missing_fields.append("waist_cm")

    if bmi is None and waist is None:
        return DomainResult(
            category=CATEGORY,
            risk_level=RiskLevel.INSUFFICIENT_DATA,
            sub_status="정보 부족",
            display_label="체중 관련 정보가 부족해 판단할 수 없어요.",
            reason="BMI(또는 키/체중) 또는 허리둘레 중 최소 하나가 있어야 평가할 수 있습니다.",
            input_values={"bmi": bmi, "waist_cm": waist, "sex": sex},
            criteria_reference=CRITERIA_REFERENCE,
            recommendation="키/체중 또는 허리둘레를 입력해 주세요.",
            missing_fields=missing_fields,
            disclaimer=COMMON_DISCLAIMER,
        )

    reasons: list[str] = []
    flags: list[str] = []
    sub_statuses: list[str] = []
    risk_level = RiskLevel.INSUFFICIENT_DATA

    bmi_risk: RiskLevel | None = None
    if bmi is not None:
        bmi_label, bmi_risk = _bmi_tier(bmi)
        sub_statuses.append(bmi_label)
        reasons.append(f"BMI {bmi}는 '{bmi_label}' 구간입니다.")
        risk_level = higher_risk(risk_level, bmi_risk)

    is_abdominal_obese: bool | None = None
    if waist is not None and sex is not None:
        cutoff = _WAIST_CUTOFF_CM[sex]
        is_abdominal_obese = waist >= cutoff
        if is_abdominal_obese:
            sub_statuses.append("복부비만")
            reasons.append(f"허리둘레 {waist}cm는 성별 기준({cutoff}cm) 이상으로 복부비만에 해당합니다.")
            risk_level = higher_risk(risk_level, RiskLevel.CAUTION)
        else:
            reasons.append(f"허리둘레 {waist}cm는 성별 기준({cutoff}cm) 미만입니다.")
    elif waist is not None and sex is None:
        missing_fields.append("sex")
        flags.append("성별 정보가 없어 허리둘레만으로는 복부비만 여부를 판단할 수 없습니다.")

    # BMI와 허리둘레 결과가 서로 다른 방향을 가리키는 경우를 명시적으로 안내한다.
    if bmi_risk is not None and is_abdominal_obese is not None:
        if bmi_risk == RiskLevel.NORMAL and is_abdominal_obese:
            flags.append(
                "BMI는 정상이지만 허리둘레가 기준 이상으로, 정상체중 복부비만(마른비만) 가능성이 있습니다."
            )
        elif bmi_risk in (RiskLevel.HIGH, RiskLevel.VERY_HIGH) and not is_abdominal_obese:
            flags.append(
                "BMI 기준으로는 비만 범위이지만 허리둘레는 기준 미만입니다. 체성분 확인을 권장합니다."
            )

    return DomainResult(
        category=CATEGORY,
        risk_level=risk_level,
        sub_status=" / ".join(sub_statuses) if sub_statuses else "정보 부족",
        display_label=_DISPLAY_LABEL.get(risk_level, "체중 관련 정보가 부족해 판단할 수 없어요."),
        reason=" ".join(reasons),
        input_values={"bmi": bmi, "waist_cm": waist, "sex": sex},
        criteria_reference=CRITERIA_REFERENCE,
        recommendation=_RECOMMENDATION.get(risk_level, "키/체중 또는 허리둘레를 입력해 주세요."),
        flags=flags,
        missing_fields=missing_fields,
        disclaimer=COMMON_DISCLAIMER,
    )
