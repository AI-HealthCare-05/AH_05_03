"""검진 결과지 수치에 단계를 매긴다 — 규칙 엔진이 다루지 않는 네 영역.

`chronic_disease_engine/` 은 팀원 PR 에서 그대로 가져온 코드고 고혈압·비만·
이상지질혈증·당뇨 넷만 판정한다. 한 글자도 고치지 않는 것이 그 디렉터리의 규칙이라
(`PROVENANCE.md`, 체크섬 검사) 새 영역은 **여기에** 따로 만든다.

출력은 그 엔진의 `DomainResult` 와 같은 모양이다. 화면과 API 가 둘을 구분하지 않고
같은 카드로 그릴 수 있어야 하기 때문이다. `RiskLevel` 도 그쪽 것을 그대로 쓴다 —
등급 체계가 갈리면 "주의" 가 영역마다 다른 뜻이 된다.

네 영역과 근거는 이렇다.

* **신장** — KDIGO 2012/2024. eGFR 6구간(G1~G5)과 알부민뇨 3구간(A1~A3)을 **함께**
  읽는다. 둘 중 하나만 보면 안 된다는 것이 KDIGO heat map 의 요지다.
* **간** — ALT 상한을 40 이 아니라 **남 33 / 여 25** 로 잡는다. 40 은 지방간 환자가
  섞인 옛 참고집단에서 나온 값이라 실제 정상보다 높다. 상승 폭은 상한의 배수로 적는다.
* **요산** — 남 7.0 / 여 6.0 초과가 고요산혈증. 통풍 발생률이 7.0 미만 0.1%,
  7.0~8.9 는 0.5%, 9.0 이상은 4.9% 로 갈려서 그 지점에 단계를 둔다.
* **빈혈** — WHO. 진단선(남 13 / 여 12)과 중증도(경증·중등도·중증)를 나눠 적는다.

**진단이 아니다.** 한 번 잰 값 하나로 병을 말할 수 없고, KDIGO 는 3개월 지속을
요구한다. 화면 문구가 그 선을 넘지 않도록 `sub_status` 에는 구간 이름만 적고
`display_label` 은 행동을 말한다.
"""

from __future__ import annotations

import math
from typing import Any

from chronic_disease_engine.schemas import COMMON_DISCLAIMER, RiskLevel

from app.services.risk import egfr_ckd_epi_2021

# ALT 정상 상한. 40 IU/L 은 지방간·간염 보인자가 섞인 참고집단에서 나온 값이고,
# 건강한 헌혈자만으로 다시 잡으면 이 정도로 내려간다.
ALT_UPPER = {"M": 33.0, "F": 25.0}
AST_UPPER = {"M": 40.0, "F": 32.0}
GGT_UPPER = {"M": 73.0, "F": 38.0}

URIC_ACID_UPPER = {"M": 7.0, "F": 6.0}

# WHO 빈혈 진단선과 중증도. 임신부는 기준이 달라(11.0) 여기서 다루지 않는다.
HEMOGLOBIN_FLOOR = {"M": 13.0, "F": 12.0}


def _result(
    category: str,
    risk: RiskLevel,
    sub_status: str,
    label: str,
    reason: str,
    values: dict[str, Any],
    reference: str,
    recommendation: str,
    missing: list[str] | None = None,
    flags: list[str] | None = None,
) -> dict[str, Any]:
    """벤더 엔진의 `DomainResult` 와 같은 키를 낸다."""
    return {
        "category": category,
        "risk_level": risk.value,
        "sub_status": sub_status,
        "display_label": label,
        "reason": reason,
        "input_values": values,
        "criteria_reference": reference,
        "recommendation": recommendation,
        "flags": flags or [],
        "missing_fields": missing or [],
        "disclaimer": COMMON_DISCLAIMER,
    }


def _insufficient(category: str, missing: list[str], what: str) -> dict[str, Any]:
    return _result(
        category,
        RiskLevel.INSUFFICIENT_DATA,
        "정보 부족",
        f"{what} 정보가 부족해 판단할 수 없어요.",
        f"{', '.join(missing)} 값이 필요합니다.",
        {},
        "-",
        "검진 결과지에서 해당 수치를 확인해 입력해 주세요.",
        missing=missing,
    )


# ---------------------------------------------------------------------------
# 신장 — KDIGO
# ---------------------------------------------------------------------------

