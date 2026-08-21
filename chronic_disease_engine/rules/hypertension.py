"""
고혈압 관련 건강위험 수준 판단 Rule.

기준 출처
---------
대한고혈압학회(Korean Society of Hypertension, KSH) 고혈압 진료지침
- 2022년 제5판에서 도입된 '주의혈압' 범주를 포함한 5단계 진료실혈압 분류
  (정상혈압 / 주의혈압 / 고혈압전단계 / 고혈압 1기 / 고혈압 2기)는
  2026년 제6판까지 유지되고 있다.
- 진료실혈압 기준: 정상혈압 SBP<120 및 DBP<80 / 주의혈압 SBP 120-129 및 DBP<80 /
  고혈압전단계 SBP 130-139 또는 DBP 80-89 / 고혈압 1기 SBP 140-159 또는 DBP 90-99 /
  고혈압 2기 SBP≥160 또는 DBP≥100.
- 고혈압 진단 기준(SBP≥140 또는 DBP≥90)은 미국 ACC/AHA 2017 기준(130/80)을 따르지 않고
  기존 기준을 유지하는 것이 국내 지침의 특징이다.
  (참고: 대한고혈압학회 홈페이지 진료지침 안내 https://www.koreanhypertension.org/reference/guide ,
   2022년 고혈압 진료지침 발표 관련 보도자료)

이 모듈은 단일 시점의 혈압 측정값을 참고용으로 분류할 뿐이며 고혈압을 진단하지 않는다.
실제 고혈압 진단은 여러 날에 걸친 반복 측정 또는 가정혈압/24시간 활동혈압 측정을 통해
의료기관에서 확인해야 한다.
"""
from __future__ import annotations

from ..schemas import COMMON_DISCLAIMER, DomainResult, HealthProfileInput, RiskLevel

CATEGORY = "hypertension"

CRITERIA_REFERENCE = (
    "대한고혈압학회(KSH) 고혈압 진료지침(2022년 제5판 분류 체계, 2026년 제6판까지 유지) - "
    "진료실혈압 기준 정상혈압/주의혈압/고혈압전단계/고혈압 1기/고혈압 2기 분류"
)

SINGLE_MEASUREMENT_NOTICE = (
    "단일 측정값을 기반으로 한 참고용 결과이며, 정확한 평가를 위해 반복 측정 또는 "
    "의료기관 상담을 권장합니다."
)

# tier: 0=정상혈압, 1=주의혈압, 2=고혈압전단계, 3=고혈압 1기, 4=고혈압 2기
_TIER_INFO: dict[int, tuple[str, RiskLevel]] = {
    0: ("정상혈압", RiskLevel.NORMAL),
    1: ("주의혈압", RiskLevel.CAUTION),
    2: ("고혈압 전단계", RiskLevel.CAUTION),
    3: ("고혈압 1기", RiskLevel.HIGH),
    4: ("고혈압 2기", RiskLevel.VERY_HIGH),
}

_DISPLAY_LABEL = {
    RiskLevel.NORMAL: "혈압은 정상 범위예요.",
    RiskLevel.CAUTION: "혈압 관리가 권장돼요.",
    RiskLevel.HIGH: "혈압 관련 위험 수준이 높아요.",
    RiskLevel.VERY_HIGH: "혈압 관련 위험 수준이 매우 높아요.",
}

_RECOMMENDATION = {
    RiskLevel.NORMAL: "현재 생활습관을 유지하고 정기적으로 혈압을 확인하세요.",
    RiskLevel.CAUTION: "저염식, 규칙적인 운동 등 생활습관 관리를 권장합니다.",
    RiskLevel.HIGH: "생활습관 관리와 함께 의료기관 상담을 권장합니다.",
    RiskLevel.VERY_HIGH: "가능한 빨리 의료기관을 방문해 상담받으시길 권장합니다.",
}


def _sbp_tier(sbp: float) -> int:
    if sbp < 120:
        return 0
    if sbp < 130:
        return 1
    if sbp < 140:
        return 2
    if sbp < 160:
        return 3
    return 4


def _dbp_tier(dbp: float) -> int:
    # DBP에는 '주의혈압'에 해당하는 별도 구간이 없다 (80 미만이면 0으로 유지).
    if dbp < 80:
        return 0
    if dbp < 90:
        return 2
    if dbp < 100:
        return 3
    return 4


def evaluate_hypertension(profile: HealthProfileInput) -> DomainResult:
    """SBP/DBP를 기준으로 고혈압 관련 건강위험 수준을 판단한다."""
    sbp, dbp = profile.systolic_bp, profile.diastolic_bp

    missing_fields: list[str] = []
    if sbp is None:
        missing_fields.append("systolic_bp")
    if dbp is None:
        missing_fields.append("diastolic_bp")

    if sbp is None or dbp is None:
        return DomainResult(
            category=CATEGORY,
            risk_level=RiskLevel.INSUFFICIENT_DATA,
            sub_status="정보 부족",
            display_label="혈압 정보가 부족해 판단할 수 없어요.",
            reason="수축기 혈압과 이완기 혈압 값이 모두 있어야 평가할 수 있습니다.",
            input_values={"systolic_bp": sbp, "diastolic_bp": dbp},
            criteria_reference=CRITERIA_REFERENCE,
            recommendation="정확한 혈압 측정 후 다시 입력해 주세요.",
            missing_fields=missing_fields,
            disclaimer=COMMON_DISCLAIMER,
        )

    sbp_tier = _sbp_tier(sbp)
    dbp_tier = _dbp_tier(dbp)
    # SBP/DBP가 서로 다른 구간에 속하면, 국제 관례와 동일하게 더 높은(위험한) 구간을 최종 결과로 사용한다.
    tier = max(sbp_tier, dbp_tier)
    sub_status, risk_level = _TIER_INFO[tier]

    flags = [SINGLE_MEASUREMENT_NOTICE]
    if sbp_tier != dbp_tier:
        flags.append(
            f"수축기({sbp}mmHg)와 이완기({dbp}mmHg) 혈압이 서로 다른 구간에 속해, "
            "더 높은 위험 구간을 기준으로 판단했습니다."
        )
    return DomainResult(
        category=CATEGORY,
        risk_level=risk_level,
        sub_status=sub_status,
        display_label=_DISPLAY_LABEL[risk_level],
        reason=f"수축기 혈압 {sbp}mmHg, 이완기 혈압 {dbp}mmHg는 '{sub_status}' 구간에 해당합니다.",
        input_values={"systolic_bp": sbp, "diastolic_bp": dbp},
        criteria_reference=CRITERIA_REFERENCE,
        recommendation=_RECOMMENDATION[risk_level],
        flags=flags,
        disclaimer=COMMON_DISCLAIMER,
    )
