"""세 모델을 각각 시드 앙상블로 세우고 맞대결시킨다.

`ensemble.py` 는 모든 팔을 현행 XGBoost 단독과 비교했다. 이 파일은 질문이 다르다 —
**로지스틱·XGBoost·CatBoost 를 각각 시드 앙상블로 만들면 셋 중 누가 이기는가.**

먼저 정리할 것이 하나 있다. **시드를 바꾸는 것만으로는 로지스틱이 안 변한다.**
`LogisticRegression(solver="lbfgs")` 는 결정적이라 `random_state` 가 아무 데도
쓰이지 않는다. 그래서 시드 앙상블을 두 가지로 나눠 잰다.

* ``시드`` — `random_state` 만 바꾼다. 부스팅은 행·열 표집이 시드를 타므로 달라지고,
  로지스틱은 **한 글자도 안 달라진다.** 그 사실을 추측하지 않고 최대 편차로 찍어서
  확인한다.
* ``배깅`` — 시드마다 학습 행을 복원추출해서 다시 뽑는다. 결정적 학습기에도 다양성이
  생기므로 로지스틱에도 뜻이 있는 유일한 형태다.

두 번째가 이 비교를 성립시킨다. 배깅 없이 "로지스틱 시드 앙상블"을 표에 올리면
단일 로지스틱과 같은 숫자를 다른 이름으로 두 번 적는 셈이다.

그리고 **시드 앙상블이 얼마나 도울 수 있는지는 시드 간 분산이 미리 알려 준다.**
시드마다 AUROC 가 안 흔들리면 평균해도 줄일 것이 없다. 그 분산도 같이 잰다.

    ../.venv/Scripts/python.exe seed_ensemble.py
    ../.venv/Scripts/python.exe seed_ensemble.py --target dm ckd --seeds 5
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from itertools import combinations
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent / "data"))

from ensemble import SEEDS, apply_calibrator, fit_calibrator_from, paired_bootstrap
from metrics import evaluate, selection_score
from sklearn.metrics import roc_auc_score
from splits import cv_folds, make_split
from targets import CATEGORICAL, DERIVED, TARGETS, Target
from train_multi import DATA, MIN_EVAL_ROWS, MIN_POSITIVES, build_frame, lab_present, make_pipeline, monotone_vector

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
MODELS = ("logistic", "xgboost", "catboost")


def fit_variants(
    frame: pd.DataFrame,
    y: pd.Series,
    train_index: pd.Index,
    holdout_index: pd.Index,
    numeric: list[str],
    categorical: list[str],
    model: str,
    seeds: tuple[int, ...],
) -> dict[str, Any]:
    """단일·시드 앙상블·배깅 앙상블의 홀드아웃 예측과 시드별 예측.

    보정기는 첫 시드의 out-of-fold 예측 하나로 적합해 세 변형에 공통으로 쓴다.
    변형마다 따로 적합하면 보정 차이가 앙상블 효과로 둔갑한다.
    """
    x_train, y_train = frame.loc[train_index], y.loc[train_index]
    x_holdout = frame.loc[holdout_index]
    # `train_multi.run_one` 과 같은 규칙 — 단조 제약은 XGBoost 에만.
    monotone = monotone_vector(frame, numeric, categorical) if model == "xgboost" else None

    oof = np.zeros(len(y_train))
    for fold_train, fold_valid in cv_folds(y_train).split(x_train, y_train):
        fitted = make_pipeline(numeric, categorical, model, monotone, seed=seeds[0]).fit(
            x_train.iloc[fold_train], y_train.iloc[fold_train]
        )
        oof[fold_valid] = fitted.predict_proba(x_train.iloc[fold_valid])[:, 1]
    calibrator = fit_calibrator_from(oof, y_train.to_numpy())

    plain, bagged = [], []
    for seed in seeds:
        plain.append(
            make_pipeline(numeric, categorical, model, monotone, seed=seed)
            .fit(x_train, y_train)
            .predict_proba(x_holdout)[:, 1]
        )
        # 배깅 — 학습 행을 복원추출로 다시 뽑는다. 표본 크기는 그대로 둔다.
        rng = np.random.default_rng(seed)
        picked = rng.integers(0, len(x_train), len(x_train))
        bagged.append(
            make_pipeline(numeric, categorical, model, monotone, seed=seed)
            .fit(x_train.iloc[picked], y_train.iloc[picked])
            .predict_proba(x_holdout)[:, 1]
        )

    return {
        "calibrator": calibrator,
        "단일": apply_calibrator(plain[0], calibrator),
        "시드": apply_calibrator(np.mean(plain, axis=0), calibrator),
        "배깅": apply_calibrator(np.mean(bagged, axis=0), calibrator),
        "per_seed": [apply_calibrator(p, calibrator) for p in plain],
        # 시드를 바꿔도 예측이 안 변하는지. 로지스틱은 여기서 0 이 나와야 한다.
        "max_seed_deviation": float(np.max(np.abs(np.vstack(plain) - plain[0]))),
    }


def run_cell(data: pd.DataFrame, target: Target, tier: str, seeds: tuple[int, ...], rounds: int) -> dict[str, Any] | None:
    lab_only = [c for c in target.features("lab") if c not in set(target.features("basic")) and c not in DERIVED]
    label = data[target.label].astype("boolean")
    usable = label.notna()
    if tier == "lab":
        usable = usable & lab_present(data, lab_only)
    subset = data.loc[usable]
    if len(subset) < 1000:
        return None

    columns = target.features(tier)
    frame = build_frame(subset, columns)
    y = label[usable].astype(int)
    cycle = subset["cycle"].astype(str)
    cycle.index = frame.index
    try:
        split = make_split(cycle, target.holdout_cycle)
    except ValueError:
        return None
    if len(split.holdout_index) < MIN_EVAL_ROWS:
        return None

    numeric = [c for c in columns if c not in CATEGORICAL]
    categorical = [c for c in columns if c in CATEGORICAL]
    y_holdout = y.loc[split.holdout_index].to_numpy()

    variants = {
        model: fit_variants(frame, y, split.train_index, split.holdout_index, numeric, categorical, model, seeds)
        for model in MODELS
    }

    entry: dict[str, Any] = {
        "target": target.key,
        "name": target.name,
        "tier": tier,
        "train_rows": int(len(split.train_index)),
        "holdout_rows": int(len(split.holdout_index)),
        "seeds": list(seeds),
        "models": {},
    }

    for model, parts in variants.items():
        per_seed_auroc = [float(roc_auc_score(y_holdout, p)) for p in parts["per_seed"]]
        record: dict[str, Any] = {
            "calibration_method": parts["calibrator"]["method"],
            "max_seed_deviation": round(parts["max_seed_deviation"], 8),
            "seed_auroc": [round(v, 4) for v in per_seed_auroc],
            "seed_auroc_sd": round(statistics.pstdev(per_seed_auroc), 5) if len(per_seed_auroc) > 1 else 0.0,
            "variants": {},
        }
        for variant in ("단일", "시드", "배깅"):
            scores = evaluate(y_holdout, parts[variant], min_rows=MIN_EVAL_ROWS, min_positives=MIN_POSITIVES)
            if scores is None:
                continue
            selection = selection_score(scores)
            record["variants"][variant] = {
                "auroc": scores["auroc"],
                "auprc_lift": scores["auprc_lift"],
                "brier_skill": scores["brier_skill"],
                "ece": scores["ece"],
                "calibration_slope": scores["calibration_slope"],
                "calibration_ok": selection["calibration_ok"],
                "rejected_for": selection["rejected_for"],
                "rank_key": list(selection["rank_key"]),
            }
            if variant != "단일":
                record["variants"][variant].update(paired_bootstrap(y_holdout, parts["단일"], parts[variant], rounds))
        entry["models"][model] = record

    # 시드 앙상블끼리의 맞대결. 여기가 이 파일이 답하려는 질문이다.
    entry["head_to_head"] = {}
    for a, b in combinations(MODELS, 2):
        entry["head_to_head"][f"{a} vs {b}"] = paired_bootstrap(y_holdout, variants[b]["시드"], variants[a]["시드"], rounds)

    # 게이트를 통과한 것들 중 순위 1 위.
    ranked = {
        f"{model}/{variant}": record["variants"][variant]
        for model, record in entry["models"].items()
        for variant in record["variants"]
        if record["variants"][variant]["calibration_ok"]
    }
    if ranked:
        entry["selected"] = max(ranked, key=lambda k: tuple(ranked[k]["rank_key"]))
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=[k for k, t in TARGETS.items() if t.serve])
    parser.add_argument("--tiers", nargs="*", default=["basic", "lab"])
    parser.add_argument("--seeds", type=int, default=3)
    parser.add_argument("--rounds", type=int, default=500)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "seed_ensemble.json")
    args = parser.parse_args()

    seeds = SEEDS[: args.seeds]
    data = pd.read_csv(args.data, low_memory=False)
    print(f"data: {args.data.name}  시드 {len(seeds)}개 {list(seeds)}\n")

    results = []
    for key in args.target:
        for tier in args.tiers:
            if tier not in TARGETS[key].tiers:
                continue
            entry = run_cell(data, TARGETS[key], tier, seeds, args.rounds)
            if entry is None:
                print(f"{TARGETS[key].name:<16}{tier:<7}건너뜀")
                continue
            results.append(entry)
            print(f"{entry['name']} / {tier} — 학습 {entry['train_rows']:,} · 홀드 {entry['holdout_rows']:,}")
            print(f"  {'모델':<11}{'단일':>8}{'시드':>8}{'Δ':>9}{'배깅':>8}{'Δ':>9}{'시드SD':>9}{'최대편차':>10}")
            for model, record in entry["models"].items():
                cells = record["variants"]
                def show(variant: str) -> tuple[str, str]:
                    if variant not in cells:
                        return "  —", "  —"
                    v = cells[variant]
                    mark = "*" if v.get("verdict") == "유의" else " "
                    return f"{v['auroc']:.4f}", f"{v['delta_auroc']:+.4f}{mark}"
                seed_a, seed_d = show("시드")
                bag_a, bag_d = show("배깅")
                single = cells.get("단일", {}).get("auroc", float("nan"))
                print(
                    f"  {model:<11}{single:>8.4f}{seed_a:>8}{seed_d:>9}{bag_a:>8}{bag_d:>9}"
                    f"{record['seed_auroc_sd']:>9.5f}{record['max_seed_deviation']:>10.2e}"
                )
            for pair, result in entry["head_to_head"].items():
                mark = "*" if result["verdict"] == "유의" else " "
                print(f"    {pair:<26}{result['delta_auroc']:+.4f}{mark} [{result['ci_low']:+.4f}, {result['ci_high']:+.4f}]")
            print(f"  선택: {entry.get('selected', '없음')}\n")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"→ {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