# (하한, 구간 이름). eGFR 이 이 값 이상이면 그 구간이다.
_GFR_BANDS = [
    (90.0, "G1", "정상 또는 높음"),
    (60.0, "G2", "경도 감소"),
    (45.0, "G3a", "경도~중등도 감소"),
    (30.0, "G3b", "중등도~고도 감소"),
    (15.0, "G4", "고도 감소"),
    (0.0, "G5", "신부전 범위"),
]
_ACR_BANDS = [(300.0, "A3", "고도 알부민뇨"), (30.0, "A2", "중등도 알부민뇨"), (0.0, "A1", "정상~경도")]

# KDIGO heat map. (G 구간, A 구간) -> 위험도. 색 하나가 관리 주기와 의뢰 여부를 정한다.
_KDIGO_RISK = {
    ("G1", "A1"): RiskLevel.NORMAL, ("G1", "A2"): RiskLevel.CAUTION, ("G1", "A3"): RiskLevel.HIGH,
    ("G2", "A1"): RiskLevel.NORMAL, ("G2", "A2"): RiskLevel.CAUTION, ("G2", "A3"): RiskLevel.HIGH,
    ("G3a", "A1"): RiskLevel.CAUTION, ("G3a", "A2"): RiskLevel.HIGH, ("G3a", "A3"): RiskLevel.VERY_HIGH,
    ("G3b", "A1"): RiskLevel.HIGH, ("G3b", "A2"): RiskLevel.VERY_HIGH, ("G3b", "A3"): RiskLevel.VERY_HIGH,
    ("G4", "A1"): RiskLevel.VERY_HIGH, ("G4", "A2"): RiskLevel.VERY_HIGH, ("G4", "A3"): RiskLevel.VERY_HIGH,
    ("G5", "A1"): RiskLevel.VERY_HIGH, ("G5", "A2"): RiskLevel.VERY_HIGH, ("G5", "A3"): RiskLevel.VERY_HIGH,
}


def evaluate_kidney(profile: dict[str, Any]) -> dict[str, Any]:
    creatinine, age, sex = profile.get("creatinine"), profile.get("age"), profile.get("sex")
    acr = profile.get("urine_acr")

    missing = [name for name, value in (("크레아티닌", creatinine), ("나이", age), ("성별", sex)) if value is None]
    if missing:
        return _insufficient("kidney", missing, "신장")

    gfr = egfr_ckd_epi_2021(float(creatinine), float(age), str(sex))
    g_code, g_name = next((code, name) for low, code, name in _GFR_BANDS if gfr >= low)

    if acr is None:
        # 알부민뇨를 모르면 A1 으로 가정하지 않는다. eGFR 만으로 읽되 그 사실을 적는다.
        risk = _KDIGO_RISK[(g_code, "A1")]
        note = "요알부민/크레아티닌비를 모르면 같은 eGFR 이라도 위험이 한 단계 높을 수 있습니다."
        return _result(
            "kidney", risk, f"{g_code} {g_name}",
            "eGFR 만으로 본 신장 기능입니다." if risk == RiskLevel.NORMAL else "신장 기능 확인이 필요해요.",
            f"크레아티닌 {creatinine} mg/dL 로 계산한 eGFR 은 {gfr:.0f} mL/min/1.73m² 이고 {g_code}({g_name}) 구간입니다.",
            {"creatinine": creatinine, "egfr": round(gfr, 1)},
            "KDIGO 2012 CKD 진료지침 (eGFR: CKD-EPI 2021)",
            "요알부민/크레아티닌비를 함께 확인하면 판단이 정확해집니다.",
            missing=["요알부민/크레아티닌비"], flags=[note],
        )

    a_code, a_name = next((code, name) for low, code, name in _ACR_BANDS if float(acr) >= low)
    risk = _KDIGO_RISK[(g_code, a_code)]
    label = {
        RiskLevel.NORMAL: "신장 기능이 기준 안에 있어요.",
        RiskLevel.CAUTION: "신장 기능을 지켜볼 단계예요.",
        RiskLevel.HIGH: "신장 기능 확인이 필요해요.",
        RiskLevel.VERY_HIGH: "신장 기능이 많이 떨어져 있어요.",
    }[risk]
    return _result(
        "kidney", risk, f"{g_code}{a_code} · {g_name} / {a_name}", label,
        f"eGFR {gfr:.0f} mL/min/1.73m²({g_code})과 요알부민/크레아티닌비 {acr} mg/g({a_code})를 "
        f"함께 읽은 결과입니다. KDIGO 는 두 값을 따로 보지 않습니다.",
        {"creatinine": creatinine, "egfr": round(gfr, 1), "urine_acr": acr},
        "KDIGO 2012 CKD 진료지침 heat map (eGFR: CKD-EPI 2021)",
        "한 번 잰 값입니다. KDIGO 는 3개월 이상 지속될 때 만성콩팥병으로 봅니다 — 재검을 권합니다."
        if risk != RiskLevel.NORMAL else "현재 기준으로는 추가 조치가 필요하지 않습니다.",
    )


