"""Logistic regression and XGBoost baselines for the chronic-disease targets.

Three targets, each restricted to respondents with no prior diagnosis:
undiagnosed diabetes, undiagnosed hypertension, and prediabetes. Each runs with
and without family history, which costs the 2021-2023 cycle.

Reported per run: 5-fold CV on the training cycles, then a single evaluation on
a held-out survey cycle the model never saw. AUPRC is reported next to AUROC
because the diabetes target is about 4% positive and AUROC alone flatters it.

Models are left uncalibrated and unweighted on purpose. Reweighting for class
imbalance improves ranking metrics and wrecks the probability scale, and the
product needs a probability it can put on a screen. Threshold selection is a
separate decision (`docs/planning/01_PRD.md` Q4).

    python modeling/train_baseline.py
    python modeling/train_baseline.py --targets dm_undiagnosed --no-family-history
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from features import TARGETS, Target, assert_no_leakage, build_matrix, with_family_history
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from splits import SEED, choose_holdout, cv_folds, make_split
from xgboost import XGBClassifier

DATA = Path(__file__).resolve().parent / "data" / "processed" / "nhanes_pooled.csv"
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"


@dataclass
class Scores:
    auroc: float
    auprc: float
    brier: float
    positive_rate: float
    n: int


def score(y_true: np.ndarray, probability: np.ndarray) -> Scores:
    return Scores(
        auroc=float(roc_auc_score(y_true, probability)),
        auprc=float(average_precision_score(y_true, probability)),
        brier=float(brier_score_loss(y_true, probability)),
        positive_rate=float(np.mean(y_true)),
        n=int(len(y_true)),
    )


def make_model(name: str, target: Target, positive_weight: float) -> Pipeline:
    numeric = target.numeric_features()
    categorical = target.categorical_features()

    if name == "logistic":
        preprocess = ColumnTransformer(
            [
                (
                    "numeric",
                    Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]),
                    numeric,
                ),
                (
                    "categorical",
                    Pipeline(
                        [
                            ("impute", SimpleImputer(strategy="most_frequent")),
                            ("encode", OneHotEncoder(handle_unknown="ignore", drop="first")),
                        ]
                    ),
                    categorical,
                ),
            ]
        )
        estimator = LogisticRegression(max_iter=2000, random_state=SEED)
    elif name == "xgboost":
        # XGBoost splits on NaN directly, so numeric columns pass through raw.
        preprocess = ColumnTransformer(
            [
                ("numeric", "passthrough", numeric),
                (
                    "categorical",
                    Pipeline(
                        [
                            ("impute", SimpleImputer(strategy="most_frequent")),
                            ("encode", OneHotEncoder(handle_unknown="ignore")),
                        ]
                    ),
                    categorical,
                ),
            ]
        )
        estimator = XGBClassifier(
            n_estimators=400,
            learning_rate=0.05,
            max_depth=4,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=5,
            reg_lambda=1.0,
            eval_metric="logloss",
            tree_method="hist",
            random_state=SEED,
            n_jobs=4,
        )
        del positive_weight  # kept uncalibrated on purpose; see module docstring
    else:
        raise ValueError(name)

    return Pipeline([("preprocess", preprocess), ("model", estimator)])


def run_target(pooled: pd.DataFrame, target: Target, holdout_cycle: str | None = None) -> list[dict]:
    assert_no_leakage(target)
    features, labels = build_matrix(pooled, target)
    cycle = pooled.loc[features.index, "cycle"]

    uses_family_history = any(c.startswith("fh_") for c in target.features)
    split = make_split(cycle, holdout_cycle or choose_holdout(uses_family_history))

    x_train = features.loc[split.train_index]
    y_train = labels.loc[split.train_index]
    x_holdout = features.loc[split.holdout_index]
    y_holdout = labels.loc[split.holdout_index]

    print(f"\n=== {target.key} - {target.description}")
    print(f"  features({len(target.features)}): {', '.join(target.features)}")
    print(f"  train {split.train_cycles} n={len(y_train)} 양성 {y_train.mean():.2%}")
    print(f"  holdout [{split.holdout_cycle}] n={len(y_holdout)} 양성 {y_holdout.mean():.2%}")

    positive_weight = float((y_train == 0).sum() / max((y_train == 1).sum(), 1))
    results = []

    for name in ("logistic", "xgboost"):
        folds = cv_folds(y_train)
        fold_scores = []
        for train_idx, valid_idx in folds.split(x_train, y_train):
            model = make_model(name, target, positive_weight)
            model.fit(x_train.iloc[train_idx], y_train.iloc[train_idx])
            probability = model.predict_proba(x_train.iloc[valid_idx])[:, 1]
            fold_scores.append(score(y_train.iloc[valid_idx].to_numpy(), probability))

        model = make_model(name, target, positive_weight)
        model.fit(x_train, y_train)
        holdout_scores = score(y_holdout.to_numpy(), model.predict_proba(x_holdout)[:, 1])

        cv_auroc = np.array([s.auroc for s in fold_scores])
        cv_auprc = np.array([s.auprc for s in fold_scores])
        print(
            f"  {name:<9} CV AUROC {cv_auroc.mean():.3f}±{cv_auroc.std():.3f}  "
            f"CV AUPRC {cv_auprc.mean():.3f}  |  "
            f"holdout AUROC {holdout_scores.auroc:.3f}  AUPRC {holdout_scores.auprc:.3f} "
            f"(기저 {holdout_scores.positive_rate:.3f})  Brier {holdout_scores.brier:.4f}"
        )

        results.append(
            {
                "target": target.key,
                "model": name,
                "features": target.features,
                "holdout_cycle": split.holdout_cycle,
                "train_cycles": split.train_cycles,
                "cv_auroc_mean": float(cv_auroc.mean()),
                "cv_auroc_std": float(cv_auroc.std()),
                "cv_auprc_mean": float(cv_auprc.mean()),
                "holdout": asdict(holdout_scores),
                "lift_over_base": float(holdout_scores.auprc / holdout_scores.positive_rate),
            }
        )

        if name == "xgboost":
            _subgroups(model, x_holdout, y_holdout)
        if name == "logistic":
            _drivers(model, target)

    return results


def _drivers(model: Pipeline, target: Target) -> None:
    """Standardised logistic coefficients, largest absolute effect first.

    If the ranking is dominated by age and sex, the model has little to say
    about what a user could change, and the challenge recommendation built on
    top of it has nothing to stand on.
    """
    names = list(model.named_steps["preprocess"].get_feature_names_out())
    coefficients = model.named_steps["model"].coef_[0]
    order = np.argsort(np.abs(coefficients))[::-1]
    modifiable = {
        "bmi",
        "waist_cm",
        "alcohol_days_per_year",
        "moderate_min_per_week",
        "vigorous_min_per_week",
        "sedentary_min_per_day",
        "sleep_hours",
        "smoking_status",
    }
    parts = []
    for position in order[:6]:
        raw = names[position].split("__", 1)[-1]
        tag = "*" if any(raw.startswith(m) for m in modifiable) else " "
        parts.append(f"{tag}{raw} {coefficients[position]:+.3f}")
    print(f"    drivers   {'  '.join(parts)}   (* = 개선 가능한 변수)")


def _subgroups(model: Pipeline, x_holdout: pd.DataFrame, y_holdout: pd.Series) -> None:
    """Holdout AUROC by sex and age band. A gap over 0.05 is a fairness flag."""
    probability = model.predict_proba(x_holdout)[:, 1]
    frame = pd.DataFrame({"y": y_holdout.to_numpy(), "p": probability}, index=x_holdout.index)
    frame["sex"] = x_holdout["sex"].astype(str)
    frame["age_band"] = pd.cut(pd.to_numeric(x_holdout["age"]), [18, 39, 59, 120], labels=["19-39", "40-59", "60+"])

    for column in ("sex", "age_band"):
        parts = []
        for value, group in frame.groupby(column, observed=True):
            if group["y"].nunique() < 2 or len(group) < 100:
                parts.append(f"{value}: n/a")
                continue
            parts.append(f"{value}: {roc_auc_score(group['y'], group['p']):.3f} (n={len(group)})")
        print(f"    subgroup {column:<9} {'  '.join(parts)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--targets", nargs="*", default=list(TARGETS))
    parser.add_argument("--no-family-history", action="store_true", help="가족력 변형을 건너뛴다")
    parser.add_argument("--holdout", default=None, help="홀드아웃 주기 고정 (가족력 A/B 공정 비교용)")
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "baseline_results.json")
    args = parser.parse_args()

    pooled = pd.read_csv(args.data, low_memory=False)
    print(f"data: {args.data}  rows={len(pooled)}")

    results: list[dict] = []
    for key in args.targets:
        target = TARGETS[key]
        results += run_target(pooled, target, args.holdout)
        if not args.no_family_history:
            results += run_target(pooled, with_family_history(target), args.holdout)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    table = pd.DataFrame(
        [
            {
                "target": r["target"],
                "model": r["model"],
                "holdout": r["holdout_cycle"],
                "n_holdout": r["holdout"]["n"],
                "base_rate": round(r["holdout"]["positive_rate"], 4),
                "cv_auroc": round(r["cv_auroc_mean"], 3),
                "holdout_auroc": round(r["holdout"]["auroc"], 3),
                "holdout_auprc": round(r["holdout"]["auprc"], 3),
                "auprc_lift": round(r["lift_over_base"], 2),
                "brier": round(r["holdout"]["brier"], 4),
            }
            for r in results
        ]
    )
    print("\n" + table.to_string(index=False))
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
