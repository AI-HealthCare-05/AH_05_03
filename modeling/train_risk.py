"""Logistic-regression risk model on the unified table.

Two targets that every source can supply: prevalent diabetes and prevalent
hypertension. The undiagnosed-screening labels used earlier need measured values
and BRFSS has none, so prevalence is the only label the merge supports.

How the nulls are handled
-------------------------
Each source carries a different slice of the schema, so the unified table is
sparse by construction. Numeric columns get a median fill plus a companion
``*_missing`` indicator, and categoricals get an explicit ``"__missing__"``
level. Nothing is silently invented: the model can see that a value was absent
and learn from that fact.

Why per-source evaluation
-------------------------
A column that exists in only one source doubles as a source label, so a pooled
AUROC can be inflated by the model simply recognising which dataset a row came
from. Within a single source every row shares the same missingness pattern, so
that shortcut carries no information. Per-source numbers are the honest ones and
are reported first.

    python modeling/train_risk.py
    python modeling/train_risk.py --target htn
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

# schema.py lives next to the loaders it serves.
sys.path.insert(0, str(Path(__file__).resolve().parent / "data"))

from schema import ANTHROPOMETRIC, COMORBIDITY, CONTEXT, DEMOGRAPHIC, FAMILY_HISTORY, LABS, LIFESTYLE
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from splits import SEED

DATA = Path(__file__).resolve().parent / "data" / "processed" / "unified.csv"
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

CATEGORICAL = ["sex", "smoking_status"]
ALL_NUMERIC = [
    c
    for c in DEMOGRAPHIC + FAMILY_HISTORY + LIFESTYLE + ANTHROPOMETRIC + CONTEXT + COMORBIDITY + LABS
    if c not in CATEGORICAL
]

TARGETS: dict[str, dict[str, Any]] = {
    "dm": {
        "label": "label_dm_prevalent",
        "description": "당뇨 유병 (측정 기준 또는 진단·투약)",
        # The label is built from these, so they can never be inputs.
        "blocked": ["fasting_glucose", "hba1c", "dx_diabetes", "med_diabetes", "dx_prediabetes_told"],
    },
    "htn": {
        "label": "label_htn_prevalent",
        "description": "고혈압 유병 (측정 기준 또는 진단·투약)",
        "blocked": ["sbp", "dbp", "dx_hypertension", "med_hypertension"],
    },
}

# Feature blocks, so the report can separate "this person is unwell in ways a
# doctor already recorded" from "this person's own numbers and habits".
ABLATIONS = {
    "full": [],
    "동반질환 제외": ["dx_high_cholesterol", "dx_stroke", "dx_heart_disease", "dx_hypertension", "dx_diabetes"],
    "동반질환+주관건강 제외": [
        "dx_high_cholesterol",
        "dx_stroke",
        "dx_heart_disease",
        "dx_hypertension",
        "dx_diabetes",
        "self_rated_health",
        "difficulty_walking",
        "unhealthy_days_physical",
        "unhealthy_days_mental",
    ],
    "핵심만 (나이·성별·BMI·흡연)": None,  # handled explicitly below
}

CORE_ONLY = ["age", "bmi"]

AGE_BINS = [18, 39, 59, 120]
AGE_LABELS = ["19-39", "40-59", "60+"]


def features_for(target: str, ablation: str = "full") -> tuple[list[str], list[str]]:
    blocked = set(TARGETS[target]["blocked"])
    if ablation == "핵심만 (나이·성별·BMI·흡연)":
        return [c for c in CORE_ONLY if c not in blocked], [c for c in CATEGORICAL if c not in blocked]

    blocked |= set(ABLATIONS.get(ablation) or [])
    numeric = [c for c in ALL_NUMERIC if c not in blocked]
    # The other condition's diagnosis is a legitimate predictor and every source has it.
    extra = "dx_hypertension" if target == "dm" else "dx_diabetes"
    if extra not in blocked and extra not in numeric:
        numeric.append(extra)
    return numeric, [c for c in CATEGORICAL if c not in blocked]


def make_pipeline(numeric: list[str], categorical: list[str], add_indicator: bool = True) -> Pipeline:
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
                                    # add_indicator keeps "this was missing" as a feature
                                    # instead of pretending the median was observed.
                                    ("impute", SimpleImputer(strategy="median", add_indicator=add_indicator)),
                                    ("scale", StandardScaler()),
                                ]
                            ),
                            numeric,
                        ),
                        (
                            "categorical",
                            OneHotEncoder(handle_unknown="ignore", drop="first"),
                            categorical,
                        ),
                    ]
                ),
            ),
            ("model", LogisticRegression(max_iter=3000, C=0.1, random_state=SEED)),
        ]
    )


def prepare(unified: pd.DataFrame, target: str, ablation: str = "full") -> tuple[pd.DataFrame, pd.Series]:
    numeric, categorical = features_for(target, ablation)
    label = unified[TARGETS[target]["label"]].astype("boolean")
    usable = label.notna()

    frame = unified.loc[usable, numeric + categorical].copy()
    for column in numeric:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    for column in categorical:
        frame[column] = frame[column].astype("object").fillna("__missing__").astype(str)
    return frame, label[usable].astype(int)


def split_index(unified: pd.DataFrame, index: pd.Index) -> tuple[pd.Index, pd.Index]:
    """Holdout: the newest NHANES cycle, plus a 30% random slice of each other source."""
    subset = unified.loc[index]
    rng = np.random.default_rng(SEED)
    holdout = pd.Series(False, index=index)

    nhanes = subset["source"].eq("nhanes_pooled")
    holdout[nhanes & subset["cycle"].eq("2021_2023")] = True

    for name in ("brfss_health_indicators", "framingham"):
        rows = subset.index[subset["source"].eq(name)]
        picked = rng.choice(len(rows), size=int(len(rows) * 0.3), replace=False)
        holdout[rows[picked]] = True

    return index[~holdout.to_numpy()], index[holdout.to_numpy()]


def evaluate(y: np.ndarray, probability: np.ndarray) -> dict[str, float] | None:
    if len(np.unique(y)) < 2 or len(y) < 100:
        return None
    return {
        "n": int(len(y)),
        "positive_rate": float(np.mean(y)),
        "auroc": float(roc_auc_score(y, probability)),
        "auprc": float(average_precision_score(y, probability)),
        "brier": float(brier_score_loss(y, probability)),
    }


def show(name: str, scores: dict[str, float] | None, width: int = 30) -> None:
    if scores is None:
        print(f"  {name:<{width}} n/a")
        return
    print(
        f"  {name:<{width}} n={scores['n']:>6}  양성 {scores['positive_rate']:>6.1%}  "
        f"AUROC {scores['auroc']:.3f}  AUPRC {scores['auprc']:.3f}  Brier {scores['brier']:.4f}"
    )


def run(unified: pd.DataFrame, target: str) -> dict:
    spec = TARGETS[target]
    x, y = prepare(unified, target)
    numeric, categorical = features_for(target)
    train_index, holdout_index = split_index(unified, x.index)

    print("=" * 88)
    print(f"{target} — {spec['description']}")
    print("=" * 88)
    print(f"  입력 {len(numeric) + len(categorical)}개 (결측 지시자 별도 생성)")
    print(f"  학습 {len(train_index)}  홀드아웃 {len(holdout_index)}")

    results: dict = {"target": target, "n_features": len(numeric) + len(categorical)}

    variants = {
        "통합 학습": train_index,
        "NHANES만 학습": train_index[unified.loc[train_index, "source"].eq("nhanes_pooled").to_numpy()],
    }

    for variant, fit_index in variants.items():
        model = make_pipeline(numeric, categorical).fit(x.loc[fit_index], y.loc[fit_index])
        probability = pd.Series(model.predict_proba(x.loc[holdout_index])[:, 1], index=holdout_index)

        print(f"\n--- {variant} (n={len(fit_index)})")
        entry: dict = {"train_rows": int(len(fit_index)), "by_source": {}, "by_band": {}}

        for source, group in unified.loc[holdout_index].groupby("source"):
            scores = evaluate(y.loc[group.index].to_numpy(), probability.loc[group.index].to_numpy())
            show(str(source), scores)
            entry["by_source"][str(source)] = scores

        print("  " + "-" * 84)
        age = pd.to_numeric(unified.loc[holdout_index, "age"], errors="coerce")
        band = pd.cut(age, AGE_BINS, labels=AGE_LABELS)
        for source in ("nhanes_pooled", "brfss_health_indicators"):
            rows = unified.loc[holdout_index, "source"].eq(source)
            for name in AGE_LABELS:
                mask = (rows & band.eq(name)).to_numpy()
                scores = evaluate(y.loc[holdout_index[mask]].to_numpy(), probability.to_numpy()[mask])
                show(f"{source.split('_')[0]} {name}", scores)
                entry["by_band"][f"{source}:{name}"] = scores

        results[variant] = entry

    return results


def run_ablation(unified: pd.DataFrame, target: str) -> list[dict]:
    """How much of the score comes from each feature block, per age band."""
    print("=" * 88)
    print(f"{target} — 변수 블록별 기여 (통합 학습, NHANES 홀드아웃)")
    print("=" * 88)
    rows = []

    for ablation in ABLATIONS:
        x, y = prepare(unified, target, ablation)
        numeric, categorical = features_for(target, ablation)
        train_index, holdout_index = split_index(unified, x.index)

        model = make_pipeline(numeric, categorical).fit(x.loc[train_index], y.loc[train_index])
        probability = pd.Series(model.predict_proba(x.loc[holdout_index])[:, 1], index=holdout_index)

        age = pd.to_numeric(unified.loc[holdout_index, "age"], errors="coerce")
        band = pd.cut(age, AGE_BINS, labels=AGE_LABELS)
        nhanes = unified.loc[holdout_index, "source"].eq("nhanes_pooled")

        overall = evaluate(
            y.loc[holdout_index[nhanes.to_numpy()]].to_numpy(), probability[nhanes.to_numpy()].to_numpy()
        )
        parts = []
        entry: dict[str, Any] = {
            "target": target,
            "ablation": ablation,
            "n_features": len(numeric) + len(categorical),
        }
        for name in AGE_LABELS:
            mask = (nhanes & band.eq(name)).to_numpy()
            scores = evaluate(y.loc[holdout_index[mask]].to_numpy(), probability.to_numpy()[mask])
            value = scores["auroc"] if scores else float("nan")
            parts.append(f"{name} {value:.3f}")
            entry[name] = value
        entry["overall"] = overall["auroc"] if overall else float("nan")
        band_scores = [float(entry[n]) for n in AGE_LABELS]
        spread = max(band_scores) - min(band_scores)
        entry["band_spread"] = spread
        print(
            f"  {ablation:<28} 변수 {entry['n_features']:>2}개  전체 {entry['overall']:.3f}  "
            f"{'  '.join(parts)}  격차 {spread:.3f}"
        )
        rows.append(entry)

    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=list(TARGETS))
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "risk_model_results.json")
    parser.add_argument("--ablation", action="store_true", help="변수 블록별 기여만 출력")
    args = parser.parse_args()

    unified = pd.read_csv(args.data, low_memory=False)
    print(f"data: {args.data}  rows={len(unified)}\n")

    if args.ablation:
        results = [{"ablation": run_ablation(unified, target)} for target in args.target]
    else:
        results = [run(unified, target) for target in args.target]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