# ---------------------------------------------------------------------------
# 간
# ---------------------------------------------------------------------------


def evaluate_liver(profile: dict[str, Any]) -> dict[str, Any]:
    sex = profile.get("sex")
    ast, alt, ggt = profile.get("ast"), profile.get("alt"), profile.get("ggt")
    if sex is None or (ast is None and alt is None and ggt is None):
        return _insufficient("liver", ["성별"] if sex is None else ["AST", "ALT", "γ-GTP"], "간 기능")

    key = str(sex)
    worst, parts, values = RiskLevel.NORMAL, [], {}
    for name, value, upper in (("AST", ast, AST_UPPER[key]), ("ALT", alt, ALT_UPPER[key]), ("γ-GTP", ggt, GGT_UPPER[key])):
        if value is None:
            continue
        values[name] = value
        ratio = float(value) / upper
        # 상한의 몇 배인지로 읽는 것이 임상 관례다. 절대값은 검사실마다 다르다.
        level = (
            RiskLevel.NORMAL if ratio <= 1
            else RiskLevel.CAUTION if ratio <= 2
            else RiskLevel.HIGH if ratio <= 5
            else RiskLevel.VERY_HIGH
        )
        if level != RiskLevel.NORMAL:
            parts.append(f"{name} {value}(정상 상한 {upper:g}의 {ratio:.1f}배)")
        if _order(level) > _order(worst):
            worst = level

    sub = {
        RiskLevel.NORMAL: "정상 범위",
        RiskLevel.CAUTION: "경도 상승 (상한의 2배 이내)",
        RiskLevel.HIGH: "중등도 상승 (상한의 2~5배)",
        RiskLevel.VERY_HIGH: "고도 상승 (상한의 5배 초과)",
    }[worst]
    label = {
        RiskLevel.NORMAL: "간 효소 수치가 기준 안에 있어요.",
        RiskLevel.CAUTION: "간 효소가 조금 올라 있어요.",
        RiskLevel.HIGH: "간 효소가 눈에 띄게 올라 있어요.",
        RiskLevel.VERY_HIGH: "간 효소가 많이 올라 있어요.",
    }[worst]
    return _result(
        "liver", worst, sub, label,
        ", ".join(parts) + " 입니다." if parts else "입력한 간 효소가 모두 정상 상한 안에 있습니다.",
        values,
        "ALT 정상 상한은 건강한 집단에서 다시 잡은 남 33 / 여 25 IU/L 을 씁니다 (검사실 표준 40 이 아님)",
        "간 효소 상승은 원인이 여럿입니다 — 지방간·음주·약물·간염. 원인을 가리려면 진료가 필요합니다."
        if worst != RiskLevel.NORMAL else "현재 기준으로는 추가 조치가 필요하지 않습니다.",
        missing=[n for n, v in (("AST", ast), ("ALT", alt), ("γ-GTP", ggt)) if v is None],
    )


# ---------------------------------------------------------------------------
# 지방간 지수 (FLI)
# ---------------------------------------------------------------------------


def resolve_bmi(profile: dict[str, Any]) -> float | None:
    """BMI 를 직접 받았으면 그대로, 없으면 키·체중으로 만든다.

    벤더 엔진은 `HealthProfileInput` 의 validator 에서 같은 계산을 하지만 그쪽은
    pydantic 모델을 받는다. 이 계층은 평범한 dict 를 받으므로 따로 필요하다.
    """
    bmi = profile.get("bmi")
    if bmi is not None:
        return float(bmi)
    height, weight = profile.get("height_cm"), profile.get("weight_kg")
    if height and weight:
        return float(weight) / (float(height) / 100) ** 2
    return None


def fatty_liver_index(profile: dict[str, Any]) -> tuple[float | None, list[str]]:
    """Bedogni 2006 지방간 지수와, 모자란 재료 이름을 함께 낸다.

    `evaluate_fatty_liver` 와 `disease_risk_matrix` 가 같이 쓴다. 두 곳에서 각자
    계산하면 계수 하나가 어긋나도 아무도 모른다.
    """
    bmi, waist = resolve_bmi(profile), profile.get("waist_cm")
    tg, ggt = profile.get("triglycerides"), profile.get("ggt")

    missing = [
        name
        for name, value in (("BMI(키·체중)", bmi), ("허리둘레", waist), ("중성지방", tg), ("γ-GTP", ggt))
        if value is None
    ]
    if missing:
        return None, missing

    linear = (
        0.953 * math.log(float(tg))
        + 0.139 * float(bmi)
        + 0.718 * math.log(float(ggt))
        + 0.053 * float(waist)
        - 15.745
    )
    return 100.0 / (1.0 + math.exp(-linear)), []


