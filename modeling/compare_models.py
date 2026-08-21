"""Bootstrap the holdout AUROC gap between two tuned models.

The tuning run moved XGBoost ahead of logistic regression by 0.012-0.017 AUROC.
On a holdout of a few thousand rows with a few hundred positives, a gap that
size can easily be sampling noise. This resamples the holdout to put an interval
around the difference before anyone calls a winner.

    python modeling/compare_models.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from experiments import prepare
from features import TARGETS
from sklearn.metrics import roc_auc_score
from splits import SEED
from train_baseline import make_model

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

# Winning configurations from experiments.py tune.
BEST: dict[str, dict[str, dict[str, object]]] = {
    "dm_undiagnosed": {
        "logistic": {"model__C": 0.1},
        "xgboost": {"model__max_depth": 2, "model__min_child_weight": 50, "model__n_estimators": 200},
    },
    "prediabetes": {
        "logistic": {"model__C": 0.01},
        "xgboost": {"model__max_depth": 2, "model__min_child_weight": 50, "model__n_estimators": 200},
    },
    "htn_undiagnosed": {
        "logistic": {"model__C": 0.01},
        "xgboost": {"model__max_depth": 3, "model__min_child_weight": 50, "model__n_estimators": 200},
    },
}


def bootstrap_gap(
    y: np.ndarray, left: np.ndarray, right: np.ndarray, draws: int = 2000
) -> tuple[float, float, float, float]:
    """Paired bootstrap of AUROC(right) - AUROC(left). Returns mean, lo, hi, p."""
    rng = np.random.default_rng(SEED)
    gaps = np.empty(draws)
    size = len(y)
    for i in range(draws):
        index = rng.integers(0, size, size)
        sample = y[index]
        if len(np.unique(sample)) < 2:
            gaps[i] = np.nan
            continue
        gaps[i] = roc_auc_score(sample, right[index]) - roc_auc_score(sample, left[index])
    gaps = gaps[~np.isnan(gaps)]
    # Two-sided proportion of resamples on the wrong side of zero.
    crossing = float(min((gaps <= 0).mean(), (gaps >= 0).mean()) * 2)
    return float(gaps.mean()), float(np.quantile(gaps, 0.025)), float(np.quantile(gaps, 0.975)), crossing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--draws", type=int, default=2000)
    args = parser.parse_args()

    pooled = pd.read_csv(Path(__file__).resolve().parent / "data" / "processed" / "nhanes_pooled.csv", low_memory=False)

    rows = []
    print(f"{'target':<18}{'LR':>7}{'XGB':>8}{'차이':>9}{'95% CI':>20}{'판정':>10}")
    for key, target in TARGETS.items():
        x_train, y_train, x_holdout, y_holdout = prepare(pooled, target)
        y = y_holdout.to_numpy()

        predictions = {}
        for name in ("logistic", "xgboost"):
            model = make_model(name, target, 1.0)
            model.set_params(**dict(BEST[key][name]))
            model.fit(x_train, y_train)
            predictions[name] = model.predict_proba(x_holdout)[:, 1]

        left_auroc = roc_auc_score(y, predictions["logistic"])
        right_auroc = roc_auc_score(y, predictions["xgboost"])
        gap, low, high, crossing = bootstrap_gap(y, predictions["logistic"], predictions["xgboost"], args.draws)
        verdict = "유의" if low > 0 or high < 0 else "구분 안 됨"
        print(
            f"{key:<18}{left_auroc:>7.3f}{right_auroc:>8.3f}{gap:>+9.3f}{f'[{low:+.3f}, {high:+.3f}]':>20}{verdict:>10}"
        )
        rows.append(
            {
                "target": key,
                "logistic_auroc": float(left_auroc),
                "xgboost_auroc": float(right_auroc),
                "gap_mean": gap,
                "ci_low": low,
                "ci_high": high,
                "two_sided_crossing": crossing,
                "verdict": verdict,
            }
        )

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    destination = ARTIFACTS / "model_comparison.json"
    destination.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
