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

    return result


def add_incidence_labels(
    frame: pd.DataFrame,
    *,
    subject_column: str = "subject_id",
    wave_column: str = "survey_year",
) -> pd.DataFrame:
    """Attach incident labels from consecutive panel waves.

    A row is labelled 1 when the subject reports no diagnosis in this wave and
    reports one in any later wave. Subjects already diagnosed at the wave are
    labelled NA — they are not at risk, and keeping them as negatives is the
    most common way panel incidence models get quietly wrong.
    """
    result = frame.sort_values([subject_column, wave_column]).copy()

    for condition in ("dm", "htn"):
        source_column = "dx_diabetes" if condition == "dm" else "dx_hypertension"
        if source_column not in result.columns:
            result[f"label_{condition}_incident"] = pd.NA
            continue

        told = result[source_column].astype("boolean")
        grouped = told.groupby(result[subject_column])
        # Did a diagnosis appear in any strictly later wave?
        future_positive = grouped.transform(lambda s: s[::-1].cummax()[::-1].shift(-1)).astype("boolean")
        at_risk = told.eq(False)
        result[f"label_{condition}_incident"] = future_positive.where(at_risk)

    return result


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
