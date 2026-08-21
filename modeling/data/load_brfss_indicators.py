"""Load the CDC Diabetes Health Indicators dataset (UCI 891, BRFSS 2015).

253,680 respondents, 21 predictors, fully public — the sponsor brief names
Kaggle/UCI-class open datasets explicitly, so this one is squarely in scope.

Its role in the pipeline is the 일반형 (no-lab) branch at a scale NHANES cannot
reach. Three limits decide how far it can be trusted.

* Nothing is measured. ``HighBP``/``HighChol``/``Diabetes_binary`` are all
  self-reported, so every label here is "was told by a doctor", not "meets the
  diagnostic threshold". Mixing these rows with NHANES measurement labels in one
  training set would silently blend two different targets.
* ``Diabetes_binary`` collapses prediabetes and diabetes into one positive
  class. It maps to ``label_dm_prevalent`` only under that caveat.
* Age arrives as a 13-level bracket, not a number.

    python modeling/data/load_brfss_indicators.py --out processed/brfss_indicators.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
from labels import label_summary
from schema import conform

RAW = Path(__file__).resolve().parent / "raw" / "brfss_health_indicators"
DEFAULT_FILE = RAW / "cdc_diabetes_health_indicators.csv"
DOWNLOAD_URL = "https://archive.ics.uci.edu/static/public/891/data.csv"

# BRFSS _AGEG5YR bracket -> midpoint in years. 13 is 80+, left open at 85.
AGE_BRACKET_MIDPOINT = {
    1: 21.0,
    2: 27.0,
    3: 32.0,
    4: 37.0,
    5: 42.0,
    6: 47.0,
    7: 52.0,
    8: 57.0,
    9: 62.0,
    10: 67.0,
    11: 72.0,
    12: 77.0,
    13: 85.0,
}


def build(path: Path) -> pd.DataFrame:
    raw = pd.read_csv(path)

    frame = pd.DataFrame(index=raw.index)
    frame["subject_id"] = raw["ID"].astype("int64")
    frame["survey_year"] = 2015
    frame["age"] = raw["Age"].map(AGE_BRACKET_MIDPOINT)
    frame["sex"] = raw["Sex"].map({0: "F", 1: "M"})
    frame["bmi"] = pd.to_numeric(raw["BMI"], errors="coerce")

    # "Smoked 100 cigarettes in your life" cannot separate former from current.
    # Only the negative answer is unambiguous.
    frame["smoking_status"] = pd.Series(pd.NA, index=raw.index, dtype="object").mask(raw["Smoker"].eq(0), "never")
    frame["physical_activity_any"] = raw["PhysActivity"].astype("boolean")
    frame["veg_fruit_daily"] = (raw["Fruits"].eq(1) & raw["Veggies"].eq(1)).astype("boolean")
    # HvyAlcoholConsump is a threshold flag (>14 drinks/week men, >7 women), not
    # a frequency, so it cannot fill alcohol_days_per_year.
    frame["heavy_alcohol"] = raw["HvyAlcoholConsump"].astype("boolean")

    # GenHlth 1=Excellent ... 5=Poor. NHANES HUQ010 과 척도가 같다.
    frame["self_rated_health"] = pd.to_numeric(raw["GenHlth"], errors="coerce")
    frame["difficulty_walking"] = raw["DiffWalk"].astype("boolean")
    # Education 1~6 -> 1~5. NHANES DMDEDUC2 의 6단계 없는 척도에 맞춘다.
    frame["education_level"] = raw["Education"].map({1: 1, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5})
    # 소득 척도가 데이터셋마다 달라 내부 백분위로 맞춘다.
    frame["income_rank"] = pd.to_numeric(raw["Income"], errors="coerce").rank(pct=True)
    frame["unhealthy_days_physical"] = pd.to_numeric(raw["PhysHlth"], errors="coerce")
    frame["unhealthy_days_mental"] = pd.to_numeric(raw["MentHlth"], errors="coerce")
    frame["dx_high_cholesterol"] = raw["HighChol"].astype("boolean")
    frame["dx_stroke"] = raw["Stroke"].astype("boolean")
    frame["dx_heart_disease"] = raw["HeartDiseaseorAttack"].astype("boolean")

    frame["dx_hypertension"] = raw["HighBP"].astype("boolean")
    frame["dx_diabetes"] = raw["Diabetes_binary"].astype("boolean")

    # Self-report only. No measured values exist to build a screening label from,
    # so the prevalent labels are declared here rather than via labels.py.
    frame["label_dm_prevalent"] = raw["Diabetes_binary"].astype("boolean")
    frame["label_htn_prevalent"] = raw["HighBP"].astype("boolean")

    return conform(frame, "brfss_health_indicators")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=DEFAULT_FILE)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    if not args.path.exists():
        print(f"{args.path} 없음. 아래로 받으세요:\n  curl -L -o {args.path} {DOWNLOAD_URL}")
        return 1

    frame = build(args.path)
    print(f"rows={len(frame)} columns={len(frame.columns)}")
    print("\nlabels:")
    print(label_summary(frame).to_string(index=False))

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        frame.to_csv(args.out, index=False)
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
