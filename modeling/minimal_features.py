"""How few questions can the risk model be asked and still be useful?

The model never *requires* a field: missing values are imputed and flagged, so a
prediction always comes back. The real question is how accuracy responds to each
question we add, and where the curve flattens. That is what decides how long the
onboarding form has to be.

Two things are measured.

``greedy``
    Forward selection over the fields a product can actually ask for. At each
    step it adds whichever remaining field buys the most holdout AUROC, so the
    output is a ranked list of questions by marginal value.

``ladder``
    The same measurement over the onboarding screens as currently designed
    (`docs/planning/02_IA_화면목록.md` SCR-ONBD-02~05), answering "what do we get
    after screen 2, after screen 3, ...".

Labs are excluded from the candidate pool. Handing the model a fasting glucose
to predict diabetes is a threshold check, not a prediction.

    python modeling/minimal_features.py greedy
    python modeling/minimal_features.py ladder
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from splits import SEED
from train_risk import (
    AGE_BINS,
    AGE_LABELS,
    CATEGORICAL,
    DATA,
    TARGETS,
    evaluate,
    make_pipeline,
    split_index,
)

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

# Fields a user could plausibly be asked for on a phone. No blood work, no
# comorbidity history (see UNIFIED_RISK_REPORT section 6 on circularity).
CANDIDATES = [
    "age",
    "sex",
    "bmi",
    "waist_cm",
    "smoking_status",
    "self_rated_health",
    "difficulty_walking",
    "sbp",
    "dbp",
    "alcohol_days_per_year",
    "heavy_alcohol",
    "moderate_min_per_week",
    "vigorous_min_per_week",
    "physical_activity_any",
    "sedentary_min_per_day",
    "sleep_hours",
    "veg_fruit_daily",
    "education_level",
    "income_rank",
    "unhealthy_days_physical",
    "unhealthy_days_mental",
    "fh_diabetes",
    "fh_cvd",
]

# Onboarding screens as designed, in the order the user meets them.
SCREENS: list[tuple[str, list[str]]] = [
    ("SCR-ONBD-02 기본정보", ["age", "sex"]),
    ("+ 가족력", ["fh_diabetes", "fh_cvd"]),
    (
        "SCR-ONBD-03 생활습관",
        [
            "smoking_status",
            "alcohol_days_per_year",
            "moderate_min_per_week",
            "vigorous_min_per_week",
            "sedentary_min_per_day",
            "sleep_hours",
            "veg_fruit_daily",
        ],
    ),
    ("SCR-ONBD-04 신체계측", ["bmi", "waist_cm"]),
    ("+ 혈압", ["sbp", "dbp"]),
    ("신규 제안: 주관적 건강·보행", ["self_rated_health", "difficulty_walking"]),
    ("사회경제", ["education_level", "income_rank"]),
]

# Selection runs on a subsample; the reported numbers come from the full holdout.
SELECTION_ROWS = 60000


def prepare_pool(unified: pd.DataFrame, target: str) -> tuple[pd.DataFrame, pd.Series, list[str]]:
    blocked = set(TARGETS[target]["blocked"])
    usable = [c for c in CANDIDATES if c not in blocked]

    label = unified[TARGETS[target]["label"]].astype("boolean")
    keep = label.notna()
    frame = unified.loc[keep, usable].copy()
    for column in usable:
        if column in CATEGORICAL:
            frame[column] = frame[column].astype("object").fillna("__missing__").astype(str)
        else:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame, label[keep].astype(int), usable


def fit_score(
    x: pd.DataFrame,
    y: pd.Series,
    columns: list[str],
    train_index: pd.Index,
    holdout_index: pd.Index,
) -> tuple[float, pd.Series]:
    numeric = [c for c in columns if c not in CATEGORICAL]
    categorical = [c for c in columns if c in CATEGORICAL]
    model = make_pipeline(numeric, categorical).fit(x.loc[train_index, columns], y.loc[train_index])
    probability = pd.Series(model.predict_proba(x.loc[holdout_index, columns])[:, 1], index=holdout_index)
    return float(roc_auc_score(y.loc[holdout_index], probability)), probability


def band_scores(unified: pd.DataFrame, y: pd.Series, probability: pd.Series, source: str) -> dict[str, float | None]:
    holdout = unified.loc[probability.index]
    rows = holdout["source"].eq(source)
    age = pd.to_numeric(holdout["age"], errors="coerce")
    band = pd.cut(age, AGE_BINS, labels=AGE_LABELS)
    out: dict[str, float | None] = {}
    for name in AGE_LABELS:
        mask = (rows & band.eq(name)).to_numpy()
        scores = evaluate(y.loc[probability.index[mask]].to_numpy(), probability.to_numpy()[mask])
        out[name] = scores["auroc"] if scores else None
    return out


def report_row(step: int, name: str, auroc: float, bands: dict[str, float | None]) -> None:
    parts = "  ".join(f"{k} {v:.3f}" if v else f"{k}  n/a" for k, v in bands.items())
    values = [v for v in bands.values() if v]
    spread = max(values) - min(values) if len(values) > 1 else float("nan")
    print(f"  {step:>2}. {name:<34} AUROC {auroc:.3f}   {parts}   격차 {spread:.3f}")


def run_greedy(unified: pd.DataFrame, target: str) -> list[dict]:
    x, y, pool = prepare_pool(unified, target)
    train_index, holdout_index = split_index(unified, x.index)

    rng = np.random.default_rng(SEED)
    if len(train_index) > SELECTION_ROWS:
        picked = rng.choice(len(train_index), SELECTION_ROWS, replace=False)
        selection_index = train_index[picked]
    else:
        selection_index = train_index

    print("=" * 104)
    print(f"{target} — 질문을 하나씩 늘렸을 때 (전진 선택, NHANES 홀드아웃 기준)")
    print("=" * 104)

    chosen: list[str] = []
    remaining = list(pool)
    rows: list[dict[str, Any]] = []

    while remaining:
        best_column, best_auroc = None, -1.0
        for column in remaining:
            auroc, _ = fit_score(x, y, [*chosen, column], selection_index, holdout_index)
            if auroc > best_auroc:
                best_column, best_auroc = column, auroc

        assert best_column is not None
        chosen.append(best_column)
        remaining.remove(best_column)

        # Re-fit on the full training set for the number that gets reported.
        auroc, probability = fit_score(x, y, chosen, train_index, holdout_index)
        bands = band_scores(unified, y, probability, "nhanes_pooled")
        gain = auroc - float(rows[-1]["auroc"]) if rows else auroc - 0.5
        report_row(len(chosen), f"+ {best_column}  ({gain:+.3f})", auroc, bands)
        rows.append(
            {
                "target": target,
                "step": len(chosen),
                "added": best_column,
                "features": list(chosen),
                "auroc": auroc,
                "gain": gain,
                "bands": bands,
            }
        )

    return rows


def run_ladder(unified: pd.DataFrame, target: str) -> list[dict]:
    x, y, pool = prepare_pool(unified, target)
    train_index, holdout_index = split_index(unified, x.index)

    print("=" * 104)
    print(f"{target} — 온보딩 화면 단위 누적 (NHANES 홀드아웃 기준)")
    print("=" * 104)

    accumulated: list[str] = []
    rows: list[dict[str, Any]] = []
    for step, (name, columns) in enumerate(SCREENS, start=1):
        addition = [c for c in columns if c in pool and c not in accumulated]
        if not addition:
            print(f"  {step:>2}. {name:<34} (이 타깃에서는 라벨 구성 변수라 제외)")
            continue
        accumulated += addition

        auroc, probability = fit_score(x, y, accumulated, train_index, holdout_index)
        bands = band_scores(unified, y, probability, "nhanes_pooled")
        gain = auroc - float(rows[-1]["auroc"]) if rows else auroc - 0.5
        report_row(step, f"{name} ({len(accumulated)}개, {gain:+.3f})", auroc, bands)
        rows.append(
            {
                "target": target,
                "step": step,
                "screen": name,
                "n_features": len(accumulated),
                "features": list(accumulated),
                "auroc": auroc,
                "gain": gain,
                "bands": bands,
            }
        )

    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["greedy", "ladder", "all"], default="all", nargs="?")
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=list(TARGETS))
    args = parser.parse_args()

    unified = pd.read_csv(args.data, low_memory=False)
    results: dict[str, list[dict]] = {}

    for target in args.target:
        if args.mode in {"greedy", "all"}:
            results[f"greedy_{target}"] = run_greedy(unified, target)
            print()
        if args.mode in {"ladder", "all"}:
            results[f"ladder_{target}"] = run_ladder(unified, target)
            print()

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    destination = ARTIFACTS / f"minimal_features_{args.mode}.json"
    destination.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
