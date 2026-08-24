"""Canonical analysis schema shared by every chronic-disease dataset loader.

Every loader in this package returns a DataFrame with these columns so that
NHANES, NHIS 건강검진정보, KNHANES and 한국의료패널 can be stacked, compared and
swapped without touching the training code.

Two rules govern what belongs here.

1. A feature column exists only if the onboarding screens actually collect it
   (`docs/planning/02_IA_화면목록.md` SCR-ONBD-02 ~ 05). Training on a variable
   the user can never supply is information leakage at serving time.
2. Columns are ``None`` when a dataset does not carry them. Loaders never
   invent or impute at load time — imputation is a modelling decision.
"""

from __future__ import annotations

from dataclasses import dataclass

# --------------------------------------------------------------------------
# Column groups
# --------------------------------------------------------------------------

IDENTITY = [
    "source",  # dataset tag, e.g. "nhanes_2021_2023"
    "subject_id",  # unique within source
    "survey_year",  # int, wave/year the row belongs to
]

DESIGN = [
    "weight_survey",  # primary analysis weight (None when unweighted)
    "psu",
    "stratum",
]

# SCR-ONBD-02 기본정보·가족력
DEMOGRAPHIC = ["age", "sex"]  # sex: "M" | "F"
FAMILY_HISTORY = ["fh_diabetes", "fh_hypertension", "fh_cvd"]  # nullable bool

# 사회경제·주관적 건강. 온보딩에서 직접 묻지는 않지만 여러 데이터셋이 공통으로
# 담고 있고, 고령층 내부를 가르는 데 나이·BMI보다 나은 신호가 될 수 있다.
CONTEXT = [
    "self_rated_health",  # 1=매우 좋음 ... 5=나쁨
    "difficulty_walking",  # nullable bool
    "education_level",  # 1~5 서열
    "income_rank",  # 0~1, 데이터셋 내부 백분위
    "unhealthy_days_physical",  # 최근 30일 중 일수
    "unhealthy_days_mental",
]

# 기왕력. 라벨과 구분해서 둔다 — 당뇨/고혈압 자체가 아니라 동반 질환이다.
# dx_high_cholesterol 은 이상지질혈증 라벨의 OR 조건이기도 해서, 그 타깃에서는
# 동반질환이 아니라 차단 대상이 된다. TARGETS 의 blocked 가 그 구분을 한다.
COMORBIDITY = [
    "dx_high_cholesterol",
    "dx_stroke",
    "dx_heart_disease",
    "dx_kidney",  # "콩팥이 약하다/나빠졌다는 말을 들은 적 있는가" 자가보고
]

# 여성 생식 이력. 나이의 대리로는 안 되는 신호다 — 폐경 전후로 LDL·중성지방이
# 꺾이고 대사증후군 유병률이 갈라지는데, 같은 55세 여성 안에서도 폐경 여부가
# 다르다. 온보딩은 문항 하나로 받을 수 있다.
REPRODUCTIVE = ["postmenopausal", "age_at_last_period"]

# SCR-ONBD-03 생활습관
LIFESTYLE = [
    "smoking_status",  # "never" | "former" | "current"
    "alcohol_days_per_year",  # float
    "moderate_min_per_week",  # float
    "vigorous_min_per_week",  # float
    "sedentary_min_per_day",  # float
    "sleep_hours",  # float
    "veg_fruit_servings_per_day",  # float
    "veg_fruit_daily",  # nullable bool, coarse substitute when servings are unavailable
    "physical_activity_any",  # nullable bool, coarse substitute when minutes are unavailable
    "heavy_alcohol",  # nullable bool, threshold flag rather than a frequency
    "cigarettes_per_day",
]

# SCR-ONBD-04 신체·측정값
ANTHROPOMETRIC = [
    "height_cm",
    "weight_kg",
    "bmi",
    "waist_cm",
    "sbp",
    "dbp",
    "heart_rate",
    # 1년 전 체중 대비 변화율(%). 절대 kg 이 아니라 비율로 두는 이유는 같은 5kg
    # 이 50kg 인 사람과 100kg 인 사람에게 다른 사건이기 때문이다.
    "weight_change_1yr_pct",
]

# SCR-ONBD-05 검사값 (선택) — 채우면 정밀형 모델, 비우면 일반형
#
# 여기 있는 값이 전부 국가건강검진 결과지에 인쇄된다. 결과지에 없는 값(DXA
# T-score, 경동맥 초음파)은 학습에 쓸 수 있어도 이 목록에 넣지 않는다 —
# 사용자가 옮겨 적을 수 없는 입력은 서빙 시점에 항상 결측이기 때문이다.
LABS = [
    "fasting_glucose",  # mg/dL
    "hba1c",  # %
    "total_chol",  # mg/dL
    "hdl",  # mg/dL
    "ldl",  # mg/dL
    "triglyceride",  # mg/dL
    "creatinine",  # mg/dL
    "egfr",  # mL/min/1.73m^2, derived
    "ast",  # IU/L
    "alt",  # IU/L
    "ggt",  # IU/L, γ-GTP
    "uric_acid",  # mg/dL
    "hemoglobin",  # g/dL
    "albumin",  # g/dL, 혈청 알부민
    "urine_acr",  # mg/g, 요알부민/크레아티닌비
    "cap_db_m",  # dB/m, 간 탄성초음파 감쇠계수 (측정 지방간 라벨의 근거)
    "casual_glucose",  # 공복 여부 불명. 진단 임계값을 적용하지 않는다
]

