"""
이상지질혈증 관련 건강위험 수준 판단 Rule.

기준 출처
---------
한국지질동맥경화학회(Korean Society of Lipid and Atherosclerosis, KSoLA)
이상지질혈증 진료지침(5판, 2022년 개정) - 원문 PDF(lipid.or.kr) 직접 확인.

1) 지표별 수치 분류 (mg/dL) - 국내외 지질 진료지침에서 공통적으로 사용되는 분류
   총콜레스테롤(TC)   : 정상 <200 / 경계 200-239 / 높음 ≥240
   LDL-콜레스테롤(LDL) : 최적/근접최적 <130 / 경계 130-159 / 높음 160-189 / 매우높음 ≥190
   HDL-콜레스테롤(HDL) : 낮음(위험인자) <40 / 정상 40-59 / 높음(보호인자) ≥60
   중성지방(TG)       : 정상 <150 / 경계 150-199 / 높음 200-499 / 매우높음(췌장염 위험) ≥500

2) 죽상경화성 심혈관질환 주요 위험인자(LDL-C 이외)
   흡연 / 저HDL-콜레스테롤(<40mg/dL) / 관상동맥질환 조기발병 가족력 /
   연령(남 ≥45세, 여 ≥55세) / 고혈압(SBP≥140 또는 DBP≥90 또는 항고혈압제 복용)
   * 고HDL-콜레스테롤(≥60mg/dL)은 보호인자로 간주하여 위험인자 수에서 1개를 뺀다.
   (본 엔진은 입력 스키마에 가족력 필드가 없어 가족력 인자는 반영하지 못하며,
    이는 criteria_reference와 flags에 명시한다.)

3) 심혈관질환 위험도에 따른 LDL-콜레스테롤 목표치
   초고위험군(관상동맥질환 병력)                                   : LDL-C < 55 mg/dL
   고위험군(허혈뇌졸중/일과성뇌허혈발작, 경동맥질환, 말초동맥질환, 복부대동맥류) : LDL-C < 70 mg/dL
   당뇨병(유병기간 10년 이상 또는 주요 위험인자 동반)                    : LDL-C < 70 mg/dL
   당뇨병(유병기간 10년 미만, 주요 위험인자 없음)                       : LDL-C < 100 mg/dL
   중등도 위험군(주요 위험인자 2개 이상)                              : LDL-C < 130 mg/dL
   저위험군(주요 위험인자 1개 이하)                                  : LDL-C < 160 mg/dL

   본 엔진은 입력값(has_ascvd_history)이 관상동맥질환인지 뇌졸중/말초동맥질환 등인지
   구분하지 못하므로, ASCVD 병력이 있는 경우 보수적으로 '고위험군(<70mg/dL)' 기준을
   적용한다. 실제로 관상동맥질환 병력이 있다면 목표치가 <55mg/dL로 더 낮을 수 있으므로
   정확한 목표치는 의료진과 상담이 필요하다는 점을 flags에 명시한다.

주의: 이 모듈은 공식적인 ASCVD 위험점수(Pooled Cohort Equation 등)를 계산하지 않으며,
입력된 정보만으로 확인 가능한 주요 위험인자 개수에 따라 참고용 위험군을 구분한다.
정확한 심혈관 위험도 평가와 치료 목표 설정은 반드시 의료기관에서 확인해야 한다.
"""
from __future__ import annotations

from ..schemas import COMMON_DISCLAIMER, DomainResult, HealthProfileInput, RiskLevel, Sex, higher_risk

CATEGORY = "dyslipidemia"

CRITERIA_REFERENCE = (
    "한국지질동맥경화학회(KSoLA) 이상지질혈증 진료지침 5판(2022) - 지질 지표별 수치 분류 및 "
    "심혈관질환 위험도에 따른 LDL-콜레스테롤 목표치(가족력 위험인자는 입력값 부재로 미반영)"
)

_DISPLAY_LABEL = {
    RiskLevel.NORMAL: "콜레스테롤은 정상 범위예요.",
    RiskLevel.CAUTION: "콜레스테롤 관리가 필요해요.",
    RiskLevel.HIGH: "콜레스테롤 관련 위험 수준이 높아요.",
    RiskLevel.VERY_HIGH: "콜레스테롤 관련 위험 수준이 매우 높아요.",
}

_RECOMMENDATION = {
    RiskLevel.NORMAL: "현재 식습관과 운동 습관을 유지하세요.",
    RiskLevel.CAUTION: "포화지방/트랜스지방 섭취를 줄이고 규칙적인 운동을 권장합니다.",
    RiskLevel.HIGH: "식습관 개선과 함께 의료기관 상담을 권장합니다.",
    RiskLevel.VERY_HIGH: "신속한 의료기관 상담을 권장합니다.",
}


