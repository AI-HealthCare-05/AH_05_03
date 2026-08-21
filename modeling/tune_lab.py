"""정밀형 tier 의 하이퍼파라미터를 다시 고른다.

왜 다시 골라야 하나
-------------------
지금 쓰는 설정(depth 3 · min_child_weight 50 · 트리 200)은 `EXPERIMENTS_REPORT.md`
4장에서 고른 값이고, 그때 특징은 **16개**였다. 정밀형은 32~35개다. 특징이 두 배로
늘면 담을 수 있는 상호작용의 깊이가 달라지는데 설정을 그대로 두면 그 여지를 쓰지
않는다. 반대로 무작정 깊게 하면 표본 대비 과적합이다 — 어느 쪽인지는 재야 안다.

같은 실수를 이 저장소가 이미 한 번 했다. `BASELINE_REPORT.md` 가 "로지스틱이
XGBoost 를 이겼다"고 적었는데, XGBoost 를 기본값으로 돌린 탓이었고 튜닝하니
뒤집혔다. 설정을 물려받아 쓰는 것도 같은 종류의 실수다.

무엇으로 고르나
---------------
AUROC 최대가 아니다. `metrics.py` 의 보정 게이트를 먼저 통과해야 하고, 통과한
것들 사이에서 AUPRC 리프트로 고른다 — 서빙 선택 규칙과 같은 기준이어야 튜닝
결과를 그대로 배포할 수 있다.

    ../.venv/Scripts/python.exe tune_lab.py
    ../.venv/Scripts/python.exe tune_lab.py --target dm ckd --out artifacts/tune_lab.json
"""

from __future__ import annotations

import argparse
import json
import sys
from itertools import product
from pathlib import Path
from typing import Any

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent / "data"))

from metrics import evaluate, selection_score  # noqa: E402
from sklearn.compose import ColumnTransformer  # noqa: E402
from sklearn.impute import SimpleImputer  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import OneHotEncoder, StandardScaler  # noqa: E402
from splits import SEED, make_split  # noqa: E402
from targets import CATEGORICAL, DERIVED, TARGETS  # noqa: E402
from train_multi import DATA, apply_calibrator, build_frame, fit_calibrator, lab_present, monotone_vector  # noqa: E402

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

# 현행 설정. 표에서 기준선으로 쓴다.
CURRENT = {"max_depth": 3, "min_child_weight": 50, "n_estimators": 200, "learning_rate": 0.05}

GRID = {
    "max_depth": [3, 4, 5, 6],
    "min_child_weight": [10, 25, 50],
    "n_estimators": [200, 400],
    "learning_rate": [0.05],
}

# 튜닝을 이 다섯에서만 돌린다. 성능 여지가 남아 있거나(빈혈·신기능) 제품에서
# 가장 중요한(당뇨·고혈압) 타깃이고, 열 개를 다 돌리면 격자가 폭발한다.
# 고른 설정은 마지막에 전체 타깃으로 검증한다.
DEFAULT_TARGETS = ["dm", "htn", "dlp", "ckd", "anemia"]


def build_pipeline(numeric, categorical, params, monotone):
    from xgboost import XGBClassifier

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
                XGBClassifier(
                    subsample=0.8,
                    colsample_bytree=0.8,
                    reg_lambda=1.0,
                    eval_metric="logloss",
                    random_state=SEED,
                    n_jobs=4,
                    **params,
                    **({"monotone_constraints": monotone} if monotone else {}),
                ),
            ),
        ]
    )


def run(data: pd.DataFrame, key: str, calibrate: bool) -> list[dict[str, Any]]:
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

    print("=" * 104)
    print(
        f"{target.key} — {target.name}   변수 {len(columns)}  학습 {len(split.train_index):,}  홀드아웃 {len(y_holdout):,}"
    )
    print("=" * 104)
    print(f"  {'depth':>6}{'mcw':>6}{'trees':>7}{'AUROC':>8}{'AUPRC×':>8}{'ECE':>8}{'기울기':>7}{'PPV@10%':>9}  게이트")

    rows = []
    for depth, mcw, trees, rate in product(
        GRID["max_depth"], GRID["min_child_weight"], GRID["n_estimators"], GRID["learning_rate"]
    ):
        params = {
            "max_depth": depth,
            "min_child_weight": mcw,
            "n_estimators": trees,
            "learning_rate": rate,
        }
        pipeline = build_pipeline(numeric, categorical, params, monotone).fit(
            frame.loc[split.train_index], y.loc[split.train_index]
        )
        raw = pipeline.predict_proba(frame.loc[split.holdout_index])[:, 1]

        # 보정까지 포함해야 서빙과 같은 기준이 된다. 다만 격자마다 5겹을 다시
        # 돌리면 시간이 다섯 배가 되므로, 격자 탐색에서는 끄고 마지막에만 켠다.
        if calibrate:
            calibrator = fit_calibrator(
                frame.loc[split.train_index], y.loc[split.train_index], numeric, categorical, "xgboost", monotone
            )
            probability = apply_calibrator(raw, calibrator)
        else:
            probability = raw

        scored = evaluate(y_holdout, probability)
        if scored is None:
            continue
        gate = selection_score(scored)
        entry = {"target": key, "name": target.name, **params, "calibrated": calibrate, **scored, "gate": gate}
        rows.append(entry)
        top10 = scored["operating_points"]["top_10pct"]
        mark = "통과" if gate["calibration_ok"] else "탈락"
        current = "  ← 현행" if params == CURRENT else ""
        print(
            f"  {depth:>6}{mcw:>6}{trees:>7}{scored['auroc']:>8.3f}{scored['auprc_lift']:>8.2f}"
            f"{scored['ece']:>8.4f}{scored['calibration_slope']:>7.2f}{top10['ppv']:>9.3f}  {mark}{current}"
        )

    passed = [r for r in rows if r["gate"]["calibration_ok"]] or rows
    best = max(passed, key=lambda r: (r["auprc_lift"], r["auroc"]))
    baseline = next((r for r in rows if all(r[k] == v for k, v in CURRENT.items())), None)
    print(
        f"\n  선택: depth {best['max_depth']} · mcw {best['min_child_weight']} · 트리 {best['n_estimators']}"
        + (
            f"   AUROC {baseline['auroc']:.3f} -> {best['auroc']:.3f} ({best['auroc'] - baseline['auroc']:+.3f})"
            if baseline
            else ""
        )
    )
    print()
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=DEFAULT_TARGETS)
    parser.add_argument("--calibrate", action="store_true", help="격자마다 보정까지 (5배 느리다)")
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "tune_lab.json")
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    combos = len(GRID["max_depth"]) * len(GRID["min_child_weight"]) * len(GRID["n_estimators"])
    print(f"data {args.data.name}  격자 {combos}개 × 타깃 {len(args.target)}개\n")

    rows: list[dict[str, Any]] = []
    for key in args.target:
        rows += run(data, key, args.calibrate)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
