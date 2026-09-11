"""Label definitions for the chronic-disease models.

Why these labels exist
----------------------
Every dataset we can obtain without IRB review is cross-sectional, so a
"5년 내 발병 확률" label has no ground truth to learn from. What the data does
support is a screening label: this person's measured values already meet the
diagnostic thresholds, and in the undiagnosed variant they have never been told.

Panel datasets (한국의료패널, KLoSA) additionally support an incident label built
from consecutive waves. Both live here so the training code never re-derives a
threshold inline.

THRESHOLDS ARE PROVISIONAL. The values below follow the criteria in common
clinical use (FPG >= 126 mg/dL, HbA1c >= 6.5%, BP >= 140/90 mmHg). Before the
numbers reach a user-facing screen the team must confirm them against the
current 대한당뇨병학회 / 대한고혈압학회 진료지침 and record the review in the
model card. See `docs/planning/01_PRD.md` Q3, Q4.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from schema import INCIDENCE_HORIZONS_YEARS, INCIDENCE_SOURCES, incidence_label


@dataclass(frozen=True)
class Thresholds:
    """Diagnostic cut-offs. Change here, nowhere else.

    ``source`` on each block records which guideline the number came from. Two
    conditions in this file use *different* HDL cut-offs on purpose: 이상지질혈증
    reads low HDL at 40 mg/dL for both sexes, 대사증후군 reads it at 40 남 / 50 여.
    A woman with HDL 45 is therefore a 대사증후군 component and not 이상지질혈증,
    and a screen that shows both cards has to say which society each came from.
    """

    fasting_glucose_diabetes: float = 126.0  # mg/dL
    fasting_glucose_prediabetes: float = 100.0
    hba1c_diabetes: float = 6.5  # %
    hba1c_prediabetes: float = 5.7
    sbp_hypertension: float = 140.0  # mmHg
    dbp_hypertension: float = 90.0

    # 이상지질혈증 — 한국지질·동맥경화학회 진료지침 제5판(2022)
    total_chol_high: float = 240.0  # mg/dL
    ldl_high: float = 160.0
    triglyceride_high: float = 200.0
    hdl_low: float = 40.0  # 남녀 공통

    # 대사증후군 — NCEP ATP III 개정(2005). 허리둘레만 대한비만학회 한국 기준
    mets_waist_male: float = 90.0  # cm
    mets_waist_female: float = 85.0
    mets_triglyceride: float = 150.0
    mets_hdl_male: float = 40.0
    mets_hdl_female: float = 50.0
    mets_sbp: float = 130.0
    mets_dbp: float = 85.0
    mets_glucose: float = 100.0

    # 신장 — KDIGO 2012. eGFR 은 CKD-EPI 2021 race-free
    egfr_low: float = 60.0  # mL/min/1.73m^2
    urine_acr_high: float = 30.0  # mg/g

    # 지방간 — 간 탄성초음파 CAP 의 S1 이상 컷오프 (Karlas 2017 메타분석)
    cap_steatosis: float = 274.0  # dB/m
    # ALT 상한. CAP 이 없는 주기의 대리 라벨이지 지방간 진단 기준이 아니다.
    alt_high_male: float = 34.0  # IU/L
    alt_high_female: float = 25.0

    # 빈혈 — WHO 기준
    hemoglobin_low_male: float = 13.0  # g/dL
    hemoglobin_low_female: float = 12.0

    # 비만 — 대한비만학회 비만진료지침 2022. **WHO 30 이 아니라 25 다.**
    # 아시아인은 같은 BMI 에서 체지방률과 대사질환 위험이 더 높아 기준이 따로 있다.
    # 이 숫자를 30 으로 바꾸면 국내 유병률이 3분의 1로 줄고 카드의 뜻이 달라진다.
    bmi_obesity: float = 25.0  # kg/m^2

    # 고요산혈증 — 요산 용해도 한계(약 6.8 mg/dL)에서 온 값. 여성은 폐경 전
    # 에스트로겐의 요산 배설 촉진 때문에 분포가 낮아 컷오프도 낮다.
    uric_acid_high_male: float = 7.0  # mg/dL
    uric_acid_high_female: float = 6.0

    # 만성염증 — AHA/CDC 2003 심혈관 위험 3구간의 상단(<1 저 / 1~3 중 / >3 고).
    #
    # **급성 경계를 따로 두는 것이 이 라벨의 핵심이다.** 10 mg/L 를 넘으면 AHA 는
    # 심혈관 위험으로 읽지 말고 2주 뒤 다시 재라고 한다 — 감염·외상·수술처럼
    # 일시적인 원인이 그 구간을 만든다. 실측으로 CRP 측정자의 9.5% 가 여기 걸린다.
    # 이들을 양성으로 두면 모델이 만성염증이 아니라 **감기를 맞히게** 된다.
    crp_chronic_high: float = 3.0  # mg/L
    crp_acute: float = 10.0  # mg/L. 초과는 라벨에서 뺀다(양성도 음성도 아니다)

    reviewed_by: str | None = None  # fill in once a clinician signs off
    reviewed_on: str | None = None


DEFAULT = Thresholds()


def _truthy(series: pd.Series) -> pd.Series:
    """Treat NA as False for OR-combination without turning NA into a value."""
    return series.fillna(False).astype(bool)


def _column(frame: pd.DataFrame, name: str) -> pd.Series:
    """Column if present, otherwise an all-NA column of the same length."""
    if name in frame.columns:
        return frame[name]
    return pd.Series(pd.NA, index=frame.index, dtype="object")


def _numeric(frame: pd.DataFrame, name: str) -> pd.Series:
    return pd.to_numeric(_column(frame, name), errors="coerce")


def add_prevalence_labels(frame: pd.DataFrame, thresholds: Thresholds = DEFAULT) -> pd.DataFrame:
    """Attach prevalent / undiagnosed / prediabetes labels.

    ``label_*_prevalent`` is NA when the row carries no evidence either way —
    for diabetes that means no glucose, no HbA1c, no self-report, no medication.
    Dropping those rows is the caller's decision.
    """
    result = frame.copy()

    glucose = _numeric(result, "fasting_glucose")
    hba1c = _numeric(result, "hba1c")
    sbp = _numeric(result, "sbp")
    dbp = _numeric(result, "dbp")

    dx_dm = _column(result, "dx_diabetes")
    med_dm = _column(result, "med_diabetes")
    dx_htn = _column(result, "dx_hypertension")
    med_htn = _column(result, "med_hypertension")

    dm_positive = (
        (glucose >= thresholds.fasting_glucose_diabetes).fillna(False)
        | (hba1c >= thresholds.hba1c_diabetes).fillna(False)
        | _truthy(dx_dm)
        | _truthy(med_dm)
    )
    # Evidence exists when at least one input is present.
    dm_known = glucose.notna() | hba1c.notna() | dx_dm.notna() | med_dm.notna()
    result["label_dm_prevalent"] = dm_positive.astype("boolean").where(dm_known)

    htn_positive = (
        (sbp >= thresholds.sbp_hypertension).fillna(False)
        | (dbp >= thresholds.dbp_hypertension).fillna(False)
        | _truthy(dx_htn)
        | _truthy(med_htn)
    )
    htn_known = sbp.notna() | dbp.notna() | dx_htn.notna() | med_htn.notna()
    result["label_htn_prevalent"] = htn_positive.astype("boolean").where(htn_known)

    # Undiagnosed: meets the measured threshold but was never told and takes no
    # medication. This is the label the service can act on honestly.
    dm_measured = (glucose >= thresholds.fasting_glucose_diabetes).fillna(False) | (
        hba1c >= thresholds.hba1c_diabetes
    ).fillna(False)
    result["label_dm_undiagnosed"] = (
        (dm_measured & ~_truthy(dx_dm) & ~_truthy(med_dm)).astype("boolean").where(dm_known)
    )

    htn_measured = (sbp >= thresholds.sbp_hypertension).fillna(False) | (dbp >= thresholds.dbp_hypertension).fillna(
        False
    )
    result["label_htn_undiagnosed"] = (
        (htn_measured & ~_truthy(dx_htn) & ~_truthy(med_htn)).astype("boolean").where(htn_known)
    )

    prediabetes = (
        glucose.between(thresholds.fasting_glucose_prediabetes, thresholds.fasting_glucose_diabetes, inclusive="left")
        | hba1c.between(thresholds.hba1c_prediabetes, thresholds.hba1c_diabetes, inclusive="left")
    ).fillna(False)
    result["label_prediabetes"] = (prediabetes & ~dm_positive).astype("boolean").where(glucose.notna() | hba1c.notna())

    return result


def _sex_threshold(frame: pd.DataFrame, male: float, female: float) -> pd.Series:
    """Per-row cut-off from the sex column. NA sex yields NA, never a default."""
    sex = _column(frame, "sex").astype("object")
    return pd.Series(
        [male if s == "M" else female if s == "F" else pd.NA for s in sex],
        index=frame.index,
        dtype="Float64",
    )


def _decide(positive: pd.Series, undecidable: pd.Series, needed: int) -> pd.Series:
    """Count-based label that stays NA only while the count could still flip.

    ``positive`` and ``undecidable`` are per-row counts of criteria met and of
    criteria we cannot evaluate. A row is positive as soon as enough criteria are
    met, negative once even every unknown criterion could not reach the bar, and
    NA in between. Requiring all five components to be present instead would drop
    a third of the 대사증후군 rows for no gain — someone with four criteria met is
    positive whatever the fifth says.
    """
    result = pd.Series(pd.NA, index=positive.index, dtype="boolean")
    result[positive >= needed] = True
    result[(positive + undecidable) < needed] = False
    return result


def add_extended_labels(frame: pd.DataFrame, thresholds: Thresholds = DEFAULT) -> pd.DataFrame:
    """Attach 이상지질혈증·대사증후군·신기능·지방간·빈혈 labels.

    Every label here is built from a value NHANES measured, so each one also
    defines its own leakage set — the columns that must never become features
    for that target. ``modeling/targets.py`` holds that mapping; changing a
    definition here without changing it there is how a 0.99 AUROC gets shipped.
    """
    result = frame.copy()

    total_chol = _numeric(result, "total_chol")
    ldl = _numeric(result, "ldl")
    triglyceride = _numeric(result, "triglyceride")
    hdl = _numeric(result, "hdl")
    glucose = _numeric(result, "fasting_glucose")
    sbp = _numeric(result, "sbp")
    dbp = _numeric(result, "dbp")
    waist = _numeric(result, "waist_cm")
    egfr = _numeric(result, "egfr")
    acr = _numeric(result, "urine_acr")
    cap = _numeric(result, "cap_db_m")
    alt = _numeric(result, "alt")
    hemoglobin = _numeric(result, "hemoglobin")

    dx_lipid = _column(result, "dx_high_cholesterol")
    med_lipid = _column(result, "med_lipid")
    med_htn = _column(result, "med_hypertension")
    med_dm = _column(result, "med_diabetes")
    dx_dm = _column(result, "dx_diabetes")

    # ---------------- 이상지질혈증 ----------------
    # 넷 중 하나라도 넘으면 양성. 치료 중인 사람은 검사값이 정상으로 나오므로
    # 진단력과 복약을 OR 로 함께 읽지 않으면 그 사람들이 전부 음성이 된다.
    dlp_measured = (
        (total_chol >= thresholds.total_chol_high).fillna(False)
        | (ldl >= thresholds.ldl_high).fillna(False)
        | (triglyceride >= thresholds.triglyceride_high).fillna(False)
        | (hdl < thresholds.hdl_low).fillna(False)
    )
    dlp_known = (
        total_chol.notna() | ldl.notna() | triglyceride.notna() | hdl.notna() | dx_lipid.notna() | med_lipid.notna()
    )
    dlp_positive = dlp_measured | _truthy(dx_lipid) | _truthy(med_lipid)
    result["label_dlp_prevalent"] = dlp_positive.astype("boolean").where(dlp_known)
    result["label_dlp_undiagnosed"] = (
        (dlp_measured & ~_truthy(dx_lipid) & ~_truthy(med_lipid)).astype("boolean").where(dlp_known)
    )

    # 하위유형은 측정값만으로 정의하고, 지질강하제 복용자는 NA 로 뺀다. 약이
    # 어느 분획을 내렸는지 알 수 없어서 치료된 값으로 유형을 나눌 수 없다.
    treated = _truthy(med_lipid)
    subtypes = {
        "label_hyperchol": (
            (total_chol >= thresholds.total_chol_high).fillna(False) | (ldl >= thresholds.ldl_high).fillna(False),
            total_chol.notna() | ldl.notna(),
        ),
        "label_hypertg": (
            (triglyceride >= thresholds.triglyceride_high).fillna(False),
            triglyceride.notna(),
        ),
        "label_low_hdl": (
            (hdl < thresholds.hdl_low).fillna(False),
            hdl.notna(),
        ),
    }
    for name, (positive, known) in subtypes.items():
        result[name] = positive.astype("boolean").where(known & ~treated)

    # ---------------- 대사증후군 ----------------
    # ATP III 개정 5요소 중 3개. 복약은 그 자체로 해당 요소를 충족시킨다.
    waist_cut = _sex_threshold(result, thresholds.mets_waist_male, thresholds.mets_waist_female)
    hdl_cut = _sex_threshold(result, thresholds.mets_hdl_male, thresholds.mets_hdl_female)

    components: list[tuple[pd.Series, pd.Series]] = [
        ((waist >= waist_cut).fillna(False), waist.notna() & waist_cut.notna()),
        (
            (triglyceride >= thresholds.mets_triglyceride).fillna(False) | _truthy(med_lipid),
            triglyceride.notna() | med_lipid.notna(),
        ),
        (
            (hdl < hdl_cut).fillna(False) | _truthy(med_lipid),
            (hdl.notna() & hdl_cut.notna()) | med_lipid.notna(),
        ),
        (
            (sbp >= thresholds.mets_sbp).fillna(False) | (dbp >= thresholds.mets_dbp).fillna(False) | _truthy(med_htn),
            sbp.notna() | dbp.notna() | med_htn.notna(),
        ),
        (
            (glucose >= thresholds.mets_glucose).fillna(False) | _truthy(med_dm) | _truthy(dx_dm),
            glucose.notna() | med_dm.notna() | dx_dm.notna(),
        ),
    ]
    met_count = sum(positive.astype(int) for positive, _ in components)
    unknown_count = sum((~known & ~positive).astype(int) for positive, known in components)
    result["label_mets"] = _decide(met_count, unknown_count, needed=3)

    # ---------------- 신기능 ----------------
    # KDIGO 는 3개월 지속을 요구한다. 단면 1회 측정으로는 채울 수 없으므로
    # 화면 문구는 "만성콩팥병"이 아니라 "신기능 확인 필요"여야 한다.
    result["label_egfr_low"] = (egfr < thresholds.egfr_low).astype("boolean").where(egfr.notna())
    ckd_positive = (egfr < thresholds.egfr_low).fillna(False) | (acr >= thresholds.urine_acr_high).fillna(False)
    result["label_ckd"] = ckd_positive.astype("boolean").where(egfr.notna() | acr.notna())

    # ---------------- 지방간 ----------------
    # CAP 은 실측이라 HSI 같은 지수와 달리 BMI 를 라벨 안에 끌고 들어오지 않는다.
    # 2017-2018 과 2021-2023 두 주기에만 있다.
    result["label_fatty_liver"] = (cap >= thresholds.cap_steatosis).astype("boolean").where(cap.notna())
    alt_cut = _sex_threshold(result, thresholds.alt_high_male, thresholds.alt_high_female)
    result["label_liver_enzyme_high"] = (alt > alt_cut).astype("boolean").where(alt.notna() & alt_cut.notna())

    # ---------------- 빈혈 ----------------
    # WHO 는 임신 중 기준을 11.0 g/dL 로 따로 둔다. 같은 컷오프를 쓰면 임신부가
    # 통째로 양성으로 넘어와 여성 유병률이 부풀고, 그 편향이 성별 계수에 실린다.
    hemoglobin_cut = _sex_threshold(result, thresholds.hemoglobin_low_male, thresholds.hemoglobin_low_female)
    not_pregnant = ~_truthy(_column(result, "pregnant"))
    result["label_anemia"] = (
        (hemoglobin < hemoglobin_cut)
        .astype("boolean")
        .where(hemoglobin.notna() & hemoglobin_cut.notna() & not_pregnant)
    )

    # ---------------- 비만 ----------------
    # 라벨이 키·체중에서 곧바로 나오므로 그 셋(bmi·height_cm·weight_kg)은 이 타깃의
    # 누출 집합이다(`targets.py`). 허리둘레는 다른 측정이라 남는다 — 그것이 이
    # 모델에서 가장 크게 기여하는 특징이고, 화면에서 "허리둘레는 보조" 라고 말하는
    # 것과 어긋나지 않는다. 라벨이 BMI 이고 허리둘레는 그것을 맞히는 재료다.
    bmi = _numeric(result, "bmi")
    result["label_obesity"] = (bmi >= thresholds.bmi_obesity).astype("boolean").where(bmi.notna())

    # ---------------- 만성염증 ----------------
    # 양성은 3~10, 음성은 3 이하, **10 초과는 결측**이다. 임신부를 뺀 빈혈 라벨과
    # 같은 꼴 — 기준이 다른 집단을 음성으로 두면 그 편향이 계수에 실린다.
    crp = _numeric(result, "crp")
    chronic = (crp > thresholds.crp_chronic_high) & (crp <= thresholds.crp_acute)
    result["label_chronic_inflammation"] = chronic.astype("boolean").where(crp.notna() & (crp <= thresholds.crp_acute))

    # ---------------- 고요산혈증 ----------------
    uric_acid = _numeric(result, "uric_acid")
    uric_cut = _sex_threshold(result, thresholds.uric_acid_high_male, thresholds.uric_acid_high_female)
    result["label_hyperuricemia"] = (uric_acid > uric_cut).astype("boolean").where(uric_acid.notna() & uric_cut.notna())

    return result


def _incidence_pairs(
    result: pd.DataFrame,
    source_column: str,
    subject_column: str,
    wave_column: str,
) -> pd.DataFrame:
    """(기준 행, 그 사람의 이후 파동) 쌍과 사이 간격(년).

    지평 라벨은 한 행만 보고는 만들 수 없다 — "H년 안에 진단이 떴는가" 와 "H년까지
    관측이 있는가" 를 둘 다 봐야 검열을 음성으로 세지 않는다. 그래서 사람 단위로
    자기 결합을 한 번 하고, 지평마다 그 쌍을 걸러 쓴다.
    """
    left = result[["_row", subject_column, wave_column]]
    right = result[[subject_column, wave_column, source_column]].rename(
        columns={wave_column: "_later_wave", source_column: "_later_told"}
    )
    pairs = left.merge(right, on=subject_column, how="left")
    pairs["_later_told"] = pairs["_later_told"].astype("boolean")
    pairs["_gap"] = pd.to_numeric(pairs["_later_wave"], errors="coerce") - pd.to_numeric(
        pairs[wave_column], errors="coerce"
    )
    return pairs[pairs["_gap"] > 0]


def add_incidence_labels(
    frame: pd.DataFrame,
    *,
    subject_column: str = "subject_id",
    wave_column: str = "survey_year",
    horizons_years: tuple[int, ...] = INCIDENCE_HORIZONS_YEARS,
) -> pd.DataFrame:
    """Attach incident labels from panel waves — unbounded and per horizon.

    두 종류가 나간다.

    ``label_<c>_incident``
        지평 없는 "언제든" 라벨. 이후 **어느** 파동에서든 진단이 뜨면 1 이다.
        양성이 가장 많아 표본이 크지만 "언제" 를 답하지 못한다.

    ``label_<c>_incident_<H>y``
        H년 지평 라벨. `schema.incidence_label` 이 이름을 만든다.

    지평 라벨의 세 값이 이렇게 갈린다. 자가보고 진단은 **한 번 들으면 취소되지
    않는다**(monotone) 는 성질을 쓴다.

    * 1 — 간격이 ``0 < gap <= H`` 인 파동에서 진단을 들었다
    * 0 — 간격이 ``gap >= H`` 인 파동에서 **아직 못 들었다**. 그 시점에 안 들었으면
      그보다 이른 H 시점에도 안 들은 것이라, 파동이 H 를 건너뛰어도 음성이 확정된다
    * NA — 둘 다 아니다. **모르는 것을 0 으로 세지 않는다.** 패널 발병 모델이 조용히
      틀리는 가장 흔한 자리가 여기다 — 추적이 짧아 아직 안 걸린 사람을 음성으로
      세면 발병률이 통째로 내려간다

    기준 시점에 이미 진단받은 사람은 **위험군이 아니므로** 전부 NA 다. 양성과 음성이
    동시에 걸리는 모순된 자가보고(2년째 들었다 → 6년째 못 들었다)는 양성으로 둔다.

    조사 연도 단위로 간격을 재므로 **지평이 파동 간격보다 촘촘하면 대부분 NA** 다.
    2년 주기 패널에서 1년 지평은 거의 비고, 그것은 결함이 아니라 사실이다.
    """
    result = frame.sort_values([subject_column, wave_column]).copy()
    result["_row"] = range(len(result))

    for condition, source_column in INCIDENCE_SOURCES.items():
        names = [f"label_{condition}_incident", *(incidence_label(condition, h) for h in horizons_years)]
        if source_column not in result.columns:
            for name in names:
                result[name] = pd.NA
            continue

        told = result[source_column].astype("boolean")
        at_risk = told.eq(False)

        grouped = told.groupby(result[subject_column])
        ever = grouped.transform(lambda s: s[::-1].cummax()[::-1].shift(-1)).astype("boolean")
        result[f"label_{condition}_incident"] = ever.where(at_risk)

        ahead = _incidence_pairs(result, source_column, subject_column, wave_column)
        for horizon in horizons_years:
            onset = ahead.loc[(ahead["_gap"] <= horizon) & ahead["_later_told"].eq(True), "_row"]
            clear = ahead.loc[(ahead["_gap"] >= horizon) & ahead["_later_told"].eq(False), "_row"]
            label = pd.Series(pd.NA, index=result.index, dtype="boolean")
            label[result["_row"].isin(set(clear))] = False
            # 양성을 뒤에 쓴다 — 모순된 자가보고에서 양성이 이긴다(위 독스트링).
            label[result["_row"].isin(set(onset))] = True
            result[incidence_label(condition, horizon)] = label.where(at_risk)

    return result.drop(columns=["_row"])


def label_summary(frame: pd.DataFrame) -> pd.DataFrame:
    """Counts and positive rates for every label column present."""
    rows = []
    for column in frame.columns:
        if not column.startswith("label_"):
            continue
        series = frame[column].astype("boolean")
        known = int(series.notna().sum())
        positive = int(series.sum(skipna=True)) if known else 0
        rows.append(
            {
                "label": column,
                "labelled": known,
                "positive": positive,
                "positive_rate": round(positive / known, 4) if known else None,
                "missing": int(series.isna().sum()),
            }
        )
    return pd.DataFrame(rows)
