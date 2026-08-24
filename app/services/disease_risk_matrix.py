"""수치 하나가 여러 만성질환에 걸쳐 무엇을 시사하는지 읽는다 — 영역 판정의 전치(轉置).

`chronic_disease_engine` 의 넷과 `lab_staging` 의 다섯, 아홉 영역은 모두 같은 방향을
본다. **여러 수치 -> 이 장기가 지금 어떤 상태인가.** 검진 결과지를 장기별로 묶어 읽는
방식이고, 그 자체로 맞다.

이 모듈은 반대로 간다. **수치 하나 -> 이 값이 어떤 질환들의 앞날을 얼마나 가리는가.**
γ-GTP 는 간 영역에서만 읽히지만 실제로는 제2형 당뇨 발생을 예측하고, 알부민뇨는 신장
판정의 재료지만 eGFR 과 독립적으로 심혈관 사망을 예측한다. 요산은 통풍만의 값이 아니라
콩팥 기능 저하의 선행 지표다. 장기별로 묶어 읽으면 이 화살표들이 전부 보이지 않는다.

세 가지를 지켰다.

**진단이 아니라 위험이다.** 아홉 영역은 "지금 기준을 넘었는가"를 답한다. 여기는 "아직
넘지 않았어도 넘을 쪽으로 가고 있는가"다. 그래서 자기 자신을 가리키는 화살표는 넣지
않았다 — 공복혈당 130 은 당뇨 위험이 아니라 이미 당뇨 영역의 판정이고, 그건 저쪽이 한다.
이미 진단받은 질환도 위험을 계산하지 않고 그렇게 적는다.

**연관과 인과를 구분한다.** γ-GTP 가 높은 사람에게서 당뇨가 더 생긴다는 건 24개 코호트
17만 명에서 확인됐지만(RR 1.34), 멘델 무작위화로 보면 인과는 없다(RR 0.96, 95% CI
0.89-1.04). 낮은 HDL 도 같다 — 위험인자로 오래 쓰였지만 HDL 을 올리는 약은 심근경색을
줄이지 못했다. 이런 고리는 `Evidence.causal=False` 로 적고 문구에서 "원인"이라 말하지
않는다. 실제로 이 저장소의 사망 연계 분석에서도 낮은 HDL 은 장기 사망을 못 갈랐다
(Harrell C=0.506, `docs/27_eda_new_data_and_synthetic.md`).

**같은 것을 두 번 세지 않는다.** γ-GTP·ALT·지방간지수는 셋 다 간에 낀 지방을 본다.
따로 더하면 재료 하나를 세 번 세는 셈이라 위험이 부풀려진다. 신호마다 `cluster` 를 두고
같은 무리 안에서는 가장 센 것 하나만 취한 뒤, 무리끼리만 더한다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from chronic_disease_engine.schemas import COMMON_DISCLAIMER, RiskLevel

from app.services.lab_staging import (
    ALT_UPPER,
    GGT_UPPER,
    URIC_ACID_UPPER,
    fatty_liver_index,
    resolve_bmi,
)
from app.services.risk import egfr_ckd_epi_2021

# ---------------------------------------------------------------------------
# 질환 축
# ---------------------------------------------------------------------------

# 여기 넷은 서로를 가리키는 화살표가 실제로 오가는 질환들이다. 비만·빈혈처럼 화살표가
# 한 방향으로만 나가는 것은 축에 두지 않고 신호 쪽에만 둔다.
DISEASES: dict[str, str] = {
    "dm_risk": "당뇨병",
    "cvd_risk": "심혈관질환",
    "ckd_risk": "만성콩팥병",
    "htn_risk": "고혈압",
}

# 이미 진단받은 질환은 위험을 세지 않는다. 진단자에게 "위험 높음" 은 아무 정보가 아니다.
_ALREADY_DIAGNOSED = {
    "dm_risk": "has_diabetes",
    "htn_risk": "has_hypertension",
    "cvd_risk": "has_ascvd_history",
}


@dataclass(frozen=True)
class Evidence:
    """이 화살표를 뒷받침하는 것. 크기와 출처를 같이 적지 않으면 검증할 수 없다."""

    effect: str
    source: str
    # None 은 인과를 따로 따져본 적이 없다는 뜻이다. False 는 따져봤더니 아니었다는 뜻이라
    # 완전히 다른 말이다 — 문구에서 구분한다.
    causal: bool | None = None


@dataclass(frozen=True)
class Link:
    """신호 하나가 질환 하나로 보내는 화살표."""

    disease: str
    weight: int  # 1=약함(RR<1.3) 2=중등도(1.3~2.0) 3=강함(>2.0)
    evidence: Evidence


@dataclass(frozen=True)
class Signal:
    """검진값에서 읽어내는 조건 하나."""

    key: str
    label: str
    cluster: str
    detect: Callable[[dict[str, Any]], tuple[str, dict[str, Any]] | None]
    links: tuple[Link, ...]
    # 이 신호가 들여다보는 입력. 하나라도 있으면 "볼 수는 있었다" 로 친다.
    # 신호가 안 잡힌 것과 볼 값이 없었던 것을 구분하려고 둔다 — 아무것도 입력하지
    # 않은 사람에게 "위험 신호가 없다" 고 답하면 안 낸 검사를 통과했다고 말하는 셈이다.
    reads: tuple[str, ...] = ()


# ---------------------------------------------------------------------------
# 감지기 — 값이 조건에 걸리면 (설명, 근거값) 을, 아니면 None 을 낸다
# ---------------------------------------------------------------------------


def _sex_of(profile: dict[str, Any]) -> str | None:
    sex = profile.get("sex")
    return str(sex.value if hasattr(sex, "value") else sex) if sex is not None else None


def _ggt_high(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    value, sex = profile.get("ggt"), _sex_of(profile)
    if value is None or sex not in GGT_UPPER:
        return None
    upper = GGT_UPPER[sex]
    if float(value) <= upper:
        return None
    return f"γ-GTP {value} IU/L (성별 상한 {upper:g}의 {float(value) / upper:.1f}배)", {"ggt": value}


def _alt_high(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    value, sex = profile.get("alt"), _sex_of(profile)
    if value is None or sex not in ALT_UPPER:
        return None
    upper = ALT_UPPER[sex]
    if float(value) <= upper:
        return None
    return f"ALT {value} IU/L (성별 상한 {upper:g}의 {float(value) / upper:.1f}배)", {"alt": value}


def _fatty_liver(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    fli, _ = fatty_liver_index(profile)
    if fli is None or fli < 60:
        return None
    return f"지방간 지수 {fli:.0f} (60 이상)", {"fli": round(fli, 1)}


def _prediabetes(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    """전당뇨 구간. 비공복 혈당은 벤더 엔진과 같은 이유로 읽지 않는다."""
    parts, values = [], {}
    fpg, hba1c = profile.get("fasting_glucose"), profile.get("hba1c")
    if fpg is not None and profile.get("is_fasting") is not False and 100 <= float(fpg) < 126:
        parts.append(f"공복혈당 {fpg} mg/dL")
        values["fasting_glucose"] = fpg
    if hba1c is not None and 5.7 <= float(hba1c) < 6.5:
        parts.append(f"당화혈색소 {hba1c}%")
        values["hba1c"] = hba1c
    if not parts:
        return None
    return f"{' · '.join(parts)} — 당뇨병전단계 구간", values


def _glucose_diabetic_range(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    parts, values = [], {}
    fpg, hba1c = profile.get("fasting_glucose"), profile.get("hba1c")
    if fpg is not None and profile.get("is_fasting") is not False and float(fpg) >= 126:
        parts.append(f"공복혈당 {fpg} mg/dL")
        values["fasting_glucose"] = fpg
    if hba1c is not None and float(hba1c) >= 6.5:
        parts.append(f"당화혈색소 {hba1c}%")
        values["hba1c"] = hba1c
    if not parts:
        return None
    return f"{' · '.join(parts)} — 당뇨병 범위", values


def _uric_acid_high(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    value, sex = profile.get("uric_acid"), _sex_of(profile)
    if value is None or sex not in URIC_ACID_UPPER:
        return None
    upper = URIC_ACID_UPPER[sex]
    if float(value) <= upper:
        return None
    excess = float(value) - upper
    return f"요산 {value} mg/dL (성별 기준 {upper:g}을 {excess:.1f} 초과)", {"uric_acid": value}


def _albuminuria_a3(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    acr = profile.get("urine_acr")
    if acr is None or float(acr) < 300:
        return None
    return f"요알부민/크레아티닌비 {acr} mg/g (A3, 고도 알부민뇨)", {"urine_acr": acr}


def _albuminuria_a2(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    acr = profile.get("urine_acr")
    if acr is None or not (30 <= float(acr) < 300):
        return None
    return f"요알부민/크레아티닌비 {acr} mg/g (A2, 중등도 알부민뇨)", {"urine_acr": acr}


def _egfr_low(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    creatinine, age, sex = profile.get("creatinine"), profile.get("age"), _sex_of(profile)
    if creatinine is None or age is None or sex is None:
        return None
    gfr = egfr_ckd_epi_2021(float(creatinine), float(age), sex)
    if gfr >= 60:
        return None
    return f"eGFR {gfr:.0f} mL/min/1.73m² (60 미만)", {"egfr": round(gfr, 1)}


def _bp_hypertensive(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    sbp, dbp = profile.get("systolic_bp"), profile.get("diastolic_bp")
    if sbp is None and dbp is None:
        return None
    if (sbp is not None and float(sbp) >= 140) or (dbp is not None and float(dbp) >= 90):
        return f"혈압 {sbp or '-'}/{dbp or '-'} mmHg (140/90 이상)", {"systolic_bp": sbp, "diastolic_bp": dbp}
    return None


def _bp_elevated(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    sbp, dbp = profile.get("systolic_bp"), profile.get("diastolic_bp")
    if sbp is None and dbp is None:
        return None
    if (sbp is not None and float(sbp) >= 140) or (dbp is not None and float(dbp) >= 90):
        return None  # 위 단계가 가져간다
    if (sbp is not None and float(sbp) >= 130) or (dbp is not None and float(dbp) >= 80):
        return f"혈압 {sbp or '-'}/{dbp or '-'} mmHg (130/80 이상)", {"systolic_bp": sbp, "diastolic_bp": dbp}
    return None


_WAIST_CUTOFF = {"M": 90.0, "F": 85.0}


def _central_obesity(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    waist, sex = profile.get("waist_cm"), _sex_of(profile)
    if waist is None or sex not in _WAIST_CUTOFF:
        return None
    cutoff = _WAIST_CUTOFF[sex]
    if float(waist) < cutoff:
        return None
    return f"허리둘레 {waist} cm (복부비만 기준 {cutoff:g} 이상)", {"waist_cm": waist}


def _obese_bmi(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    bmi = resolve_bmi(profile)
    if bmi is None or bmi < 25.0:
        return None
    return f"BMI {bmi:.1f} (한국 기준 25 이상 비만)", {"bmi": round(bmi, 1)}


def _ldl_high(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    ldl = profile.get("ldl_c")
    if ldl is None or float(ldl) < 160:
        return None
    return f"LDL 콜레스테롤 {ldl} mg/dL (160 이상)", {"ldl_c": ldl}


def _hdl_low(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    hdl = profile.get("hdl_c")
    if hdl is None or float(hdl) >= 40:
        return None
    return f"HDL 콜레스테롤 {hdl} mg/dL (40 미만)", {"hdl_c": hdl}


def _tg_high(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    tg = profile.get("triglycerides")
    if tg is None or float(tg) < 200:
        return None
    return f"중성지방 {tg} mg/dL (200 이상)", {"triglycerides": tg}


def _smoking(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    if profile.get("smoking") is not True:
        return None
    return "현재 흡연", {"smoking": True}


def _age_risk(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    age, sex = profile.get("age"), _sex_of(profile)
    if age is None or sex is None:
        return None
    floor = 45 if sex == "M" else 55
    if int(age) < floor:
        return None
    return f"만 {age}세 ({'남성 45' if sex == 'M' else '여성 55'}세 이상)", {"age": age}


def _diabetes_history(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    if profile.get("has_diabetes") is not True:
        return None
    return "당뇨병 진단 이력", {"has_diabetes": True}


def _hypertension_history(profile: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    if profile.get("has_hypertension") is not True:
        return None
    return "고혈압 진단 이력", {"has_hypertension": True}


# ---------------------------------------------------------------------------
# 매트릭스
# ---------------------------------------------------------------------------

SIGNALS: tuple[Signal, ...] = (
    # --- 간에 낀 지방 무리. 셋이 같은 것을 보므로 가장 센 하나만 센다 ---------
    Signal(
        "fatty_liver_high", "지방간 지수 높음", "hepatic_fat", _fatty_liver,
        (
            Link("dm_risk", 3, Evidence(
                "HR 2.22 (95% CI 1.84-2.60)",
                "Mantovani 2018 메타분석, 영상으로 진단한 비알코올 지방간 -> 제2형 당뇨 발생",
                causal=None,
            )),
        ),
        reads=("bmi", "height_cm", "weight_kg", "waist_cm", "triglycerides", "ggt"),
    ),
    Signal(
        "ggt_high", "γ-GTP 상승", "hepatic_fat", _ggt_high,
        (
            Link("dm_risk", 2, Evidence(
                "RR 1.34 (95% CI 1.27-1.42), 최고 대 최저 삼분위",
                "Kunutsor 2014 용량-반응 메타분석, 24개 코호트 177,307명 중 당뇨 11,155건",
                causal=False,  # 멘델 무작위화 RR 0.96 (0.89-1.04)
            )),
        ),
        reads=("ggt",),
    ),
    Signal(
        "alt_high", "ALT 상승", "hepatic_fat", _alt_high,
        (
            Link("dm_risk", 2, Evidence(
                "RR 1.16 (95% CI 1.08-1.25), ALT 5 IU/L 증가당",
                "Kunutsor 2013 간효소-당뇨 체계적 고찰. 영국 여성 코호트에서 log ALT 단위당 HR 1.83",
                causal=None,
            )),
        ),
        reads=("alt",),
    ),
    # --- 혈당 무리 ---------------------------------------------------------
    Signal(
        "glucose_diabetic_range", "혈당이 당뇨 범위", "glycemia", _glucose_diabetic_range,
        (
            Link("cvd_risk", 2, Evidence(
                "당뇨병은 심혈관질환의 주요 위험인자",
                "한국지질동맥경화학회 이상지질혈증 진료지침 — 당뇨는 LDL 목표를 낮추는 조건",
                causal=True,
            )),
            Link("ckd_risk", 2, Evidence(
                "당뇨병성 신증은 말기신부전의 가장 흔한 원인",
                "KDIGO 2012 CKD 진료지침",
                causal=True,
            )),
        ),
        reads=("fasting_glucose", "hba1c"),
    ),
    Signal(
        "prediabetes", "당뇨병전단계", "glycemia", _prediabetes,
        (
            Link("cvd_risk", 1, Evidence(
                "RR 1.15 (95% CI 1.11-1.18) 복합 심혈관질환, 뇌졸중 1.14, 사망 1.13",
                "Cai 2020 BMJ 메타분석, 129개 연구 10,069,955명",
                causal=None,
            )),
        ),
        reads=("fasting_glucose", "hba1c"),
    ),
    Signal(
        "diabetes_history", "당뇨병 진단 이력", "glycemia", _diabetes_history,
        (
            Link("cvd_risk", 2, Evidence(
                "당뇨병은 심혈관질환의 주요 위험인자",
                "한국지질동맥경화학회 이상지질혈증 진료지침",
                causal=True,
            )),
            Link("ckd_risk", 2, Evidence(
                "당뇨병성 신증은 말기신부전의 가장 흔한 원인",
                "KDIGO 2012 CKD 진료지침",
                causal=True,
            )),
        ),
        reads=("has_diabetes",),
    ),
    # --- 요산 -------------------------------------------------------------
    Signal(
        "uric_acid_high", "고요산혈증", "urate", _uric_acid_high,
        (
            Link("ckd_risk", 1, Evidence(
                "RR 1.15 (95% CI 1.10-1.21) 요산 1 mg/dL 증가당, 고요산혈증 자체는 RR 1.17",
                "Zhu 2021 코호트 + 갱신 메타분석 30개 코호트",
                causal=None,
            )),
            Link("htn_risk", 1, Evidence(
                "고혈압 동반 시 신기능 저하와의 연관이 더 강해진다",
                "Kuwabara 2013 PLOS One — 요산·CKD 관계에서 고혈압의 역할",
                causal=None,
            )),
        ),
        reads=("uric_acid",),
    ),
    # --- 콩팥 손상 --------------------------------------------------------
    Signal(
        "albuminuria_a3", "고도 알부민뇨", "kidney_damage", _albuminuria_a3,
        (
            Link("cvd_risk", 3, Evidence(
                "심혈관 사망 HR 2.32 (95% CI 1.31-4.12), ACR 30 미만 대비",
                "CKD Prognosis Consortium 계열 분석. eGFR 과 독립적으로 예측한다",
                causal=None,
            )),
        ),
        reads=("urine_acr",),
    ),
    Signal(
        "albuminuria_a2", "중등도 알부민뇨", "kidney_damage", _albuminuria_a2,
        (
            Link("cvd_risk", 1, Evidence(
                "심혈관 사망 HR 1.08 (95% CI 0.77-1.50) — 신뢰구간이 1을 지난다",
                "CKD Prognosis Consortium 계열 분석. A3 와 달리 이 구간은 통계적으로 유의하지 않다",
                causal=None,
            )),
        ),
        reads=("urine_acr",),
    ),
    Signal(
        "egfr_low", "eGFR 감소", "kidney_function", _egfr_low,
        (
            Link("cvd_risk", 2, Evidence(
                "만성콩팥병은 그 자체로 심혈관 위험을 올린다",
                "KDIGO 2012 CKD 진료지침 — CKD 환자는 말기신부전보다 심혈관 사망이 더 흔하다",
                causal=True,
            )),
        ),
        reads=("creatinine",),
    ),
    # --- 혈압 -------------------------------------------------------------
    Signal(
        "bp_hypertensive", "혈압 140/90 이상", "blood_pressure", _bp_hypertensive,
        (
            Link("cvd_risk", 3, Evidence(
                "혈압은 뇌졸중·심근경색의 가장 큰 교정 가능 위험인자",
                "대한고혈압학회 진료지침",
                causal=True,
            )),
            Link("ckd_risk", 2, Evidence(
                "고혈압은 당뇨에 이은 말기신부전의 두 번째 원인",
                "KDIGO 2012 CKD 진료지침",
                causal=True,
            )),
        ),
        reads=("systolic_bp", "diastolic_bp"),
    ),
    Signal(
        "bp_elevated", "혈압 130/80 이상", "blood_pressure", _bp_elevated,
        (
            Link("cvd_risk", 1, Evidence(
                "고혈압 전단계에서도 위험이 이미 오르기 시작한다",
                "대한고혈압학회 진료지침 — 주의혈압·고혈압전단계 구간",
                causal=True,
            )),
            Link("htn_risk", 2, Evidence(
                "이 구간은 고혈압으로 진행할 확률이 높다",
                "대한고혈압학회 진료지침",
                causal=True,
            )),
        ),
        reads=("systolic_bp", "diastolic_bp"),
    ),
    Signal(
        "hypertension_history", "고혈압 진단 이력", "blood_pressure", _hypertension_history,
        (
            Link("cvd_risk", 2, Evidence(
                "고혈압은 심혈관질환의 주요 위험인자",
                "한국지질동맥경화학회 이상지질혈증 진료지침 — 위험인자 계수 항목",
                causal=True,
            )),
            Link("ckd_risk", 2, Evidence(
                "고혈압성 신증",
                "KDIGO 2012 CKD 진료지침",
                causal=True,
            )),
        ),
        reads=("has_hypertension",),
    ),
    # --- 몸집 -------------------------------------------------------------
    Signal(
        "central_obesity", "복부비만", "adiposity", _central_obesity,
        (
            Link("dm_risk", 2, Evidence(
                "복부비만은 인슐린저항성의 직접 지표",
                "대한비만학회 2024 비만 진료지침 — 허리둘레 남 90 / 여 85 cm",
                causal=True,
            )),
            Link("htn_risk", 2, Evidence(
                "체중 증가는 혈압 상승과 함께 간다",
                "대한비만학회 2024 비만 진료지침",
                causal=True,
            )),
            Link("cvd_risk", 1, Evidence(
                "복부비만은 대사증후군의 필수 구성 요소",
                "대한비만학회 2024 비만 진료지침",
                causal=None,
            )),
        ),
        reads=("waist_cm",),
    ),
    Signal(
        "obese_bmi", "비만 (BMI 25 이상)", "adiposity", _obese_bmi,
        (
            Link("dm_risk", 2, Evidence(
                "BMI 25 이상부터 당뇨 유병률이 꺾여 올라간다",
                "대한비만학회 2024 비만 진료지침 — 한국인은 서구 기준(30)보다 낮은 BMI 에서 위험이 오른다",
                causal=True,
            )),
            Link("htn_risk", 1, Evidence(
                "체중과 혈압의 관계",
                "대한비만학회 2024 비만 진료지침",
                causal=True,
            )),
        ),
        reads=("bmi", "height_cm", "weight_kg"),
    ),
    # --- 지질 -------------------------------------------------------------
    Signal(
        "ldl_high", "LDL 콜레스테롤 높음", "lipid_atherogenic", _ldl_high,
        (
            Link("cvd_risk", 2, Evidence(
                "LDL 은 동맥경화의 인과적 원인이다 — 낮출수록 사건이 준다",
                "한국지질동맥경화학회 이상지질혈증 진료지침. 유전연구·중재시험이 함께 지지한다",
                causal=True,
            )),
        ),
        reads=("ldl_c",),
    ),
    Signal(
        "tg_high", "중성지방 높음", "lipid_atherogenic", _tg_high,
        (
            Link("cvd_risk", 1, Evidence(
                "중성지방 200 mg/dL 이상은 위험 구간",
                "한국지질동맥경화학회 이상지질혈증 진료지침. 500 이상은 심혈관보다 췌장염이 먼저 문제가 된다",
                causal=None,
            )),
        ),
        reads=("triglycerides",),
    ),
    Signal(
        "hdl_low", "HDL 콜레스테롤 낮음", "lipid_hdl", _hdl_low,
        (
            Link("cvd_risk", 1, Evidence(
                "위험인자로 오래 쓰였지만 HDL 을 올리는 약은 심근경색을 줄이지 못했다",
                "한국지질동맥경화학회 지침의 주요 위험인자. 이 저장소의 NHANES 사망 연계에서도 "
                "낮은 HDL 단독으로는 장기 사망을 가르지 못했다 (Harrell C=0.506)",
                causal=False,
            )),
        ),
        reads=("hdl_c",),
    ),
    # --- 생활·인구 --------------------------------------------------------
    Signal(
        "smoking", "현재 흡연", "smoking", _smoking,
        (
            Link("cvd_risk", 3, Evidence(
                "흡연은 심혈관질환의 주요 위험인자이며 끊으면 위험이 내려간다",
                "한국지질동맥경화학회 이상지질혈증 진료지침 — 위험인자 계수 항목",
                causal=True,
            )),
            Link("dm_risk", 2, Evidence(
                "RR 1.44 (95% CI 1.31-1.58), 현재 흡연자",
                "Willi 2007 JAMA 메타분석",
                causal=None,
            )),
            Link("ckd_risk", 1, Evidence(
                "흡연은 알부민뇨와 신기능 저하 속도를 올린다",
                "KDIGO 2012 CKD 진료지침의 진행 위험인자",
                causal=None,
            )),
        ),
        reads=("smoking",),
    ),
    Signal(
        "age_risk", "연령 위험 구간", "age", _age_risk,
        (
            Link("cvd_risk", 1, Evidence(
                "남 45세 / 여 55세 이상은 주요 위험인자로 센다",
                "한국지질동맥경화학회 이상지질혈증 진료지침",
                causal=True,
            )),
        ),
        reads=("age",),
    ),
)

# 합산 점수 -> 등급. 클러스터 최댓값을 무리끼리 더한 값이라 3점이면 서로 다른 재료
# 두세 가지가 같은 질환을 함께 가리킨다는 뜻이다.
_SCORE_BANDS = [(6, RiskLevel.VERY_HIGH), (3, RiskLevel.HIGH), (1, RiskLevel.CAUTION), (0, RiskLevel.NORMAL)]

# 등급은 개수가 아니라 가중 점수로 정해진다. 문구에서 개수를 말하면 어긋난다 —
# 1점짜리 둘이 붙어도 CAUTION 이라 "하나 보여요" 가 거짓말이 된다. 개수는 sub_status 가 적는다.
_LABEL = {
    RiskLevel.NORMAL: "{name} 쪽으로 잡히는 위험 신호가 없어요.",
    RiskLevel.CAUTION: "{name} 쪽으로 볼 만한 신호가 있어요.",
    RiskLevel.HIGH: "{name} 위험 신호가 여러 개 겹쳐요.",
    RiskLevel.VERY_HIGH: "{name} 위험 신호가 많이 겹쳐요.",
}

_RECOMMENDATION = {
    RiskLevel.NORMAL: "지금 입력한 값에서는 따로 조치할 것이 없습니다.",
    RiskLevel.CAUTION: "한 가지 신호만으로 앞날이 정해지지는 않습니다. 다음 검진에서 같은 값을 다시 확인해 보세요.",
    RiskLevel.HIGH: "서로 다른 검사에서 같은 방향의 신호가 겹쳤습니다. 진료로 확인해 보시길 권합니다.",
    RiskLevel.VERY_HIGH: "여러 신호가 한 질환을 함께 가리킵니다. 의료기관 상담을 권합니다.",
}


def _band(score: int) -> RiskLevel:
    return next(level for floor, level in _SCORE_BANDS if score >= floor)


def detect_signals(profile: dict[str, Any]) -> list[dict[str, Any]]:
    """프로필에서 걸리는 신호를 전부 찾는다 — **수치별로 읽는 쪽**의 출력.

    각 항목은 어떤 값이 왜 걸렸고 어느 질환들을 얼마나 가리키는지를 함께 담는다.
    """
    found: list[dict[str, Any]] = []
    for signal in SIGNALS:
        hit = signal.detect(profile)
        if hit is None:
            continue
        detail, values = hit
        found.append(
            {
                "key": signal.key,
                "label": signal.label,
                "detail": detail,
                "cluster": signal.cluster,
                "values": values,
                "implies": [
                    {
                        "disease": link.disease,
                        "disease_name": DISEASES[link.disease],
                        "weight": link.weight,
                        "effect": link.evidence.effect,
                        "source": link.evidence.source,
                        "causal": link.evidence.causal,
                    }
                    for link in signal.links
                ],
            }
        )
    return found


def _score_disease(disease: str, signals: list[dict[str, Any]]) -> tuple[int, list[dict[str, Any]]]:
    """같은 무리 안에서는 최댓값 하나만, 무리끼리는 더한다.

    γ-GTP·ALT·지방간지수를 따로 더하면 간에 낀 지방 하나를 세 번 세게 된다.
    """
    by_cluster: dict[str, tuple[int, dict[str, Any]]] = {}
    for signal in signals:
        for implication in signal["implies"]:
            if implication["disease"] != disease:
                continue
            entry = {**signal, "weight": implication["weight"], "evidence": implication}
            cluster = signal["cluster"]
            if cluster not in by_cluster or implication["weight"] > by_cluster[cluster][0]:
                by_cluster[cluster] = (implication["weight"], entry)
    chosen = [entry for _, entry in by_cluster.values()]
    chosen.sort(key=lambda e: -e["weight"])
    return sum(weight for weight, _ in by_cluster.values()), chosen


def _readable(profile: dict[str, Any], disease: str) -> tuple[list[str], list[str]]:
    """이 질환을 보려면 무엇을 읽어야 하는지, 그중 무엇이 없는지.

    신호별 `reads` 는 "이 중 하나라도 있으면 본다" 이므로 신호 단위로 판단한다.
    BMI 는 키·체중으로도 만들 수 있어서 셋 중 아무거나 있으면 읽은 것으로 친다.
    """
    present, absent = [], []
    for signal in SIGNALS:
        if not any(link.disease == disease for link in signal.links):
            continue
        if any(profile.get(field) is not None for field in signal.reads):
            present.append(signal.key)
        else:
            absent.append(signal.label)
    return present, absent


def _insufficient_result(disease: str, name: str, absent: list[str]) -> dict[str, Any]:
    return {
        "category": disease,
        "risk_level": RiskLevel.INSUFFICIENT_DATA.value,
        "sub_status": "정보 부족",
        "display_label": f"{name} 위험을 볼 수 있는 값이 하나도 없어요.",
        "reason": f"{name} 쪽 신호를 읽으려면 최소한 한 가지 검사값이나 문진 답변이 필요합니다.",
        "input_values": {},
        "criteria_reference": "-",
        "recommendation": "검진 결과지의 수치를 입력하면 어떤 값이 이 질환을 가리키는지 짚어 드립니다.",
        "flags": [],
        "missing_fields": absent,
        "contributors": [],
        "score": 0,
        "disclaimer": COMMON_DISCLAIMER,
    }


def _diagnosed_result(disease: str, name: str) -> dict[str, Any]:
    return {
        "category": disease,
        "risk_level": RiskLevel.INSUFFICIENT_DATA.value,
        "sub_status": "이미 진단됨",
        "display_label": f"{name}은(는) 이미 진단받으셨다고 하셨어요.",
        "reason": f"{name} 진단 이력이 있어 발병 위험을 따로 세지 않았습니다. 이 값들은 관리 상태를 보는 데 씁니다.",
        "input_values": {},
        "criteria_reference": "-",
        "recommendation": "진단받은 질환은 위험 예측이 아니라 정기적인 관리와 추적이 필요합니다.",
        "flags": [],
        "missing_fields": [],
        "contributors": [],
        "score": 0,
        "disclaimer": COMMON_DISCLAIMER,
    }


def assess_disease_risks(profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """질환별로 모아 읽는 쪽의 출력. 아홉 영역과 같은 키 모양을 낸다."""
    signals = detect_signals(profile)
    results: dict[str, dict[str, Any]] = {}

    for disease, name in DISEASES.items():
        history_field = _ALREADY_DIAGNOSED.get(disease)
        if history_field and profile.get(history_field) is True:
            results[disease] = _diagnosed_result(disease, name)
            continue

        # 볼 값이 아예 없으면 "신호가 없다" 가 아니라 "못 봤다" 다. 안 낸 검사를
        # 통과했다고 말하지 않기 위해 여기서 갈라 낸다.
        present, absent = _readable(profile, disease)
        if not present:
            results[disease] = _insufficient_result(disease, name, absent)
            continue

        score, contributors = _score_disease(disease, signals)
        level = _band(score)
        flags: list[str] = []
        if absent:
            # 부분 판정이라는 사실을 등급과 같이 보여 준다. 신호 셋 중 하나만 보고
            # 낸 NORMAL 과 전부 보고 낸 NORMAL 은 무게가 다르다.
            flags.append(
                f"이 판정은 입력된 {len(present)}가지만 보고 냈습니다. "
                f"{', '.join(absent[:4])}{' 등' if len(absent) > 4 else ''}은(는) 확인하지 못했습니다."
            )

        # 인과가 아니라고 밝혀진 고리가 섞여 있으면 그렇게 적는다. 이걸 빼면 화면이
        # "이것 때문에 병이 생긴다"로 읽힌다.
        associational = [c["label"] for c in contributors if c["evidence"]["causal"] is False]
        if associational:
            flags.append(
                f"{', '.join(associational)}은(는) 같은 값을 가진 사람들에게서 이 질환이 더 잦았다는 뜻이지, "
                "그 값이 원인이라는 뜻은 아닙니다."
            )
        if level != RiskLevel.NORMAL and len(contributors) == 1:
            flags.append("신호가 하나뿐입니다. 한 가지 값만으로는 앞날을 말하기 어렵습니다.")

        if contributors:
            reason = " · ".join(f"{c['detail']}" for c in contributors)
        else:
            reason = "입력한 값 중에서 이 질환을 가리키는 신호가 잡히지 않았습니다."

        results[disease] = {
            "category": disease,
            "risk_level": level.value,
            "sub_status": f"위험 신호 {len(contributors)}개 (가중 {score}점)",
            "display_label": _LABEL[level].format(name=name),
            "reason": reason,
            "input_values": {k: v for c in contributors for k, v in c["values"].items()},
            "criteria_reference": "국내 학회 지침 임계값 + 각 신호별 코호트·메타분석 (contributors 참조)",
            "recommendation": _RECOMMENDATION[level],
            "flags": flags,
            "missing_fields": absent,
            "contributors": [
                {
                    "key": c["key"],
                    "label": c["label"],
                    "detail": c["detail"],
                    "weight": c["weight"],
                    "effect": c["evidence"]["effect"],
                    "source": c["evidence"]["source"],
                    "causal": c["evidence"]["causal"],
                }
                for c in contributors
            ],
            "score": score,
            "disclaimer": COMMON_DISCLAIMER,
        }

    return results
