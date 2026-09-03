"""Target and feature definitions, with label leakage blocked by construction.

Every target here declares the columns that went into building its label. Those
columns are removed from the feature list mechanically, so a model can never be
handed the answer. Without this, the hypertension model trained on ``sbp``/``dbp``
scores an AUROC near 1.0 and means nothing.

Population matters as much as the label. All three targets are restricted to
people with no prior diagnosis and no medication: telling someone who already
takes blood-pressure pills that they are at risk of hypertension is not a
product. See `docs/planning/01_PRD.md` Q3 and Q6.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

# Anything derived from a measurement that defines a label, plus the
# self-reported status used to pick the population.
POPULATION_COLUMNS = [
    "dx_diabetes",
    "dx_hypertension",
    "dx_prediabetes_told",
    "med_diabetes",
    "med_hypertension",
]

NUMERIC_BASE = [
    "age",
    "bmi",
    "waist_cm",
    "alcohol_days_per_year",
    "moderate_min_per_week",
    "vigorous_min_per_week",
    "sedentary_min_per_day",
    "sleep_hours",
]
CATEGORICAL_BASE = ["sex", "smoking_status"]

BLOOD_PRESSURE = ["sbp", "dbp"]
FAMILY_HISTORY = ["fh_diabetes", "fh_cvd"]


@dataclass(frozen=True)
class Target:
    key: str
    label: str  # column in the processed table
    description: str
    # Columns the label is computed from. Never allowed as features.
    label_inputs: list[str]
    numeric: list[str]
    categorical: list[str] = field(default_factory=lambda: list(CATEGORICAL_BASE))
    # Restrict to respondents with no diagnosis and no medication for this condition.
    population: str = ""

    @property
    def features(self) -> list[str]:
        blocked = set(self.label_inputs) | set(POPULATION_COLUMNS)
        numeric = [c for c in self.numeric if c not in blocked]
        categorical = [c for c in self.categorical if c not in blocked]
        return numeric + categorical

    def numeric_features(self) -> list[str]:
        blocked = set(self.label_inputs) | set(POPULATION_COLUMNS)
        return [c for c in self.numeric if c not in blocked]

    def categorical_features(self) -> list[str]:
        blocked = set(self.label_inputs) | set(POPULATION_COLUMNS)
        return [c for c in self.categorical if c not in blocked]


TARGETS: dict[str, Target] = {
    # Blood pressure is a legitimate predictor of diabetes; glucose and HbA1c are not.
    "dm_undiagnosed": Target(
        key="dm_undiagnosed",
        label="label_dm_undiagnosed",
        description="미진단자 중 당뇨 측정 기준 초과",
        label_inputs=["fasting_glucose", "hba1c"],
        numeric=NUMERIC_BASE + BLOOD_PRESSURE,
        population="diabetes",
    ),
    "prediabetes": Target(
        key="prediabetes",
        label="label_prediabetes",
        description="미진단자 중 당뇨 전단계",
        label_inputs=["fasting_glucose", "hba1c"],
        numeric=NUMERIC_BASE + BLOOD_PRESSURE,
        population="diabetes",
    ),
    # The hypertension label is built from sbp/dbp, so they must go.
    "htn_undiagnosed": Target(
        key="htn_undiagnosed",
        label="label_htn_undiagnosed",
        description="미진단자 중 고혈압 측정 기준 초과",
        label_inputs=BLOOD_PRESSURE,
        numeric=NUMERIC_BASE,
        population="hypertension",
    ),
}


def with_family_history(target: Target) -> Target:
    """Variant that adds family history. Costs the 2021-2023 cycle entirely."""
    return Target(
        key=f"{target.key}_fh",
        label=target.label,
        description=f"{target.description} (가족력 포함)",
        label_inputs=target.label_inputs,
        numeric=target.numeric + FAMILY_HISTORY,
        categorical=target.categorical,
        population=target.population,
    )


def select_population(frame: pd.DataFrame, target: Target) -> pd.DataFrame:
    """Keep only respondents at risk: no diagnosis, no medication."""
    if target.population == "diabetes":
        diagnosed = frame["dx_diabetes"].astype("boolean")
        medicated = frame["med_diabetes"].astype("boolean")
    elif target.population == "hypertension":
        diagnosed = frame["dx_hypertension"].astype("boolean")
        medicated = frame["med_hypertension"].astype("boolean")
    else:
        return frame

    at_risk = diagnosed.eq(False).fillna(False) & medicated.ne(True).fillna(True)
    return frame[at_risk]


def build_matrix(frame: pd.DataFrame, target: Target) -> tuple[pd.DataFrame, pd.Series]:
    """Population filter, feature selection, complete-case rows, X and y."""
    subset = select_population(frame, target)

    columns = target.features
    label = subset[target.label].astype("boolean")
    complete = subset[columns].notna().all(axis=1) & label.notna()

    features = subset.loc[complete, columns].copy()
    for column in target.numeric_features():
        features[column] = pd.to_numeric(features[column], errors="coerce")
    for column in target.categorical_features():
        features[column] = features[column].astype("category")

    return features, label[complete].astype(int)


def assert_no_leakage(target: Target) -> None:
    """Fail loudly rather than train on the answer."""
    overlap = set(target.features) & (set(target.label_inputs) | set(POPULATION_COLUMNS))
    if overlap:
        raise AssertionError(f"{target.key}: 라벨 구성 변수가 입력에 남아 있습니다 -> {sorted(overlap)}")
