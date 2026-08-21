"""
당뇨병/혈당이상 관련 건강위험 수준 판단 Rule.

기준 출처
---------
대한당뇨병학회(Korean Diabetes Association, KDA) 당뇨병 진료지침
- 공복혈장포도당(FPG, mg/dL): 정상 <100 / 당뇨병전단계(공복혈당장애) 100-125 / 당뇨병 범위 ≥126
- 당화혈색소(HbA1c, %)      : 정상 <5.7 / 당뇨병전단계 5.7-6.4 / 당뇨병 범위 ≥6.5
- 75g 경구포도당부하 2시간 혈당(OGTT 2h, mg/dL): 정상 <140 / 당뇨병전단계(내당능장애) 140-199 /
  당뇨병 범위 ≥200

주의
----
공식적인 당뇨병 진단은 서로 다른 날 시행한 2회 이상의 검사에서 모두 당뇨병 범위 수치가
확인되어야 한다. 이 모듈은 한 시점에 입력된 값을 기준으로 참고용 위험 수준만 분류하며,
단일 수치만으로 "당뇨병"을 진단/확정하지 않는다. 공복혈당(FPG)은 공복 상태에서 측정된
경우에만 유효하므로, is_fasting이 명시적으로 False인 경우 평가에서 제외한다.
"""
from __future__ import annotations

from ..schemas import COMMON_DISCLAIMER, DomainResult, HealthProfileInput, RiskLevel

CATEGORY = "diabetes"

CRITERIA_REFERENCE = (
    "대한당뇨병학회(KDA) 당뇨병 진료지침 - 공복혈장포도당(FPG)/당화혈색소(HbA1c)/"
    "75g 경구포도당부하 2시간 혈당(OGTT 2h) 진단 기준"
)

# tier: 0=정상, 1=당뇨병전단계, 2=당뇨병 범위
_TIER_LABEL = {0: "정상 범위", 1: "당뇨병전단계 범위", 2: "당뇨병 범위"}

_DISPLAY_LABEL = {
    RiskLevel.NORMAL: "혈당은 정상 범위예요.",
    RiskLevel.CAUTION: "혈당 관리가 필요해요.",
    RiskLevel.HIGH: "혈당 관련 위험 수준이 높아요.",
    RiskLevel.VERY_HIGH: "혈당 관련 위험 수준이 매우 높아요.",
}

_RECOMMENDATION = {
    RiskLevel.NORMAL: "현재 생활습관을 유지하고 정기적으로 혈당을 확인하세요.",
    RiskLevel.CAUTION: "체중 감량, 유산소 운동 등 생활습관 개선을 권장합니다(주 150분 이상 중강도 활동 권장).",
    RiskLevel.HIGH: "혈당 수치가 당뇨병 범위에 해당하니 의료기관에서 추가 검사를 받아보시길 권장합니다.",
    RiskLevel.VERY_HIGH: "여러 지표에서 당뇨병 범위 수치가 확인되어, 신속한 의료기관 상담을 권장합니다.",
}


def _fpg_tier(value: float) -> int:
    if value < 100:
        return 0
    if value < 126:
        return 1
    return 2


def _hba1c_tier(value: float) -> int:
    if value < 5.7:
        return 0
    if value < 6.5:
        return 1
    return 2


def _ogtt_tier(value: float) -> int:
    if value < 140:
        return 0
    if value < 200:
        return 1
    return 2