def evaluate_fatty_liver(profile: dict[str, Any]) -> dict[str, Any]:
    """Bedogni 2006 지방간 지수. BMI 를 재료로 쓰는 유일한 영역이다.

    간효소만 보면 지방간을 놓친다 — ALT 가 정상인 지방간이 흔하다. FLI 는 BMI·허리·
    중성지방·γ-GTP 넷을 로지스틱으로 묶어 그 간격을 메운다.

    절단값(30 미만 낮음 / 30~60 중간 / 60 이상 높음)이 실제로 맞는지는
    `docs/26_clinical_feature_engineering.md` §5 에서 확인했다. NHANES 의 CAP
    (간 탄성초음파 실측) 라벨로 구간별 유병률을 세면 8.9% -> 36.0% -> 68.1% 로
    단조롭게 오른다. 구현·단위 변환·라벨이 동시에 맞아야 나오는 그림이다.
    """
    bmi, waist = resolve_bmi(profile), profile.get("waist_cm")
    tg, ggt = profile.get("triglycerides"), profile.get("ggt")

    fli, missing = fatty_liver_index(profile)
    if fli is None:
        return _insufficient("fatty_liver", missing, "지방간 지수")

    if fli < 30:
        risk, sub = RiskLevel.NORMAL, "낮음 (FLI 30 미만)"
    elif fli < 60:
        risk, sub = RiskLevel.CAUTION, "중간 (FLI 30~60)"
    else:
        risk, sub = RiskLevel.HIGH, "높음 (FLI 60 이상)"

    label = {
        RiskLevel.NORMAL: "지방간 가능성이 낮아요.",
        RiskLevel.CAUTION: "지방간 여부를 가리기 어려운 구간이에요.",
        RiskLevel.HIGH: "지방간 가능성이 높아요.",
    }[risk]
    return _result(
        "fatty_liver", risk, sub, label,
        f"BMI {float(bmi):.1f}, 허리 {waist}cm, 중성지방 {tg}mg/dL, γ-GTP {ggt}IU/L 로 계산한 "
        f"지방간 지수는 {fli:.0f} 입니다. 같은 구간의 사람들에서 초음파로 확인된 지방간 비율은 "
        + ("8.9%" if risk == RiskLevel.NORMAL else "36%" if risk == RiskLevel.CAUTION else "68%")
        + " 였습니다.",
        {"bmi": round(float(bmi), 1), "waist_cm": waist, "triglycerides": tg, "ggt": ggt, "fli": round(fli, 1)},
        "Bedogni 2006 Fatty Liver Index. 절단값은 NHANES 의 간 탄성초음파(CAP) 라벨로 확인",
        "지수는 초음파를 대신하지 않습니다. 60 이상이면 복부 초음파를 권합니다."
        if risk == RiskLevel.HIGH else "체중과 허리둘레가 이 지수를 가장 크게 움직입니다."
        if risk == RiskLevel.CAUTION else "현재 기준으로는 추가 조치가 필요하지 않습니다.",
    )


# ---------------------------------------------------------------------------
# 요산
# ---------------------------------------------------------------------------