def _tc_tier(v: float) -> tuple[str, RiskLevel]:
    if v < 200:
        return "정상", RiskLevel.NORMAL
    if v < 240:
        return "경계", RiskLevel.CAUTION
    return "높음", RiskLevel.HIGH


def _ldl_tier(v: float) -> tuple[str, RiskLevel]:
    if v < 130:
        return "최적/근접최적", RiskLevel.NORMAL
    if v < 160:
        return "경계", RiskLevel.CAUTION
    if v < 190:
        return "높음", RiskLevel.HIGH
    return "매우높음", RiskLevel.VERY_HIGH


def _hdl_tier(v: float) -> tuple[str, RiskLevel]:
    if v < 40:
        return "낮음(위험인자)", RiskLevel.CAUTION
    if v < 60:
        return "정상", RiskLevel.NORMAL
    return "높음(보호인자)", RiskLevel.NORMAL


def _tg_tier(v: float) -> tuple[str, RiskLevel]:
    if v < 150:
        return "정상", RiskLevel.NORMAL
    if v < 200:
        return "경계", RiskLevel.CAUTION
    if v < 500:
        return "높음", RiskLevel.HIGH
    return "매우높음", RiskLevel.VERY_HIGH


def _count_major_risk_factors(profile: HealthProfileInput, hdl: float | None) -> tuple[int, list[str]]:
    """LDL-C 이외의 죽상경화성 심혈관질환 주요 위험인자 개수를 계산한다 (가족력 제외)."""
    count = 0
    factors: list[str] = []

    if profile.smoking:
        count += 1
        factors.append("흡연")

    if hdl is not None and hdl < 40:
        count += 1
        factors.append("낮은 HDL-콜레스테롤(<40mg/dL)")

    if profile.age is not None and profile.sex is not None:
        if (profile.sex == Sex.MALE and profile.age >= 45) or (
            profile.sex == Sex.FEMALE and profile.age >= 55
        ):
            count += 1
            factors.append("연령")

    has_hypertension = bool(profile.has_hypertension)
    if profile.systolic_bp is not None and profile.systolic_bp >= 140:
        has_hypertension = True
    if profile.diastolic_bp is not None and profile.diastolic_bp >= 90:
        has_hypertension = True
    if has_hypertension:
        count += 1
        factors.append("고혈압")

    if hdl is not None and hdl >= 60:
        count -= 1  # 고HDL은 보호인자로 위험인자 수에서 1개를 뺀다.

    return max(count, 0), factors


def _resolve_risk_category(
    profile: HealthProfileInput, hdl: float | None
) -> tuple[str, float, int, list[str]]:
    """주요 위험인자 개수를 바탕으로 참고용 위험군과 LDL-C 목표치를 결정한다."""
    count, factors = _count_major_risk_factors(profile, hdl)

    if profile.has_ascvd_history:
        return "고위험군(동맥경화성 심혈관질환 병력 - 참고용, <70mg/dL 기준 적용)", 70.0, count, factors
    if profile.has_diabetes:
        if count >= 1:
            return "당뇨병(주요 위험인자 동반)", 70.0, count, factors
        return "당뇨병(주요 위험인자 없음 - 유병기간 정보 없음)", 100.0, count, factors
    if count >= 2:
        return "중등도 위험군(주요 위험인자 2개 이상)", 130.0, count, factors
    return "저위험군(주요 위험인자 1개 이하)", 160.0, count, factors