# Self-reported status, used to build labels — never a model input.
OUTCOME_SOURCE = [
    "dx_diabetes",
    "dx_prediabetes_told",
    "dx_hypertension",
    "med_diabetes",
    "med_hypertension",
    "med_lipid",  # 이상지질혈증·대사증후군 라벨의 OR 조건
    "dx_liver",
]

LABELS = [
    "label_dm_prevalent",
    "label_htn_prevalent",
    "label_dm_undiagnosed",
    "label_htn_undiagnosed",
    "label_prediabetes",
    # 이상지질혈증 — 단일 이진과 하위유형. 어느 지침도 "이상지질혈증" 하나를
    # 이진 라벨로 정의하지 않아서 하위유형을 정본으로 둔다.
    "label_dlp_prevalent",
    "label_dlp_undiagnosed",
    "label_hyperchol",  # 고LDL콜레스테롤혈증
    "label_hypertg",  # 고중성지방혈증
    "label_low_hdl",  # 낮은 HDL 콜레스테롤혈증
    "label_mets",  # 대사증후군
    "label_ckd",  # eGFR<60 또는 ACR>=30
    "label_egfr_low",  # eGFR<60 단독
    "label_fatty_liver",  # 간 탄성초음파 CAP 기준 (측정)
    "label_liver_enzyme_high",  # ALT 상승 — CAP 이 없는 주기의 대리 라벨
    "label_anemia",
    "label_dm_incident",  # panel datasets only
    "label_htn_incident",  # panel datasets only
    "label_chd_10yr",  # prospective cohorts only
]

FEATURE_COLUMNS = DEMOGRAPHIC + FAMILY_HISTORY + LIFESTYLE + ANTHROPOMETRIC + CONTEXT + COMORBIDITY + REPRODUCTIVE
LAB_COLUMNS = LABS
# "cycle" is empty for datasets that have no survey waves, but it has to be part
# of the canonical set: conform() drops anything outside this list, and the
# NHANES holdout split is defined by cycle.
CANONICAL_COLUMNS = IDENTITY + ["cycle"] + DESIGN + FEATURE_COLUMNS + LAB_COLUMNS + OUTCOME_SOURCE + LABELS

# Features available without any lab work — the 일반형 model.
GENERAL_MODEL_FEATURES = (
    DEMOGRAPHIC + FAMILY_HISTORY + LIFESTYLE + ANTHROPOMETRIC + CONTEXT + COMORBIDITY + REPRODUCTIVE
)
# 정밀형 model adds the optional lab panel.
PRECISE_MODEL_FEATURES = GENERAL_MODEL_FEATURES + LABS


@dataclass(frozen=True)
class DatasetInfo:
    """Provenance recorded next to every derived table."""

    source: str
    label: str
    acquisition: str  # "public" | "registration" | "review"
    longitudinal: bool
    measured_labs: bool
    note: str


REGISTRY: dict[str, DatasetInfo] = {
    "nhanes_2021_2023": DatasetInfo(
        source="nhanes_2021_2023",
        label="NHANES August 2021 - August 2023 (US)",
        acquisition="public",
        longitudinal=False,
        measured_labs=True,
        note="가족력·채소과일 섭취 변수 없음. 외부 검증용.",
    ),
    "nhis_checkup": DatasetInfo(
        source="nhis_checkup",
        label="국민건강보험공단 건강검진정보 (공공데이터포털 15007122)",
        acquisition="public",
        longitudinal=False,
        measured_labs=True,
        note="연도별 무작위 표본이라 개인 연계 불가. 신장·체중·연령이 구간값.",
    ),
    "knhanes": DatasetInfo(
        source="knhanes",
        label="국민건강영양조사 (질병관리청)",
        acquisition="registration",
        longitudinal=False,
        measured_labs=True,
        note="검진 실측 + 24시간 회상 영양조사. 식단 기능 근거로도 사용.",
    ),
    "brfss_health_indicators": DatasetInfo(
        source="brfss_health_indicators",
        label="CDC Diabetes Health Indicators (UCI 891, BRFSS 2015)",
        acquisition="public",
        longitudinal=False,
        measured_labs=False,
        note="253,680행. 자가보고 생활습관만. 혈압·혈당 실측값이 없어 라벨도 자가보고 기반.",
    ),
    "framingham": DatasetInfo(
        source="framingham",
        label="Framingham teaching dataset (10-year CHD)",
        acquisition="public",
        longitudinal=True,
        measured_labs=True,
        note="4,240행. 전향 10년 발병 라벨을 가진 유일한 즉시 확보 자료. 3자 미러라 출처 검증 필요.",
    ),
    "khp": DatasetInfo(
        source="khp",
        label="한국의료패널 2019-2023 (v2.4)",
        acquisition="registration",
        longitudinal=True,
        measured_labs=False,
        note="같은 사람을 해마다 추적. 신규 발병 라벨의 유일한 즉시 확보 경로.",
    ),
}


def empty_frame():
    """Return an empty DataFrame carrying the canonical column order."""
    import pandas as pd

    return pd.DataFrame(columns=CANONICAL_COLUMNS)


def conform(frame, source: str):
    """Add missing canonical columns as NA and order them consistently."""
    import pandas as pd

    result = frame.copy()
    result["source"] = source
    for column in CANONICAL_COLUMNS:
        if column not in result.columns:
            result[column] = pd.NA
    return result[CANONICAL_COLUMNS]