def evaluate_uric_acid(profile: dict[str, Any]) -> dict[str, Any]:
    value, sex = profile.get("uric_acid"), profile.get("sex")
    missing = [name for name, v in (("요산", value), ("성별", sex)) if v is None]
    if missing:
        return _insufficient("uric_acid", missing, "요산")

    value, upper = float(value), URIC_ACID_UPPER[str(sex)]
    # 통풍 연간 발생률이 갈리는 지점에 단계를 둔다 — 7.0 미만 0.1%, 7.0~8.9 0.5%, 9.0 이상 4.9%.
    if value < upper:
        risk, sub = RiskLevel.NORMAL, "정상 범위"
    elif value < 9.0:
        risk, sub = RiskLevel.CAUTION, "고요산혈증"
    else:
        risk, sub = RiskLevel.HIGH, "고요산혈증 (9.0 mg/dL 이상)"

    label = {
        RiskLevel.NORMAL: "요산 수치가 기준 안에 있어요.",
        RiskLevel.CAUTION: "요산이 기준을 넘었어요.",
        RiskLevel.HIGH: "요산이 많이 높아요.",
    }[risk]
    return _result(
        "uric_acid", risk, sub, label,
        f"요산 {value} mg/dL 는 성별 기준({upper:g} mg/dL) "
        + ("안입니다." if risk == RiskLevel.NORMAL else "을 넘습니다.")
        + (" 9.0 mg/dL 이상에서는 통풍 연간 발생률이 4.9% 로 크게 오릅니다." if risk == RiskLevel.HIGH else ""),
        {"uric_acid": value},
        "고요산혈증 정의 남 7.0 / 여 6.0 mg/dL. 통풍 발생률 구간은 Campion 1987 코호트",
        "요산이 높아도 증상이 없으면 바로 약을 쓰지는 않습니다. 통풍 병력이 있으면 진료를 권합니다."
        if risk != RiskLevel.NORMAL else "현재 기준으로는 추가 조치가 필요하지 않습니다.",
    )


# ---------------------------------------------------------------------------
# 빈혈
# ---------------------------------------------------------------------------


def evaluate_anemia(profile: dict[str, Any]) -> dict[str, Any]:
    value, sex = profile.get("hemoglobin"), profile.get("sex")
    missing = [name for name, v in (("혈색소", value), ("성별", sex)) if v is None]
    if missing:
        return _insufficient("anemia", missing, "빈혈")

    value, floor = float(value), HEMOGLOBIN_FLOOR[str(sex)]
    if value >= floor:
        risk, sub = RiskLevel.NORMAL, "정상 범위"
    elif value >= 11.0:
        risk, sub = RiskLevel.CAUTION, "경증 빈혈"
    elif value >= 8.0:
        risk, sub = RiskLevel.HIGH, "중등도 빈혈"
    else:
        risk, sub = RiskLevel.VERY_HIGH, "중증 빈혈"

    label = {
        RiskLevel.NORMAL: "혈색소가 기준 안에 있어요.",
        RiskLevel.CAUTION: "혈색소가 기준보다 조금 낮아요.",
        RiskLevel.HIGH: "혈색소가 낮아요.",
        RiskLevel.VERY_HIGH: "혈색소가 많이 낮아요.",
    }[risk]
    return _result(
        "anemia", risk, sub, label,
        f"혈색소 {value} g/dL 는 WHO 성별 기준({floor:g} g/dL) "
        + ("이상입니다." if risk == RiskLevel.NORMAL else "미만입니다."),
        {"hemoglobin": value},
        "WHO Haemoglobin concentrations for the diagnosis of anaemia (2011). 임신 중에는 기준이 다릅니다",
        "빈혈은 원인을 찾는 것이 먼저입니다 — 철결핍·출혈·만성질환. 철분제를 먼저 먹지 마시고 진료를 받으세요."
        if risk != RiskLevel.NORMAL else "현재 기준으로는 추가 조치가 필요하지 않습니다.",
        flags=["임신 중인 경우 기준이 11.0 g/dL 로 달라 이 판정을 적용하지 않습니다."] if str(sex) == "F" else None,
    )


_LEVEL_ORDER = [RiskLevel.NORMAL, RiskLevel.CAUTION, RiskLevel.HIGH, RiskLevel.VERY_HIGH]


def _order(level: RiskLevel) -> int:
    return _LEVEL_ORDER.index(level) if level in _LEVEL_ORDER else -1


# 이 계층이 쓰는 입력. 벤더 엔진의 `HealthProfileInput` 에는 없는 필드들이고,
# 그 사실을 검사가 확인한다 — 겹치면 어느 쪽이 읽는지 모호해진다.
# `bmi`·`waist_cm`·`triglycerides` 는 벤더 엔진도 쓰므로 여기 넣지 않는다 —
# 이 집합은 "엔진에 없고 우리만 쓰는 필드" 라는 뜻이다.
STAGING_FIELDS = frozenset({"creatinine", "urine_acr", "ast", "alt", "ggt", "uric_acid", "hemoglobin"})

EXTRA_DOMAINS = {
    "kidney": evaluate_kidney,
    "liver": evaluate_liver,
    "fatty_liver": evaluate_fatty_liver,
    "uric_acid": evaluate_uric_acid,
    "anemia": evaluate_anemia,
}


def assess_extra_domains(profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """규칙 엔진이 다루지 않는 네 영역을 같은 모양으로 판정한다."""
    return {name: evaluate(profile) for name, evaluate in EXTRA_DOMAINS.items()}