def evaluate_diabetes(profile: HealthProfileInput) -> DomainResult:
    """FPG/HbA1c/OGTT 2h 지표를 독립적으로 평가한 뒤 종합하여 혈당 관련 위험 수준을 판단한다."""
    missing_fields: list[str] = []
    flags: list[str] = []
    indicator_tiers: dict[str, int] = {}
    reasons: list[str] = []

    fpg = profile.fasting_glucose
    if fpg is not None and profile.is_fasting is False:
        missing_fields.append("fasting_glucose (비공복 상태로 측정되어 평가에서 제외)")
        flags.append("공복혈당이 비공복 상태에서 측정되어 이번 평가에서 제외했습니다.")
        fpg = None
    elif fpg is not None and profile.is_fasting is None:
        flags.append("공복 여부가 확인되지 않아 공복혈당 결과는 참고용으로만 활용했습니다.")

    if fpg is not None:
        tier = _fpg_tier(fpg)
        indicator_tiers["fasting_glucose"] = tier
        reasons.append(f"공복혈당 {fpg}mg/dL: {_TIER_LABEL[tier]}")
    elif profile.fasting_glucose is None:
        missing_fields.append("fasting_glucose")

    if profile.hba1c is not None:
        tier = _hba1c_tier(profile.hba1c)
        indicator_tiers["hba1c"] = tier
        reasons.append(f"당화혈색소 {profile.hba1c}%: {_TIER_LABEL[tier]}")
    else:
        missing_fields.append("hba1c")

    if profile.ogtt_2h is not None:
        tier = _ogtt_tier(profile.ogtt_2h)
        indicator_tiers["ogtt_2h"] = tier
        reasons.append(f"OGTT 2시간 혈당 {profile.ogtt_2h}mg/dL: {_TIER_LABEL[tier]}")
    else:
        missing_fields.append("ogtt_2h")

    input_values = {
        "fasting_glucose": profile.fasting_glucose,
        "hba1c": profile.hba1c,
        "ogtt_2h": profile.ogtt_2h,
        "is_fasting": profile.is_fasting,
    }

    if not indicator_tiers:
        return DomainResult(
            category=CATEGORY,
            risk_level=RiskLevel.INSUFFICIENT_DATA,
            sub_status="정보 부족",
            display_label="혈당 관련 정보가 부족해 판단할 수 없어요.",
            reason="공복혈당, 당화혈색소, OGTT 2시간 혈당 중 최소 하나가 있어야 평가할 수 있습니다.",
            input_values=input_values,
            criteria_reference=CRITERIA_REFERENCE,
            recommendation="공복혈당, 당화혈색소, OGTT 2시간 혈당 중 하나 이상을 입력해 주세요.",
            flags=flags,
            missing_fields=missing_fields,
            disclaimer=COMMON_DISCLAIMER,
        )

    tiers = list(indicator_tiers.values())
    diabetes_range_count = sum(1 for t in tiers if t == 2)
    max_tier = max(tiers)
    min_tier = min(tiers)

    if diabetes_range_count >= 2:
        risk_level = RiskLevel.VERY_HIGH
        sub_status = "여러 지표에서 당뇨병 범위 수치 확인"
    elif diabetes_range_count == 1:
        risk_level = RiskLevel.HIGH
        sub_status = "당뇨병 범위 수치 확인(단일 지표)"
        flags.append("단일 지표에서만 당뇨병 범위 수치가 나왔으므로, 반복 검사를 통한 확인이 필요합니다.")
    elif max_tier == 1:
        risk_level = RiskLevel.CAUTION
        sub_status = "당뇨병전단계 범위"
    else:
        risk_level = RiskLevel.NORMAL
        sub_status = "정상 범위"

    if len(tiers) >= 2 and max_tier - min_tier >= 2:
        flags.append("검사 지표 간 결과 차이가 커 함께 판단하기 위해 의료기관 상담을 권장합니다.")

    if len(indicator_tiers) == 1:
        flags.append("단일 검사 결과를 기반으로 한 참고용 결과이며, 공식 진단은 추가 검사 확인이 필요합니다.")

    return DomainResult(
        category=CATEGORY,
        risk_level=risk_level,
        sub_status=sub_status,
        display_label=_DISPLAY_LABEL[risk_level],
        reason=" ".join(reasons),
        input_values=input_values,
        criteria_reference=CRITERIA_REFERENCE,
        recommendation=_RECOMMENDATION[risk_level],
        flags=flags,
        missing_fields=missing_fields,
        disclaimer=COMMON_DISCLAIMER,
    )
