"""Load the Framingham teaching dataset (10-year CHD incidence).

4,240 participants with ``TenYearCHD``: whether coronary heart disease occurred
within ten years of the baseline exam. That makes it the only dataset in the
overseas set that carries a genuine prospective outcome, which is what the
sponsor brief means by "발병 가능성".

Read the caveats before putting a number from this on a screen.

* PROVENANCE. This is the widely circulated teaching extract, mirrored on
  GitHub/Kaggle rather than served by the study. The authoritative copy is the
  NHLBI BioLINCC teaching dataset, which needs registration. Cite it as a
  teaching extract, and do not claim it is the full Framingham cohort.
* POPULATION. Framingham, Massachusetts, enrolled from 1948. A 2026 Korean user
  is far outside the derivation population.
* OUTCOME. Coronary heart disease, not diabetes or hypertension. It demonstrates
  the incidence framing; it does not answer the two target conditions.
* ``glucose`` is a casual measurement, not necessarily fasting, so it is loaded
  into its own column rather than ``fasting_glucose``.

    python modeling/data/load_framingham.py --out processed/framingham.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
from labels import add_prevalence_labels, label_summary
from schema import conform

RAW = Path(__file__).resolve().parent / "raw" / "framingham"
DEFAULT_FILE = RAW / "framingham.csv"


def build(path: Path) -> pd.DataFrame:
    raw = pd.read_csv(path)

    frame = pd.DataFrame(index=raw.index)
    frame["subject_id"] = raw.index.astype("int64")
    frame["survey_year"] = 1956  # baseline exam period, nominal
    frame["age"] = pd.to_numeric(raw["age"], errors="coerce")
    frame["sex"] = raw["male"].map({1: "M", 0: "F"})
    frame["bmi"] = pd.to_numeric(raw["BMI"], errors="coerce")
    frame["sbp"] = pd.to_numeric(raw["sysBP"], errors="coerce")
    frame["dbp"] = pd.to_numeric(raw["diaBP"], errors="coerce")
    frame["total_chol"] = pd.to_numeric(raw["totChol"], errors="coerce")
    frame["heart_rate"] = pd.to_numeric(raw["heartRate"], errors="coerce")
    # Casual glucose. Kept apart from fasting_glucose so the diabetes threshold
    # in labels.py is never applied to it.
    frame["casual_glucose"] = pd.to_numeric(raw["glucose"], errors="coerce")

    smoker = raw["currentSmoker"].astype("boolean")
    frame["smoking_status"] = pd.Series(pd.NA, index=raw.index, dtype="object")
    frame["smoking_status"] = frame["smoking_status"].mask(smoker.eq(True).fillna(False), "current")
    # A non-smoker at baseline may still be a former smoker; the extract cannot tell.
    frame["cigarettes_per_day"] = pd.to_numeric(raw["cigsPerDay"], errors="coerce")

    # education 1=일부 고교 ... 4=대졸. 공통 1~5 서열의 2~5 구간에 놓는다.
    frame["education_level"] = raw["education"].map({1: 2, 2: 3, 3: 4, 4: 5})
    frame["dx_stroke"] = raw["prevalentStroke"].astype("boolean")

    frame["dx_hypertension"] = raw["prevalentHyp"].astype("boolean")
    frame["med_hypertension"] = raw["BPMeds"].astype("boolean")
    frame["dx_diabetes"] = raw["diabetes"].astype("boolean")

    frame = add_prevalence_labels(frame)
    frame["label_chd_10yr"] = raw["TenYearCHD"].astype("boolean")

    return conform(frame, "framingham")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=DEFAULT_FILE)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    if not args.path.exists():
        print(f"{args.path} 없음. README.md 를 참고하세요.")
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
