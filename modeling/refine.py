"""Does a richer feature expansion actually buy accuracy, and where?

The serving model is a plain linear logistic regression over the raw inputs. Age,
BMI and self-rated health almost certainly do not act linearly on log-odds, so
this measures what each expansion is worth before any of it ships.

Configurations, cumulative:

    linear      current serving model
    +srh        self-rated health as 5 dummies instead of a 1-5 number
    +bins       age and BMI band dummies on top of the linear terms
    +quad       age^2 and BMI^2
    +inter      age x BMI, age x srh, sex x age, sex x BMI

Reported per config: holdout AUROC, Brier, ECE, calibration slope, and AUROC by
age band. A config that lifts AUROC while making calibration worse is not an
improvement for a product that puts a probability on a screen.

    python modeling/refine.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from experiments import calibration_slope, expected_calibration_error
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from splits import SEED
from train_risk import AGE_BINS, AGE_LABELS, CATEGORICAL, DATA, TARGETS, split_index

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

BASE_NUMERIC = [
    "age",
    "bmi",
    "self_rated_health",
    "waist_cm",
    "difficulty_walking",
    "alcohol_days_per_year",
    "moderate_min_per_week",
    "vigorous_min_per_week",
    "sedentary_min_per_day",
    "sleep_hours",
    "veg_fruit_daily",
    "sbp",
    "dbp",
]

AGE_EDGES = [19, 30, 40, 50, 60, 70, 200]
BMI_EDGES = [0, 23, 25, 30, 35, 100]

CONFIGS = ["linear", "+srh", "+bins", "+quad", "+inter"]


def expand(frame: pd.DataFrame, config: str) -> pd.DataFrame:
    """Vectorised expansion. The serving side mirrors this in pure Python."""
    out = frame.copy()
    age = pd.to_numeric(out["age"], errors="coerce")
    bmi = pd.to_numeric(out["bmi"], errors="coerce")
    srh = pd.to_numeric(out["self_rated_health"], errors="coerce")

    order = CONFIGS.index(config)

    if order >= CONFIGS.index("+srh"):
        # 주관적 건강은 1~5 서열이지만 효과가 선형이 아니다. "보통"과 "나쁨" 사이
        # 간격이 "매우 좋음"과 "좋음" 사이보다 훨씬 크다.
        for level in (2, 3, 4, 5):
            out[f"srh_{level}"] = srh.eq(level).astype(float)
        out = out.drop(columns=["self_rated_health"])

    if order >= CONFIGS.index("+bins"):
        for low, high in zip(AGE_EDGES[:-1], AGE_EDGES[1:], strict=False):
            out[f"age_{low}_{high}"] = age.between(low, high, inclusive="left").astype(float)
        for low, high in zip(BMI_EDGES[:-1], BMI_EDGES[1:], strict=False):
            out[f"bmi_{low}_{high}"] = bmi.between(low, high, inclusive="left").astype(float)

    if order >= CONFIGS.index("+quad"):
        out["age_sq"] = age**2
        out["bmi_sq"] = bmi**2

    if order >= CONFIGS.index("+inter"):
        male = out["sex"].astype(str).eq("M").astype(float)
        out["age_x_bmi"] = age * bmi
        out["age_x_srh"] = age * srh
        out["male_x_age"] = male * age
        out["male_x_bmi"] = male * bmi

    return out


def make_pipeline(numeric: list[str], categorical: list[str], penalty: float) -> Pipeline:
    return Pipeline(
        [
            (
                "preprocess",
                ColumnTransformer(
                    [
                        (
                            "numeric",
                            Pipeline(
                                [
                                    ("impute", SimpleImputer(strategy="median", add_indicator=True)),
                                    ("scale", StandardScaler()),
                                ]
                            ),
                            numeric,
                        ),
                        ("categorical", OneHotEncoder(handle_unknown="ignore", drop="first"), categorical),
                    ]
                ),
            ),
            ("model", LogisticRegression(max_iter=5000, C=penalty, random_state=SEED)),
        ]
    )


def run(unified: pd.DataFrame, target: str, penalty: float) -> list[dict]:
    blocked = set(TARGETS[target]["blocked"])
    base = [c for c in BASE_NUMERIC if c not in blocked]

    label = unified[TARGETS[target]["label"]].astype("boolean")
    keep = label.notna()
    raw = unified.loc[keep, [*base, *CATEGORICAL]].copy()
    for column in base:
        raw[column] = pd.to_numeric(raw[column], errors="coerce")
    for column in CATEGORICAL:
        raw[column] = raw[column].astype("object").fillna("__missing__").astype(str)
    y = label[keep].astype(int)

    train_index, holdout_index = split_index(unified, raw.index)
    nhanes = unified.loc[holdout_index, "source"].eq("nhanes_pooled").to_numpy()
    age_band = pd.cut(pd.to_numeric(unified.loc[holdout_index, "age"], errors="coerce"), AGE_BINS, labels=AGE_LABELS)

    print("=" * 108)
    print(f"{target} — 특징 확장별 성능 (NHANES 홀드아웃 n={int(nhanes.sum())}, C={penalty})")
    print("=" * 108)
    print(f"  {'구성':<10}{'변수':>5}{'AUROC':>8}{'AUPRC':>8}{'Brier':>8}{'ECE':>8}{'기울기':>8}   연령대별 AUROC")

    rows = []
    for config in CONFIGS:
        frame = expand(raw, config)
        numeric = [c for c in frame.columns if c not in CATEGORICAL]
        pipeline = make_pipeline(numeric, CATEGORICAL, penalty).fit(frame.loc[train_index], y.loc[train_index])

        probability = pipeline.predict_proba(frame.loc[holdout_index])[:, 1]
        y_holdout = y.loc[holdout_index].to_numpy()

        p_nhanes, y_nhanes = probability[nhanes], y_holdout[nhanes]
        slope, _ = calibration_slope(y_nhanes, p_nhanes)

        bands = {}
        for name in AGE_LABELS:
            mask = age_band.eq(name).to_numpy() & nhanes
            bands[name] = float(roc_auc_score(y_holdout[mask], probability[mask])) if mask.sum() > 100 else None

        band_text = "  ".join(f"{k} {v:.3f}" if v else f"{k} n/a" for k, v in bands.items())
        entry = {
            "target": target,
            "config": config,
            "n_features": len(numeric) + len(CATEGORICAL),
            "auroc": float(roc_auc_score(y_nhanes, p_nhanes)),
            "auprc": float(average_precision_score(y_nhanes, p_nhanes)),
            "brier": float(brier_score_loss(y_nhanes, p_nhanes)),
            "ece": expected_calibration_error(y_nhanes, p_nhanes),
            "calibration_slope": slope,
            "bands": bands,
        }
        print(
            f"  {config:<10}{entry['n_features']:>5}{entry['auroc']:>8.3f}{entry['auprc']:>8.3f}"
            f"{entry['brier']:>8.4f}{entry['ece']:>8.4f}{slope:>8.2f}   {band_text}"
        )
        rows.append(entry)

    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--penalty", type=float, nargs="*", default=[0.1, 1.0])
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "refine.json")
    args = parser.parse_args()

    unified = pd.read_csv(args.data, low_memory=False)
    results = []
    for penalty in args.penalty:
        for target in TARGETS:
            results += run(unified, target, penalty)
        print()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
