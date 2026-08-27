"""Export the risk model as plain JSON the API can score without scikit-learn.

Shipping a pickled sklearn pipeline into the API image would drag scikit-learn,
numpy and pandas into a container that needs none of them, and would break the
moment the library version drifts. A logistic regression is a dot product, so
everything the API needs fits in a JSON file: the feature order, the median used
for each missing value, the standardisation constants, the one-hot categories and
the coefficients.

Two things beyond the coefficients travel in the bundle.

**Feature expansion.** ``app/services/risk.py:expand_features`` turns the raw
inputs into age bands, BMI bands and self-rated-health dummies. Training calls
that same function, so there is exactly one implementation — the "+bins" config
measured in ``refine.py``, which leaves AUROC flat but roughly halves the
calibration error. For a screen that shows a probability, that is the improvement
that matters.

**Single training source.** The serving model is fitted on NHANES rows only.
Pooling three sources with different variable coverage makes each column's
missingness pattern a near-perfect source label (see ``diagnose_serving.py``), so
a user answering an optional question moves their row between training
subpopulations and the prediction jumps for no clinical reason. The pooled table
stays useful for external validation; it is the wrong thing to serve from.

**No missingness indicators.** Training a serving model with them makes "you
skipped this question" a feature. NHANES collects the activity block from 99% of
respondents, so a blank answer reads as "one of the rare 1% who refused" and the
prediction lurches. Blank should mean "assume typical", which is exactly what a
median fill with no indicator does.

**Platt calibration.** Dropping the indicators cut the training set from 198k
rows to 17.5k, and hypertension calibration suffered for it (ECE 0.013 -> 0.034).
A two-parameter linear map on the logit, fitted out-of-fold, pulls it back
without touching the ranking. Two floats in the bundle.

**Peer reference table.** Predicted-probability quantiles per age band and sex.
Hypertension prevalence is 42%, so absolute probabilities cluster near 50% for
everyone and read as a coin flip when they actually mean "about average". The
percentile within a peer group is the number a user can act on.

    python modeling/export_model.py
    python modeling/export_model.py --out artifacts/models
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import bundle_io
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from splits import cv_folds
from train_risk import CATEGORICAL, DATA, TARGETS, make_pipeline, split_index

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services.risk import expand_features, peer_cell  # noqa: E402

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

# The serving feature set. Comorbidity history is left out on purpose: it lifts
# AUROC but is partly circular with a prevalence label, and a phone form should
# not be asking whether a doctor has diagnosed you with three other conditions.
# See docs/20_prediction_inputs_and_levers.md section 1.5.
SERVING_FEATURES = [
    # The four that carry 99.5% of the performance.
    "age",
    "sex",
    "bmi",
    "self_rated_health",
    # Optional, small additional lift, and the levers a challenge can move.
    "waist_cm",
    "smoking_status",
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

REQUIRED = ["age", "sex", "bmi", "self_rated_health"]

# Reference quantiles at 0, 5, ... 100 percent.
REFERENCE_STEPS = 21
# Fewer rows than this in a peer cell would make the percentile lookup noise.
MIN_CELL_ROWS = 200


def expanded_frame(raw: pd.DataFrame) -> pd.DataFrame:
    """Apply the shared expansion row by row.

    Slower than a vectorised version, and deliberately so: training and serving
    cannot drift when there is only one function.
    """
    records = [expand_features(record) for record in raw.to_dict(orient="records")]
    return pd.DataFrame(records, index=raw.index)


def fit_platt(frame: pd.DataFrame, y: pd.Series, numeric: list[str], categorical: list[str]) -> dict[str, float]:
    """Fit sigmoid(a * logit(p) + b) on out-of-fold predictions.

    Fitting on in-sample predictions would calibrate against the model's own
    optimism and leave the holdout no better off.
    """
    out_of_fold = np.zeros(len(y))
    for train_idx, valid_idx in cv_folds(y).split(frame, y):
        fold = make_pipeline(numeric, categorical, add_indicator=False).fit(frame.iloc[train_idx], y.iloc[train_idx])
        out_of_fold[valid_idx] = fold.predict_proba(frame.iloc[valid_idx])[:, 1]

    clipped = np.clip(out_of_fold, 1e-6, 1 - 1e-6)
    logit = np.log(clipped / (1 - clipped)).reshape(-1, 1)
    calibrator = LogisticRegression(max_iter=1000).fit(logit, y)
    return {"a": float(calibrator.coef_[0][0]), "b": float(calibrator.intercept_[0])}


def apply_platt(probability: np.ndarray, platt: dict[str, float]) -> np.ndarray:
    clipped = np.clip(probability, 1e-6, 1 - 1e-6)
    logit = np.log(clipped / (1 - clipped))
    return 1.0 / (1.0 + np.exp(-(platt["a"] * logit + platt["b"])))


def build(unified: pd.DataFrame, target: str, source: str = "nhanes_pooled") -> dict:
    blocked = set(TARGETS[target]["blocked"])
    columns = [c for c in SERVING_FEATURES if c not in blocked]

    label = unified[TARGETS[target]["label"]].astype("boolean")
    keep = label.notna()
    if source != "all":
        keep = keep & unified["source"].eq(source)
        # 출처가 하나면 결측 패턴이 출처를 가리킬 수 없다.
        columns = [c for c in columns if unified.loc[keep, c].notna().any()]
    raw = unified.loc[keep, columns].copy()
    for column in columns:
        if column not in CATEGORICAL:
            raw[column] = pd.to_numeric(raw[column], errors="coerce")
    # NaN을 None으로 바꿔야 expand_features가 "값 없음"으로 인식한다.
    raw = raw.astype(object).where(raw.notna(), None)
    y = label[keep].astype(int)

    frame = expanded_frame(raw)
    numeric = [c for c in frame.columns if c not in CATEGORICAL]
    categorical = [c for c in frame.columns if c in CATEGORICAL]
    for column in numeric:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    for column in categorical:
        frame[column] = frame[column].astype("object").fillna("__missing__").astype(str)

    train_index, holdout_index = split_index(unified, frame.index)
    pipeline = make_pipeline(numeric, categorical, add_indicator=False).fit(frame.loc[train_index], y.loc[train_index])

    holdout_probability = pipeline.predict_proba(frame.loc[holdout_index])[:, 1]
    nhanes_holdout = unified.loc[holdout_index, "source"].eq("nhanes_pooled").to_numpy()
    y_nhanes = y.loc[holdout_index][nhanes_holdout]
    p_nhanes = holdout_probability[nhanes_holdout]

    preprocess = pipeline.named_steps["preprocess"]
    numeric_pipeline = preprocess.named_transformers_["numeric"]
    imputer = numeric_pipeline.named_steps["impute"]
    scaler = numeric_pipeline.named_steps["scale"]
    encoder = preprocess.named_transformers_["categorical"]

    # 서빙 모델은 결측 지시자를 쓰지 않는다. 빈 칸은 '평균이라고 가정'이라는
    # 뜻이어야 하고, 그 이상을 뜻하면 응답 자체가 예측을 흔든다.
    indicator_features: list[str] = []

    platt = fit_platt(frame.loc[train_index], y.loc[train_index], numeric, categorical)
    p_nhanes = apply_platt(p_nhanes, platt)
    holdout_probability = apply_platt(holdout_probability, platt)

    coefficients = pipeline.named_steps["model"].coef_[0].tolist()
    names = list(preprocess.get_feature_names_out())
    if len(coefficients) != len(names):
        raise AssertionError(f"계수 {len(coefficients)}개와 이름 {len(names)}개가 맞지 않습니다")

    return {
        "target": target,
        "description": TARGETS[target]["description"],
        "label": TARGETS[target]["label"],
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": "logistic_regression",
        "expansion": "+bins",
        "train_source": source,
        "missing_indicators": False,
        "trained_rows": int(len(train_index)),
        "required_inputs": [c for c in REQUIRED if c in columns],
        "optional_inputs": [c for c in columns if c not in REQUIRED],
        "numeric_features": numeric,
        "categorical_features": categorical,
        # 결측 대치값과 표준화 상수. 순서가 numeric_features 와 1:1로 맞는다.
        "medians": [float(v) for v in imputer.statistics_],
        "scaler_mean": [float(v) for v in scaler.mean_],
        "scaler_scale": [float(v) for v in scaler.scale_],
        # 학습 시점에 결측이 있던 변수만 지시자를 갖는다.
        "indicator_features": indicator_features,
        # OneHotEncoder(drop="first") 라 첫 범주는 계수를 갖지 않는다.
        "categories": {
            column: [str(v) for v in values] for column, values in zip(categorical, encoder.categories_, strict=True)
        },
        "feature_names": names,
        "coefficients": coefficients,
        "intercept": float(pipeline.named_steps["model"].intercept_[0]),
        # 참조표가 있으면 등급은 백분위로 정한다. 아래는 참조 구간을 못 찾을 때의 대비책.
        "bands": {
            "moderate_above": float(np.quantile(p_nhanes, 0.70)),
            "high_above": float(np.quantile(p_nhanes, 0.90)),
        },
        "platt": platt,
        "reference": build_reference(unified, frame, pipeline, keep, platt),
        "reference_note": "NHANES 25,457명의 예측 확률 분포. 키는 '성별:연령구간', 값은 0~100% 21분위.",
        "holdout": {
            "cycle": "2021_2023",
            "auroc_all": float(roc_auc_score(y.loc[holdout_index], holdout_probability)),
            "auroc_nhanes": float(roc_auc_score(y_nhanes, p_nhanes)),
            "brier_nhanes": float(brier_score_loss(y_nhanes, p_nhanes)),
            "base_rate_nhanes": float(y_nhanes.mean()),
        },
        "limits": [
            "미국 인구(NHANES·BRFSS·Framingham)로 학습했으며 한국인 보정을 하지 않았다.",
            "단면 데이터 기반이라 발병 예측이 아니라 측정 기준 유병 여부 선별이다.",
            "임계값은 임상 검토를 받지 않았다.",
            "의료 진단이 아니며 재측정과 의료기관 상담 안내로만 사용한다.",
        ],
    }


def build_reference(
    unified: pd.DataFrame, frame: pd.DataFrame, pipeline, keep: pd.Series, platt: dict[str, float]
) -> dict[str, list[float]]:
    """Predicted-probability quantiles per age band and sex, on NHANES rows.

    NHANES is the only source with measured labels *and* the full variable set, so
    it is the honest reference population. Train and holdout rows are both
    included: this is a distribution, not a performance estimate.
    """
    nhanes = unified.loc[keep, "source"].eq("nhanes_pooled")
    subset = frame.loc[nhanes[nhanes].index]
    # 참조표도 보정 후 확률로 만든다. 서빙이 보정된 값을 내므로 같은 척도여야 한다.
    probability = apply_platt(pipeline.predict_proba(subset)[:, 1], platt)

    age = pd.to_numeric(unified.loc[subset.index, "age"], errors="coerce")
    sex = unified.loc[subset.index, "sex"].astype(str)
    cells = [peer_cell(a, s) if pd.notna(a) else None for a, s in zip(age, sex, strict=True)]

    grouped = pd.DataFrame({"cell": cells, "p": probability}).dropna(subset=["cell"])
    steps = np.linspace(0, 1, REFERENCE_STEPS)

    reference: dict[str, list[float]] = {}
    dropped = []
    for cell, group in grouped.groupby("cell"):
        if len(group) < MIN_CELL_ROWS:
            dropped.append((str(cell), len(group)))
            continue
        reference[str(cell)] = [round(float(v), 6) for v in np.quantile(group["p"], steps)]

    if dropped:
        print(f"    표본 부족으로 제외한 구간: {dropped}")
    return reference


def verify(bundle: dict, unified: pd.DataFrame) -> tuple[float, float]:
    """Re-score through the API's own scorer.

    Catches an export that reordered a coefficient or an expansion that drifted.
    Exact sklearn equivalence is asserted by the pytest suite.
    """
    from app.services.risk import RiskModel

    model = RiskModel(bundle)
    columns = bundle["required_inputs"] + bundle["optional_inputs"]
    sample = unified[columns].head(400)

    scored, percentiles = [], []
    for record in sample.to_dict(orient="records"):
        payload = {k: v for k, v in record.items() if pd.notna(v)}
        if "age" not in payload or "sex" not in payload:
            continue
        probability = model.probability(payload)
        scored.append(probability)
        percentile = model.peer_percentile(probability, float(payload["age"]), str(payload["sex"]))
        if percentile is not None:
            percentiles.append(percentile)

    return float(np.mean(scored)), float(np.mean(percentiles))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "models")
    parser.add_argument("--target", nargs="*", default=list(TARGETS))
    parser.add_argument(
        "--source",
        default="nhanes_pooled",
        help="학습에 쓸 출처. all 로 두면 통합 테이블 전체를 쓰지만 출처 누출이 생긴다.",
    )
    args = parser.parse_args()

    unified = pd.read_csv(args.data, low_memory=False)
    args.out.mkdir(parents=True, exist_ok=True)

    for target in args.target:
        bundle = build(unified, target, args.source)
        destination = args.out / f"risk_{target}.json"
        # 사후 주입된 `rule_anchor` 를 덮어쓰지 않는다 — 이유는 `bundle_io` 참조.
        carried = bundle_io.carry_over(destination, bundle)
        destination.write_text(json.dumps(bundle, indent=2, ensure_ascii=False), encoding="utf-8")
        if carried:
            print(f"  {destination.name}{bundle_io.note(carried)}")

        mean_probability, mean_percentile = verify(bundle, unified)
        print(
            f"{target:<6} [{bundle['train_source']}] 특징 {len(bundle['numeric_features'])}+{len(bundle['categorical_features'])}  "
            f"계수 {len(bundle['coefficients'])}  "
            f"AUROC {bundle['holdout']['auroc_nhanes']:.3f}  "
            f"Brier {bundle['holdout']['brier_nhanes']:.4f}  "
            f"참조구간 {len(bundle['reference'])}  "
            f"재현 확률 {mean_probability:.3f} / 백분위 {mean_percentile:.1f}  -> {destination.name}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