def evaluate_dyslipidemia(profile: HealthProfileInput) -> DomainResult:
    """TC/LDL-C/HDL-C/TG 지표를 독립적으로 평가하고, 위험군별 LDL-C 목표치와 함께 종합한다."""
    tc, ldl, hdl, tg = (
        profile.total_cholesterol,
        profile.ldl_c,
        profile.hdl_c,
        profile.triglycerides,
    )
    non_hdl = profile.non_hdl_c

    missing_fields = [
        name
        for name, value in [
            ("total_cholesterol", tc),
            ("ldl_c", ldl),
            ("hdl_c", hdl),
            ("triglycerides", tg),
        ]
        if value is None
    ]

    input_values = {
        "total_cholesterol": tc,
        "ldl_c": ldl,
        "hdl_c": hdl,
        "triglycerides": tg,
        "non_hdl_c": non_hdl,
    }

    if tc is None and ldl is None and hdl is None and tg is None:
        return DomainResult(
            category=CATEGORY,
            risk_level=RiskLevel.INSUFFICIENT_DATA,
            sub_status="정보 부족",
            display_label="콜레스테롤 관련 정보가 부족해 판단할 수 없어요.",
            reason="총콜레스테롤, LDL-C, HDL-C, 중성지방 중 최소 하나가 있어야 평가할 수 있습니다.",
            input_values=input_values,
            criteria_reference=CRITERIA_REFERENCE,
            recommendation="지질 검사 결과 중 하나 이상을 입력해 주세요.",
            missing_fields=missing_fields,
            disclaimer=COMMON_DISCLAIMER,
        )

    reasons: list[str] = []
    flags: list[str] = []
    indicator_results: dict[str, tuple[str, RiskLevel]] = {}

    if tc is not None:
        indicator_results["total_cholesterol"] = _tc_tier(tc)
        reasons.append(f"총콜레스테롤 {tc}mg/dL: {indicator_results['total_cholesterol'][0]}")
    if ldl is not None:
        indicator_results["ldl_c"] = _ldl_tier(ldl)
        reasons.append(f"LDL-콜레스테롤 {ldl}mg/dL: {indicator_results['ldl_c'][0]}")
    if hdl is not None:
        indicator_results["hdl_c"] = _hdl_tier(hdl)
        reasons.append(f"HDL-콜레스테롤 {hdl}mg/dL: {indicator_results['hdl_c'][0]}")
    if tg is not None:
        indicator_results["triglycerides"] = _tg_tier(tg)
        reasons.append(f"중성지방 {tg}mg/dL: {indicator_results['triglycerides'][0]}")

    risk_level = RiskLevel.NORMAL
    for _, level in indicator_results.values():
        risk_level = higher_risk(risk_level, level)

    levels_present = {level for _, level in indicator_results.values()}
    if RiskLevel.NORMAL in levels_present and (
        RiskLevel.HIGH in levels_present or RiskLevel.VERY_HIGH in levels_present
    ):
        flags.append("지질 지표 간 결과가 서로 달라, 종합적인 판단을 위해 의료기관 상담이 필요합니다.")

    ldl_target = None
    risk_category_label = None
    if ldl is not None:
        risk_category_label, ldl_target, factor_count, factors = _resolve_risk_category(profile, hdl)
        reasons.append(
            f"확인 가능한 주요 심혈관질환 위험인자 {factor_count}개"
            f"({', '.join(factors) if factors else '해당 없음'}) 기준 참고 위험군은 "
            f"'{risk_category_label}'이며, 참고 목표 LDL-C는 <{ldl_target:.0f}mg/dL입니다."
        )
        if ldl >= ldl_target:
            flags.append(
                f"개인 심혈관 위험군 기준 참고 목표치(<{ldl_target:.0f}mg/dL)를 초과했습니다."
            )
            risk_level = higher_risk(risk_level, RiskLevel.CAUTION)
        if profile.has_ascvd_history:
            flags.append(
                "동맥경화성 심혈관질환 병력이 있는 경우 질환 종류(관상동맥질환 등)에 따라 "
                "목표 LDL-C가 <55mg/dL로 더 낮을 수 있으므로 정확한 목표치는 의료진과 상담하세요."
            )
        if non_hdl is not None:
            non_hdl_target = ldl_target + 30
            reasons.append(
                f"non-HDL-콜레스테롤 {non_hdl}mg/dL (참고 목표 <{non_hdl_target:.0f}mg/dL)"
            )
            if non_hdl >= non_hdl_target:
                flags.append(f"non-HDL-콜레스테롤이 참고 목표치(<{non_hdl_target:.0f}mg/dL)를 초과했습니다.")

    if tg is not None and tg >= 500:
        flags.append("중성지방 수치가 매우 높아 급성 췌장염 등의 위험이 있으니 신속한 의료기관 상담을 권장합니다.")
        risk_level = RiskLevel.VERY_HIGH

    if ldl is None and (tc is not None or hdl is not None or tg is not None):
        flags.append("LDL-콜레스테롤 값이 없어 개인별 위험군 기준 목표치 평가는 생략했습니다.")

    sub_status_parts = [
        f"{name}:{label}"
        for name, (label, level) in indicator_results.items()
        if level == risk_level
    ]
    sub_status = ", ".join(sub_status_parts) if sub_status_parts else (
        indicator_results[next(iter(indicator_results))][0] if indicator_results else "정보 부족"
    )
    if risk_category_label is not None:
        sub_status = f"{sub_status} ({risk_category_label})"

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
