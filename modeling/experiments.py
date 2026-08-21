"""Follow-up experiments on the LR / XGBoost baselines.

Five questions, one subcommand each.

    age        60대 이상에서 모델이 거의 작동하지 않는 문제
    operating  보정 곡선과 운영점 선택, 전단계 타깃의 실제 값어치
    tune       정규화와 하이퍼파라미터를 손보면 결론이 뒤집히는가
    external   UCI 891(253,680행) 대조와 전이 성능
    tabpfn     사전학습 표 모델과의 비교

    python modeling/experiments.py age
    python modeling/experiments.py all
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
from features import TARGETS, Target, build_matrix
from sklearn.calibration import calibration_curve
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from splits import SEED, cv_folds, make_split
from train_baseline import make_model

DATA = Path(__file__).resolve().parent / "data" / "processed" / "nhanes_pooled.csv"
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

AGE_BANDS = [(19, 39, "19-39"), (40, 59, "40-59"), (60, 120, "60+")]
MODIFIABLE = [
    "bmi",
    "waist_cm",
    "alcohol_days_per_year",
    "moderate_min_per_week",
    "vigorous_min_per_week",
    "sedentary_min_per_day",
    "sleep_hours",
]


def load() -> pd.DataFrame:
    return pd.read_csv(DATA, low_memory=False)


def prepare(pooled: pd.DataFrame, target: Target, holdout_cycle: str = "2021_2023"):
    features, labels = build_matrix(pooled, target)
    cycle = pooled.loc[features.index, "cycle"]
    split = make_split(cycle, holdout_cycle)
    return (
        features.loc[split.train_index],
        labels.loc[split.train_index],
        features.loc[split.holdout_index],
        labels.loc[split.holdout_index],
    )


def band_of(features: pd.DataFrame) -> pd.Series:
    age = pd.to_numeric(features["age"])
    return pd.cut(
        age,
        [18, 39, 59, 120],
        labels=[name for _, _, name in AGE_BANDS],
    )


def safe_auroc(y: pd.Series | np.ndarray, p: np.ndarray) -> float | None:
    y = np.asarray(y)
    if len(np.unique(y)) < 2 or len(y) < 100:
        return None
    return float(roc_auc_score(y, p))


def fmt(value: float | None) -> str:
    return "  n/a" if value is None else f"{value:.3f}"


# ---------------------------------------------------------------------------
# 1. age
# ---------------------------------------------------------------------------


def add_interactions(features: pd.DataFrame) -> pd.DataFrame:
    """age x modifiable products, so a linear model can bend per age."""
    result = features.copy()
    age = pd.to_numeric(result["age"])
    for column in MODIFIABLE:
        if column in result.columns:
            result[f"{column}_x_age"] = pd.to_numeric(result[column]) * age
    return result


def experiment_age(pooled: pd.DataFrame) -> list[dict]:
    print("=" * 78)
    print("1. 연령대별 변별력 — 전역 모델 / 상호작용항 / 연령대 전용 모델")
    print("=" * 78)
    rows = []

    for key, target in TARGETS.items():
        x_train, y_train, x_holdout, y_holdout = prepare(pooled, target)
        train_band, holdout_band = band_of(x_train), band_of(x_holdout)

        global_model = make_model("logistic", target, 1.0).fit(x_train, y_train)
        global_probability = global_model.predict_proba(x_holdout)[:, 1]

        interaction_target = Target(
            key=f"{target.key}_ix",
            label=target.label,
            description=target.description,
            label_inputs=target.label_inputs,
            numeric=target.numeric + [f"{c}_x_age" for c in MODIFIABLE if c in target.numeric],
            categorical=target.categorical,
            population=target.population,
        )
        interaction_model = make_model("logistic", interaction_target, 1.0).fit(add_interactions(x_train), y_train)
        interaction_probability = interaction_model.predict_proba(add_interactions(x_holdout))[:, 1]

        print(f"\n--- {key}")
        print(f"{'band':<8}{'n(hold)':>9}{'양성':>8}{'전역':>8}{'상호작용':>10}{'전용':>8}")
        for _, _, name in AGE_BANDS:
            train_mask, holdout_mask = train_band.eq(name), holdout_band.eq(name)
            if holdout_mask.sum() < 100:
                continue

            y_band = y_holdout[holdout_mask]
            global_score = safe_auroc(y_band, global_probability[holdout_mask.to_numpy()])
            interaction_score = safe_auroc(y_band, interaction_probability[holdout_mask.to_numpy()])

            dedicated_score = None
            if train_mask.sum() >= 500 and y_train[train_mask].sum() >= 30:
                dedicated = make_model("logistic", target, 1.0).fit(x_train[train_mask], y_train[train_mask])
                dedicated_score = safe_auroc(y_band, dedicated.predict_proba(x_holdout[holdout_mask])[:, 1])

            print(
                f"{name:<8}{int(holdout_mask.sum()):>9}{y_band.mean():>8.1%}"
                f"{fmt(global_score):>8}{fmt(interaction_score):>10}{fmt(dedicated_score):>8}"
            )
            rows.append(
                {
                    "target": key,
                    "band": name,
                    "n": int(holdout_mask.sum()),
                    "positive_rate": float(y_band.mean()),
                    "global": global_score,
                    "interaction": interaction_score,
                    "dedicated": dedicated_score,
                }
            )

        overall_global = safe_auroc(y_holdout, global_probability)
        overall_interaction = safe_auroc(y_holdout, interaction_probability)
        print(
            f"{'전체':<8}{len(y_holdout):>9}{y_holdout.mean():>8.1%}{fmt(overall_global):>8}{fmt(overall_interaction):>10}"
        )

    return rows


# ---------------------------------------------------------------------------
# 2 + 3. operating
# ---------------------------------------------------------------------------


def expected_calibration_error(y: np.ndarray, p: np.ndarray, bins: int = 10) -> float:
    edges = np.quantile(p, np.linspace(0, 1, bins + 1))
    edges[0], edges[-1] = -np.inf, np.inf
    total = 0.0
    for lower, upper in zip(edges[:-1], edges[1:], strict=False):
        mask = (p > lower) & (p <= upper)
        if mask.sum() == 0:
            continue
        total += mask.sum() * abs(y[mask].mean() - p[mask].mean())
    return float(total / len(y))


def calibration_slope(y: np.ndarray, p: np.ndarray) -> tuple[float, float]:
    """Refit a logistic model on the logit of the prediction.

    Slope 1 / intercept 0 means perfectly calibrated. Slope below 1 means the
    predictions are too extreme.
    """
    clipped = np.clip(p, 1e-6, 1 - 1e-6)
    logit = np.log(clipped / (1 - clipped)).reshape(-1, 1)
    model = LogisticRegression(max_iter=1000).fit(logit, y)
    return float(model.coef_[0][0]), float(model.intercept_[0])


def threshold_table(y: np.ndarray, p: np.ndarray, flag_rates: list[float]) -> list[dict]:
    rows = []
    for rate in flag_rates:
        threshold = float(np.quantile(p, 1 - rate))
        flagged = p >= threshold
        true_positive = int((flagged & (y == 1)).sum())
        false_positive = int((flagged & (y == 0)).sum())
        false_negative = int((~flagged & (y == 1)).sum())
        true_negative = int((~flagged & (y == 0)).sum())
        sensitivity = true_positive / max(true_positive + false_negative, 1)
        specificity = true_negative / max(true_negative + false_positive, 1)
        precision = true_positive / max(true_positive + false_positive, 1)
        rows.append(
            {
                "flag_rate": rate,
                "threshold": threshold,
                "sensitivity": sensitivity,
                "specificity": specificity,
                "ppv": precision,
                "npv": true_negative / max(true_negative + false_negative, 1),
                "lift": precision / max(y.mean(), 1e-9),
            }
        )
    return rows


def experiment_operating(pooled: pd.DataFrame) -> list[dict]:
    print("\n" + "=" * 78)
    print("2+3. 보정과 운영점 — 확률을 화면에 띄울 수 있는가, 상위 몇 %를 알릴 것인가")
    print("=" * 78)
    rows = []

    for key, target in TARGETS.items():
        x_train, y_train, x_holdout, y_holdout = prepare(pooled, target)
        model = make_model("logistic", target, 1.0).fit(x_train, y_train)
        probability = model.predict_proba(x_holdout)[:, 1]
        y = y_holdout.to_numpy()

        # Isotonic recalibration fitted out-of-fold on the training cycles only.
        out_of_fold = np.zeros(len(y_train))
        for train_idx, valid_idx in cv_folds(y_train).split(x_train, y_train):
            fold = make_model("logistic", target, 1.0).fit(x_train.iloc[train_idx], y_train.iloc[train_idx])
            out_of_fold[valid_idx] = fold.predict_proba(x_train.iloc[valid_idx])[:, 1]
        isotonic = IsotonicRegression(out_of_bounds="clip").fit(out_of_fold, y_train)
        calibrated = isotonic.predict(probability)

        slope, intercept = calibration_slope(y, probability)
        print(f"\n--- {key}  (기저율 {y.mean():.2%})")
        print(
            f"  raw        Brier {brier_score_loss(y, probability):.4f}  "
            f"ECE {expected_calibration_error(y, probability):.4f}  "
            f"slope {slope:.2f}  intercept {intercept:+.2f}"
        )
        print(
            f"  isotonic   Brier {brier_score_loss(y, calibrated):.4f}  "
            f"ECE {expected_calibration_error(y, calibrated):.4f}  "
            f"AUROC {roc_auc_score(y, calibrated):.3f} (순위 불변)"
        )

        observed, predicted = calibration_curve(y, probability, n_bins=5, strategy="quantile")
        pairs = "  ".join(f"{q:.3f}->{o:.3f}" for q, o in zip(predicted, observed, strict=False))
        print(f"  신뢰도곡선 (예측->실제, 5분위)  {pairs}")

        print(f"  {'상위%':>6}{'임계값':>9}{'민감도':>8}{'특이도':>8}{'PPV':>8}{'lift':>7}")
        for row in threshold_table(y, probability, [0.05, 0.10, 0.20, 0.30]):
            print(
                f"  {row['flag_rate']:>6.0%}{row['threshold']:>9.3f}{row['sensitivity']:>8.1%}"
                f"{row['specificity']:>8.1%}{row['ppv']:>8.1%}{row['lift']:>7.2f}"
            )
            rows.append({"target": key, **row})

    return rows


# ---------------------------------------------------------------------------
# 4. tune
# ---------------------------------------------------------------------------

LOGISTIC_GRID = [{"model__C": c} for c in (0.01, 0.1, 1.0, 10.0)]
XGBOOST_GRID = [
    {"model__max_depth": depth, "model__min_child_weight": weight, "model__n_estimators": trees}
    for depth in (2, 3, 4)
    for weight in (10, 50)
    for trees in (200, 600)
]


def cv_auroc(model_name: str, target: Target, params: dict, x, y) -> float:
    scores = []
    for train_idx, valid_idx in cv_folds(y).split(x, y):
        model = make_model(model_name, target, 1.0)
        model.set_params(**params)
        model.fit(x.iloc[train_idx], y.iloc[train_idx])
        scores.append(roc_auc_score(y.iloc[valid_idx], model.predict_proba(x.iloc[valid_idx])[:, 1]))
    return float(np.mean(scores))


def experiment_tune(pooled: pd.DataFrame) -> list[dict]:
    print("\n" + "=" * 78)
    print("4. 튜닝 — 정규화와 하이퍼파라미터로 LR > XGB 결론이 뒤집히는가")
    print("=" * 78)
    rows = []

    for key, target in TARGETS.items():
        x_train, y_train, x_holdout, y_holdout = prepare(pooled, target)
        y = y_holdout.to_numpy()
        print(f"\n--- {key}")

        for name, grid in (("logistic", LOGISTIC_GRID), ("xgboost", XGBOOST_GRID)):
            scored = [(cv_auroc(name, target, params, x_train, y_train), params) for params in grid]
            best_cv, best_params = max(scored, key=lambda item: item[0])

            model = make_model(name, target, 1.0)
            model.set_params(**best_params)
            model.fit(x_train, y_train)
            probability = model.predict_proba(x_holdout)[:, 1]

            compact = {k.replace("model__", ""): v for k, v in best_params.items()}
            print(
                f"  {name:<9} best CV {best_cv:.3f}  holdout AUROC {roc_auc_score(y, probability):.3f}  "
                f"AUPRC {average_precision_score(y, probability):.3f}  {compact}"
            )
            rows.append(
                {
                    "target": key,
                    "model": name,
                    "best_params": compact,
                    "cv_auroc": best_cv,
                    "holdout_auroc": float(roc_auc_score(y, probability)),
                    "holdout_auprc": float(average_precision_score(y, probability)),
                }
            )

    return rows


# ---------------------------------------------------------------------------
# 5a. external
# ---------------------------------------------------------------------------

HARMONISED_NUMERIC = ["age", "bmi"]
HARMONISED_BINARY = ["smoking_never", "physical_activity_any"]


def harmonise_nhanes(pooled: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    frame = pd.DataFrame(index=pooled.index)
    frame["age"] = pd.to_numeric(pooled["age"], errors="coerce")
    frame["bmi"] = pd.to_numeric(pooled["bmi"], errors="coerce")
    frame["male"] = pooled["sex"].eq("M").astype(float)
    frame["smoking_never"] = pooled["smoking_status"].eq("never").astype(float)
    activity = pd.to_numeric(pooled["moderate_min_per_week"], errors="coerce").fillna(0) + pd.to_numeric(
        pooled["vigorous_min_per_week"], errors="coerce"
    ).fillna(0)
    frame["physical_activity_any"] = (activity > 0).astype(float)
    # Closest analogue to the UCI target, which is self-reported diabetes or prediabetes.
    label = (
        pooled["label_dm_prevalent"].astype("boolean").fillna(False)
        | pooled["label_prediabetes"].astype("boolean").fillna(False)
        | pooled["dx_prediabetes_told"].astype("boolean").fillna(False)
    )
    complete = frame.notna().all(axis=1)
    return frame[complete], label[complete].astype(int)


def harmonise_uci(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    out = pd.DataFrame(index=frame.index)
    out["age"] = pd.to_numeric(frame["age"], errors="coerce")
    out["bmi"] = pd.to_numeric(frame["bmi"], errors="coerce")
    out["male"] = frame["sex"].eq("M").astype(float)
    out["smoking_never"] = frame["smoking_status"].eq("never").astype(float)
    out["physical_activity_any"] = frame["physical_activity_any"].astype(float)
    label = frame["label_dm_prevalent"].astype("boolean").fillna(False).astype(int)
    complete = out.notna().all(axis=1)
    return out[complete], label[complete]


def experiment_external(pooled: pd.DataFrame) -> list[dict]:
    print("\n" + "=" * 78)
    print("5a. 외부 대조 — UCI 891 (BRFSS 2015, 253,680행)")
    print("=" * 78)

    uci_path = Path(__file__).resolve().parent / "data" / "processed" / "brfss_indicators.csv"
    if not uci_path.exists():
        print(f"  {uci_path} 없음. load_brfss_indicators.py 를 먼저 실행하세요.")
        return []

    uci = pd.read_csv(uci_path, low_memory=False)
    x_uci, y_uci = harmonise_uci(uci)
    x_nhanes, y_nhanes = harmonise_nhanes(pooled)
    print(f"  공통 변수 5개: {list(x_uci.columns)}")
    print(f"  NHANES n={len(x_nhanes)} 양성 {y_nhanes.mean():.2%}   UCI n={len(x_uci)} 양성 {y_uci.mean():.2%}")

    rng = np.random.default_rng(SEED)
    shuffled = rng.permutation(len(x_uci))
    cut = int(len(x_uci) * 0.7)
    uci_train, uci_test = shuffled[:cut], shuffled[cut:]

    rows = []

    def evaluate(name: str, model, x_test, y_test) -> None:
        probability = model.predict_proba(x_test)[:, 1]
        auroc = roc_auc_score(y_test, probability)
        auprc = average_precision_score(y_test, probability)
        print(f"  {name:<44} AUROC {auroc:.3f}  AUPRC {auprc:.3f} (기저 {np.mean(y_test):.3f})")
        rows.append({"setting": name, "auroc": float(auroc), "auprc": float(auprc)})

    internal = LogisticRegression(max_iter=2000, random_state=SEED).fit(x_uci.iloc[uci_train], y_uci.iloc[uci_train])
    evaluate("UCI 학습 -> UCI 시험 (내부)", internal, x_uci.iloc[uci_test], y_uci.iloc[uci_test])

    transfer = LogisticRegression(max_iter=2000, random_state=SEED).fit(x_nhanes, y_nhanes)
    evaluate("NHANES 학습 -> UCI 시험 (전이)", transfer, x_uci.iloc[uci_test], y_uci.iloc[uci_test])
    evaluate("NHANES 학습 -> NHANES (참고, 동일 데이터)", transfer, x_nhanes, y_nhanes)

    return rows


# ---------------------------------------------------------------------------
# 5b. tabpfn
# ---------------------------------------------------------------------------


def experiment_tabpfn(pooled: pd.DataFrame) -> list[dict]:
    print("\n" + "=" * 78)
    print("5b. 사전학습 표 모델 — TabPFN")
    print("=" * 78)
    try:
        from tabpfn import TabPFNClassifier
    except ImportError as exc:
        print(f"  TabPFN 미설치 ({exc}). `uv pip install tabpfn` 후 다시 실행하세요.")
        return []

    rows = []
    for key, target in TARGETS.items():
        x_train, y_train, x_holdout, y_holdout = prepare(pooled, target)

        # TabPFN takes a plain numeric matrix; encode the two categoricals by hand.
        def encode(frame: pd.DataFrame) -> np.ndarray:
            out = frame.copy()
            out["sex"] = out["sex"].astype(str).eq("M").astype(float)
            out["smoking_status"] = out["smoking_status"].astype(str).map({"never": 0.0, "former": 1.0, "current": 2.0})
            return out.astype(float).to_numpy()

        # TabPFN is in-context: cost scales with train x test. On CPU the library
        # refuses past 1,000 rows by default, so the training context is capped
        # deliberately rather than run for hours.
        limit = int(os.environ.get("TABPFN_CONTEXT", "3000"))
        if len(x_train) > limit:
            rng = np.random.default_rng(SEED)
            keep = rng.choice(len(x_train), limit, replace=False)
            x_fit, y_fit = x_train.iloc[keep], y_train.iloc[keep]
            note = f"train {len(x_train)} -> {limit} 서브샘플"
        else:
            x_fit, y_fit, note = x_train, y_train, f"train {len(x_train)}"

        model = TabPFNClassifier(
            device="cpu",
            random_state=SEED,
            n_estimators=4,
            ignore_pretraining_limits=True,
        )
        started = time.perf_counter()
        model.fit(encode(x_fit), y_fit.to_numpy())
        probability = model.predict_proba(encode(x_holdout))[:, 1]
        elapsed = time.perf_counter() - started

        y = y_holdout.to_numpy()
        auroc = roc_auc_score(y, probability)
        auprc = average_precision_score(y, probability)
        brier = brier_score_loss(y, probability)
        print(f"  {key:<18} AUROC {auroc:.3f}  AUPRC {auprc:.3f}  Brier {brier:.4f}   ({note}, {elapsed:.0f}s)")
        rows.append(
            {
                "target": key,
                "model": "tabpfn",
                "holdout_auroc": float(auroc),
                "holdout_auprc": float(auprc),
                "brier": float(brier),
                "seconds": round(elapsed, 1),
            }
        )

    return rows


# ---------------------------------------------------------------------------


EXPERIMENTS = {
    "age": experiment_age,
    "operating": experiment_operating,
    "tune": experiment_tune,
    "external": experiment_external,
    "tabpfn": experiment_tabpfn,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("which", nargs="?", default="all", choices=[*EXPERIMENTS, "all"])
    args = parser.parse_args()

    pooled = load()
    selected = list(EXPERIMENTS) if args.which == "all" else [args.which]

    output: dict[str, list[dict]] = {}
    for name in selected:
        output[name] = EXPERIMENTS[name](pooled)

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    destination = ARTIFACTS / f"experiments_{args.which}.json"
    destination.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
