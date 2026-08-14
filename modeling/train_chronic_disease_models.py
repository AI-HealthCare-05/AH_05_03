"""Train and evaluate BRFSS chronic-disease reporting baselines.

The models estimate whether a BRFSS respondent reports having received a
diagnosis. They do not estimate future disease onset and are not diagnostic
medical devices.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import joblib
import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


DATASET_URL = "hf://datasets/hesscl/quackrfss/data/BRFSS_2024.parquet"

NUMERIC_FEATURES = ["age", "bmi"]
CATEGORICAL_FEATURES = [
    "sex",
    "education",
    "income",
    "employment",
    "exercise",
    "smoking_status",
    "drank_alcohol",
]
FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES

TARGETS = {
    "heart_attack": {
        "column": "target_heart_attack",
        "source": ["CVDINFR4"],
        "description": "Reported myocardial infarction diagnosis",
    },
    "coronary_heart_disease": {
        "column": "target_coronary_heart_disease",
        "source": ["CVDCRHD4"],
        "description": "Reported angina or coronary heart disease diagnosis",
    },
    "stroke": {
        "column": "target_stroke",
        "source": ["CVDSTRK3"],
        "description": "Reported stroke diagnosis",
    },
    "current_asthma": {
        "column": "target_current_asthma",
        "source": ["ASTHMA3", "ASTHNOW"],
        "description": "Reported current asthma",
    },
    "skin_cancer": {
        "column": "target_skin_cancer",
        "source": ["CHCSCNC1"],
        "description": "Reported skin-cancer diagnosis",
    },
    "other_cancer": {
        "column": "target_other_cancer",
        "source": ["CHCOCNC1"],
        "description": "Reported non-skin-cancer diagnosis",
    },
    "copd": {
        "column": "target_copd",
        "source": ["CHCCOPD3"],
        "description": "Reported COPD, emphysema, or chronic bronchitis diagnosis",
    },
    "depression": {
        "column": "target_depression",
        "source": ["ADDEPEV3"],
        "description": "Reported depressive-disorder diagnosis",
    },
    "kidney_disease": {
        "column": "target_kidney_disease",
        "source": ["CHCKDNY2"],
        "description": "Reported kidney-disease diagnosis",
    },
    "arthritis": {
        "column": "target_arthritis",
        "source": ["HAVARTH4"],
        "description": "Reported arthritis-related diagnosis",
    },
    "diabetes": {
        "column": "target_diabetes",
        "source": ["DIABETE4"],
        "description": "Reported diabetes diagnosis excluding gestational diabetes and prediabetes",
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("outputs"))
    parser.add_argument(
        "--model-dir", type=Path, default=Path("models/chronic_disease")
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=None,
        help="Optional reservoir sample for a quick smoke test; default uses all rows.",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-iter", type=int, default=500)
    return parser.parse_args()


def load_brfss(sample_size: int | None, seed: int) -> pd.DataFrame:
    sample_clause = ""
    if sample_size is not None:
        if sample_size < 1:
            raise ValueError("sample_size must be a positive integer")
        sample_clause = (
            f"USING SAMPLE reservoir({sample_size} ROWS) REPEATABLE({seed})"
        )

    query = f"""
        SELECT
            CAST(_STATE AS INTEGER) AS state,
            _LLCPWT AS survey_weight,
            CASE WHEN _AGE80 BETWEEN 18 AND 80 THEN _AGE80 END AS age,
            CASE WHEN _BMI5 BETWEEN 1000 AND 9998 THEN _BMI5 / 100.0 END AS bmi,
            CASE WHEN SEXVAR IN (1, 2) THEN CAST(SEXVAR AS INTEGER) END AS sex,
            CASE WHEN EDUCA BETWEEN 1 AND 6 THEN CAST(EDUCA AS INTEGER) END AS education,
            CASE WHEN INCOME3 BETWEEN 1 AND 11 THEN CAST(INCOME3 AS INTEGER) END AS income,
            CASE WHEN EMPLOY1 BETWEEN 1 AND 8 THEN CAST(EMPLOY1 AS INTEGER) END AS employment,
            CASE WHEN EXERANY2 IN (1, 2) THEN CAST(EXERANY2 AS INTEGER) END AS exercise,
            CASE WHEN _SMOKER3 BETWEEN 1 AND 4 THEN CAST(_SMOKER3 AS INTEGER) END AS smoking_status,
            CASE WHEN DRNKANY6 IN (1, 2) THEN CAST(DRNKANY6 AS INTEGER) END AS drank_alcohol,
            CASE WHEN CVDINFR4 = 1 THEN 1 WHEN CVDINFR4 = 2 THEN 0 END AS target_heart_attack,
            CASE WHEN CVDCRHD4 = 1 THEN 1 WHEN CVDCRHD4 = 2 THEN 0 END AS target_coronary_heart_disease,
            CASE WHEN CVDSTRK3 = 1 THEN 1 WHEN CVDSTRK3 = 2 THEN 0 END AS target_stroke,
            CASE
                WHEN ASTHMA3 = 2 THEN 0
                WHEN ASTHMA3 = 1 AND ASTHNOW = 1 THEN 1
                WHEN ASTHMA3 = 1 AND ASTHNOW = 2 THEN 0
            END AS target_current_asthma,
            CASE WHEN CHCSCNC1 = 1 THEN 1 WHEN CHCSCNC1 = 2 THEN 0 END AS target_skin_cancer,
            CASE WHEN CHCOCNC1 = 1 THEN 1 WHEN CHCOCNC1 = 2 THEN 0 END AS target_other_cancer,
            CASE WHEN CHCCOPD3 = 1 THEN 1 WHEN CHCCOPD3 = 2 THEN 0 END AS target_copd,
            CASE WHEN ADDEPEV3 = 1 THEN 1 WHEN ADDEPEV3 = 2 THEN 0 END AS target_depression,
            CASE WHEN CHCKDNY2 = 1 THEN 1 WHEN CHCKDNY2 = 2 THEN 0 END AS target_kidney_disease,
            CASE WHEN HAVARTH4 = 1 THEN 1 WHEN HAVARTH4 = 2 THEN 0 END AS target_arthritis,
            CASE WHEN DIABETE4 = 1 THEN 1 WHEN DIABETE4 IN (2, 3, 4) THEN 0 END AS target_diabetes
        FROM read_parquet('{DATASET_URL}')
        WHERE _STATE IS NOT NULL AND _LLCPWT > 0
        {sample_clause}
    """
    return duckdb.connect().sql(query).df()


def assign_group_splits(data: pd.DataFrame, seed: int) -> pd.Series:
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.20, random_state=seed)
    train_valid_positions, test_positions = next(
        splitter.split(data, groups=data["state"])
    )

    train_valid = data.iloc[train_valid_positions]
    validation_splitter = GroupShuffleSplit(
        n_splits=1, test_size=0.20, random_state=seed + 1
    )
    train_relative, validation_relative = next(
        validation_splitter.split(train_valid, groups=train_valid["state"])
    )

    splits = pd.Series("test", index=data.index, dtype="string")
    splits.iloc[train_valid_positions[train_relative]] = "train"
    splits.iloc[train_valid_positions[validation_relative]] = "validation"
    splits.iloc[test_positions] = "test"
    return splits


def build_preprocessor() -> ColumnTransformer:
    numeric_pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scaler", StandardScaler()),
        ]
    )
    categorical_pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore")),
        ]
    )
    return ColumnTransformer(
        [
            ("numeric", numeric_pipeline, NUMERIC_FEATURES),
            ("categorical", categorical_pipeline, CATEGORICAL_FEATURES),
        ]
    )


def normalized_weights(weights: np.ndarray) -> np.ndarray:
    weights = np.asarray(weights, dtype=float)
    mean_weight = weights.mean()
    if not np.isfinite(mean_weight) or mean_weight <= 0:
        raise ValueError("Survey weights must have a positive finite mean")
    return weights / mean_weight


def choose_threshold(
    y_true: np.ndarray, probabilities: np.ndarray, weights: np.ndarray
) -> float:
    false_positive_rate, true_positive_rate, thresholds = roc_curve(
        y_true, probabilities, sample_weight=weights
    )
    youden_j = true_positive_rate - false_positive_rate
    finite = np.isfinite(thresholds)
    if not finite.any():
        return 0.5
    finite_indices = np.flatnonzero(finite)
    best_index = finite_indices[np.argmax(youden_j[finite])]
    return float(np.clip(thresholds[best_index], 0.0, 1.0))


def evaluate_predictions(
    y_true: np.ndarray,
    probabilities: np.ndarray,
    weights: np.ndarray,
    threshold: float,
) -> dict[str, float | int]:
    predictions = (probabilities >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(
        y_true, predictions, labels=[0, 1], sample_weight=weights
    ).ravel()

    def safe_ratio(numerator: float, denominator: float) -> float:
        return float(numerator / denominator) if denominator > 0 else float("nan")

    return {
        "n": int(len(y_true)),
        "positive_n": int(np.sum(y_true)),
        "weighted_prevalence": float(np.average(y_true, weights=weights)),
        "auroc": float(roc_auc_score(y_true, probabilities, sample_weight=weights)),
        "auprc": float(
            average_precision_score(y_true, probabilities, sample_weight=weights)
        ),
        "brier_score": float(
            brier_score_loss(y_true, probabilities, sample_weight=weights)
        ),
        "threshold": float(threshold),
        "sensitivity": safe_ratio(tp, tp + fn),
        "specificity": safe_ratio(tn, tn + fp),
        "ppv": safe_ratio(tp, tp + fp),
        "npv": safe_ratio(tn, tn + fn),
    }


def transform_splits(data: pd.DataFrame, preprocessor: ColumnTransformer):
    split_positions = {
        name: np.flatnonzero(data["split"].eq(name).to_numpy())
        for name in ("train", "validation", "test")
    }
    transformed = {
        "train": preprocessor.fit_transform(
            data.iloc[split_positions["train"]][FEATURES]
        ),
        "validation": preprocessor.transform(
            data.iloc[split_positions["validation"]][FEATURES]
        ),
        "test": preprocessor.transform(
            data.iloc[split_positions["test"]][FEATURES]
        ),
    }
    return split_positions, transformed


def create_evaluation_plot(metrics: pd.DataFrame, output_path: Path) -> None:
    ordered = metrics.sort_values("auroc", ascending=True)
    fig, axes = plt.subplots(1, 3, figsize=(18, 7))

    axes[0].barh(ordered["disease"], ordered["auroc"], color="#3366CC")
    axes[0].axvline(0.5, color="#B3261E", linestyle="--", linewidth=1)
    axes[0].set(xlim=(0.45, 1.0), title="Held-out-state AUROC", xlabel="AUROC")

    positions = np.arange(len(ordered))
    axes[1].barh(positions, ordered["auprc"], color="#109D59", label="AUPRC")
    axes[1].scatter(
        ordered["weighted_prevalence"],
        positions,
        color="#F4B400",
        marker="|",
        s=180,
        linewidth=2,
        label="Prevalence baseline",
    )
    axes[1].set_yticks(positions, labels=ordered["disease"])
    axes[1].set(title="AUPRC vs prevalence", xlabel="Score")
    axes[1].legend()

    axes[2].barh(
        positions - 0.18,
        ordered["sensitivity"],
        height=0.36,
        color="#9C27B0",
        label="Sensitivity",
    )
    axes[2].barh(
        positions + 0.18,
        ordered["specificity"],
        height=0.36,
        color="#00ACC1",
        label="Specificity",
    )
    axes[2].set_yticks(positions, labels=ordered["disease"])
    axes[2].set(xlim=(0.0, 1.0), title="Threshold performance", xlabel="Score")
    axes[2].legend()

    fig.suptitle("BRFSS 2024 chronic-disease reporting baselines", fontsize=15)
    fig.tight_layout()
    fig.savefig(output_path, dpi=160, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.model_dir.mkdir(parents=True, exist_ok=True)

    print("Loading BRFSS data...")
    data = load_brfss(args.sample_size, args.seed)
    data["split"] = assign_group_splits(data, args.seed)

    preprocessor = build_preprocessor()
    split_positions, transformed = transform_splits(data, preprocessor)
    feature_names = preprocessor.get_feature_names_out()
    joblib.dump(preprocessor, args.model_dir / "preprocessor.joblib")

    metric_rows: list[dict[str, float | int | str]] = []
    subgroup_rows: list[dict[str, float | int | str]] = []
    coefficient_frames: list[pd.DataFrame] = []
    thresholds: dict[str, float] = {}

    for disease, target_spec in TARGETS.items():
        target = target_spec["column"]
        print(f"Training {disease}...")

        prepared: dict[str, tuple[object, np.ndarray, np.ndarray, pd.DataFrame]] = {}
        for split_name in ("train", "validation", "test"):
            positions = split_positions[split_name]
            frame = data.iloc[positions]
            valid_target = frame[target].notna().to_numpy()
            prepared[split_name] = (
                transformed[split_name][valid_target],
                frame.loc[valid_target, target].astype(int).to_numpy(),
                frame.loc[valid_target, "survey_weight"].to_numpy(dtype=float),
                frame.loc[valid_target],
            )

        x_train, y_train, w_train, _ = prepared["train"]
        x_validation, y_validation, w_validation, _ = prepared["validation"]
        x_test, y_test, w_test, test_frame = prepared["test"]

        for split_name, (_, y_values, _, _) in prepared.items():
            if np.unique(y_values).size != 2:
                raise RuntimeError(
                    f"{disease} has fewer than two classes in {split_name} split"
                )

        classifier = LogisticRegression(
            solver="lbfgs",
            max_iter=args.max_iter,
            random_state=args.seed,
        )
        classifier.fit(x_train, y_train, sample_weight=normalized_weights(w_train))

        validation_probabilities = classifier.predict_proba(x_validation)[:, 1]
        threshold = choose_threshold(
            y_validation, validation_probabilities, w_validation
        )
        test_probabilities = classifier.predict_proba(x_test)[:, 1]
        disease_metrics = evaluate_predictions(
            y_test, test_probabilities, w_test, threshold
        )
        disease_metrics.update(
            {
                "disease": disease,
                "description": target_spec["description"],
                "train_n": int(len(y_train)),
                "validation_n": int(len(y_validation)),
            }
        )
        metric_rows.append(disease_metrics)
        thresholds[disease] = threshold

        for sex_code, sex_label in ((1, "male"), (2, "female")):
            subgroup_mask = test_frame["sex"].eq(sex_code).to_numpy()
            subgroup_y = y_test[subgroup_mask]
            if len(subgroup_y) < 100 or np.unique(subgroup_y).size != 2:
                continue
            subgroup_metrics = evaluate_predictions(
                subgroup_y,
                test_probabilities[subgroup_mask],
                w_test[subgroup_mask],
                threshold,
            )
            subgroup_metrics.update(
                {"disease": disease, "subgroup": "sex", "group": sex_label}
            )
            subgroup_rows.append(subgroup_metrics)

        coefficient_frames.append(
            pd.DataFrame(
                {
                    "disease": disease,
                    "feature": feature_names,
                    "coefficient": classifier.coef_[0],
                }
            ).assign(abs_coefficient=lambda frame: frame["coefficient"].abs())
        )
        joblib.dump(classifier, args.model_dir / f"{disease}.joblib")

    metrics = pd.DataFrame(metric_rows).sort_values("disease")
    subgroup_metrics = pd.DataFrame(subgroup_rows).sort_values(
        ["disease", "subgroup", "group"]
    )
    coefficients = pd.concat(coefficient_frames, ignore_index=True).sort_values(
        ["disease", "abs_coefficient"], ascending=[True, False]
    )

    metrics_path = args.output_dir / "chronic_disease_model_metrics.csv"
    subgroup_path = args.output_dir / "chronic_disease_subgroup_metrics.csv"
    coefficients_path = args.output_dir / "chronic_disease_feature_coefficients.csv"
    plot_path = args.output_dir / "chronic_disease_model_evaluation.png"
    metrics.to_csv(metrics_path, index=False)
    subgroup_metrics.to_csv(subgroup_path, index=False)
    coefficients.to_csv(coefficients_path, index=False)
    create_evaluation_plot(metrics, plot_path)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset": DATASET_URL,
        "data_year": 2024,
        "sample_size": args.sample_size,
        "model_family": "weighted logistic regression",
        "preprocessor": "preprocessor.joblib",
        "features": FEATURES,
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "targets": TARGETS,
        "thresholds": thresholds,
        "split": {
            split_name: sorted(
                int(value)
                for value in data.loc[data["split"].eq(split_name), "state"].unique()
            )
            for split_name in ("train", "validation", "test")
        },
        "disclaimer": (
            "Estimates reported diagnosis probability in BRFSS 2024; not future "
            "disease onset, diagnosis, or medical advice."
        ),
    }
    (args.model_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("\nHeld-out-state evaluation")
    print(
        metrics[
            [
                "disease",
                "weighted_prevalence",
                "auroc",
                "auprc",
                "sensitivity",
                "specificity",
                "brier_score",
            ]
        ].to_string(index=False, float_format=lambda value: f"{value:.4f}")
    )
    print(f"\nSaved models to {args.model_dir}")
    print(f"Saved evaluation outputs to {args.output_dir}")


if __name__ == "__main__":
    main()
