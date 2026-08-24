"""CatBoost 를 붙이면 이 데이터에서 실제로 얻는 게 있는가.

왜 애매한 질문인가
------------------
CatBoost 의 대표 강점 둘이 이 데이터에서는 대부분 무력화된다.

**범주형 처리(ordered target statistics).** 고유값이 많은 범주형에서 빛나는데,
우리 범주형은 ``sex``(2개)와 ``smoking_status``(3~4개) 둘뿐이다. 그 정도는
원핫이 이미 최적이라 CatBoost 가 더할 게 없다.

**ordered boosting.** 작은 표본의 target leakage 를 줄이는 장치다. 우리 타깃은
대부분 학습 3만 행대라 해당이 약하다. **다만 지방간은 4,376행**이고, 여기서는
효과가 있을 수 있다. 그래서 지방간을 반드시 포함해서 잰다.

그리고 서빙 쪽 사정이 하나 더 있다. 이 저장소는 sklearn 없이 JSON 만으로 채점한다.
XGBoost 는 노드 배열로 펴서 내보내고 있는데, CatBoost 는 **대칭(oblivious) 트리**라
같은 깊이에서 모든 노드가 같은 분기를 쓴다 — 직렬화가 오히려 더 단순하다. 그러니
서빙이 이유가 되어 CatBoost 를 배제할 근거는 없다. 순수하게 성능으로 판단하면 된다.

판정 기준은 서빙 선택 규칙과 같다 — 보정 게이트를 먼저 통과하고, 통과한 것끼리
AUPRC 리프트로 비교한다. 그리고 차이가 우연인지는 짝지은 부트스트랩으로 본다.

    ../.venv/Scripts/python.exe compare_catboost.py
    ../.venv/Scripts/python.exe compare_catboost.py --target dm fatty_liver --rounds 2000
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent / "data"))

from metrics import evaluate, selection_score  # noqa: E402
from sklearn.compose import ColumnTransformer  # noqa: E402
from sklearn.impute import SimpleImputer  # noqa: E402
from sklearn.metrics import roc_auc_score  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import OneHotEncoder, StandardScaler  # noqa: E402
from splits import SEED, make_split  # noqa: E402
from targets import CATEGORICAL, DERIVED, TARGETS  # noqa: E402
from train_multi import (  # noqa: E402
    DATA,
    apply_calibrator,
    build_frame,
    fit_calibrator,
    lab_present,
    make_pipeline,
    monotone_vector,
)

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

# 지방간이 이 실험의 핵심이다 — 학습 4,376행으로 유일하게 ordered boosting 이
# 효과를 낼 만한 표본 크기다. 나머지는 대조군.
DEFAULT_TARGETS = ["dm", "htn", "anemia", "ckd", "fatty_liver"]


def catboost_pipeline(numeric: list[str], categorical: list[str], monotone) -> Pipeline:
    from catboost import CatBoostClassifier

    # XGBoost 쪽과 같은 전처리를 통과시킨다. 다른 전처리를 쓰면 모델 차이가
    # 아니라 전처리 차이를 재게 된다. CatBoost 의 범주형 기능을 일부러 쓰지
    # 않는 이유도 같다 — 여기서 재려는 것은 부스팅 구현의 차이다.
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
                                    ("impute", SimpleImputer(strategy="median", add_indicator=False)),
                                    ("scale", StandardScaler()),
                                ]
                            ),
                            numeric,
                        ),
                        ("categorical", OneHotEncoder(handle_unknown="ignore", drop="first"), categorical),
                    ]
                ),
            ),
            (
                "model",
                CatBoostClassifier(
                    iterations=400,
                    depth=6,
                    learning_rate=0.05,
                    l2_leaf_reg=3.0,
                    random_seed=SEED,
                    verbose=0,
                    allow_writing_files=False,
                    # 주관적 건강 단조 제약. XGBoost 와 같은 계약을 걸어야
                    # 비교가 공정하다.
                    **({"monotone_constraints": list(monotone)} if monotone else {}),
                ),
            ),
        ]
    )


def paired_bootstrap(y: np.ndarray, base: np.ndarray, other: np.ndarray, rounds: int) -> dict[str, Any]:
    observed = roc_auc_score(y, other) - roc_auc_score(y, base)
    rng = np.random.default_rng(SEED)
    gaps = []
    for _round in range(rounds):
        picked = rng.integers(0, len(y), len(y))
        if len(np.unique(y[picked])) < 2:
            continue
        gaps.append(roc_auc_score(y[picked], other[picked]) - roc_auc_score(y[picked], base[picked]))
    low, high = np.quantile(gaps, [0.025, 0.975])
    return {
        "delta_auroc": round(float(observed), 4),
        "ci_low": round(float(low), 4),
        "ci_high": round(float(high), 4),
        "verdict": "유의" if low > 0 or high < 0 else "구분 안 됨",
    }


def run(data: pd.DataFrame, key: str, rounds: int) -> dict[str, Any] | None:
    target = TARGETS[key]
    columns = target.features("lab")
    basic = set(target.features("basic"))
    lab_columns = [c for c in columns if c not in basic and c not in DERIVED]

    label = data[target.label].astype("boolean")
    usable = label.notna() & lab_present(data, lab_columns)
    subset = data.loc[usable]
    frame = build_frame(subset, columns)
    y = label[usable].astype(int)

    cycle = subset["cycle"].astype(str)
    cycle.index = frame.index
    split = make_split(cycle, target.holdout_cycle)

    numeric = [c for c in columns if c not in CATEGORICAL]
    categorical = [c for c in columns if c in CATEGORICAL]
    monotone = monotone_vector(frame, numeric, categorical)
    y_holdout = y.loc[split.holdout_index].to_numpy()

    scored: dict[str, np.ndarray] = {}
    metrics: dict[str, Any] = {}
    for name, pipeline in (
        ("xgboost", make_pipeline(numeric, categorical, "xgboost", monotone)),
        ("catboost", catboost_pipeline(numeric, categorical, monotone)),
    ):
        fitted = pipeline.fit(frame.loc[split.train_index], y.loc[split.train_index])
        raw = fitted.predict_proba(frame.loc[split.holdout_index])[:, 1]
        model_kind = "xgboost" if name == "xgboost" else "catboost"
        calibrator = fit_calibrator(
            frame.loc[split.train_index], y.loc[split.train_index], numeric, categorical, model_kind, monotone
        )
        probability = apply_calibrator(raw, calibrator)
        scored[name] = probability
        evaluated = evaluate(y_holdout, probability)
        metrics[name] = {**evaluated, "gate": selection_score(evaluated), "calibration": calibrator["method"]}

    comparison = paired_bootstrap(y_holdout, scored["xgboost"], scored["catboost"], rounds)

    print("=" * 100)
    print(f"{target.key} — {target.name}   학습 {len(split.train_index):,}  홀드아웃 {len(y_holdout):,}")
    print("=" * 100)
    print(f"  {'모델':<11}{'AUROC':>8}{'AUPRC×':>8}{'Brier':>9}{'ECE':>8}{'기울기':>7}{'PPV@10%':>9}  게이트")
    for name in ("xgboost", "catboost"):
        m = metrics[name]
        top10 = m["operating_points"]["top_10pct"]
        print(
            f"  {name:<11}{m['auroc']:>8.3f}{m['auprc_lift']:>8.2f}{m['brier']:>9.4f}"
            f"{m['ece']:>8.4f}{m['calibration_slope']:>7.2f}{top10['ppv']:>9.3f}  "
            f"{'통과' if m['gate']['calibration_ok'] else '탈락'}"
        )
    print(
        f"  차이 {comparison['delta_auroc']:+.4f}  "
        f"95% CI [{comparison['ci_low']:+.4f}, {comparison['ci_high']:+.4f}]  {comparison['verdict']}"
    )
    print()
    return {
        "target": key,
        "name": target.name,
        "train_rows": int(len(split.train_index)),
        **comparison,
        "metrics": metrics,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=DEFAULT_TARGETS)
    parser.add_argument("--rounds", type=int, default=1000)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "catboost_comparison.json")
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    print(f"data {args.data.name}  타깃 {len(args.target)}개  부트스트랩 {args.rounds}회\n")

    rows = [r for key in args.target if (r := run(data, key, args.rounds))]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
