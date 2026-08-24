"""현행 구성과 정밀형 구성을 같은 홀드아웃 행 위에서 짝지어 비교한다.

`train_multi.py` 의 표는 두 구성의 AUROC 를 나란히 보여 주지만 차이가 우연인지는
말해 주지 않는다. 그리고 이 저장소에는 그 함정에 한 번 빠진 기록이 있다 —
`BASELINE_REPORT.md` 가 "로지스틱이 XGBoost 를 6개 조합 전부에서 이겼다"고 적었고
`EXPERIMENTS_REPORT.md` 4장이 그걸 튜닝 문제로 뒤집었다.

그래서 판정은 **같은 사람들 위에서 두 모델을 동시에 채점한 뒤 홀드아웃을
재표집하는 짝지은 부트스트랩**으로 한다. 두 모델의 예측이 같은 행에 붙어 있으므로
표본 변동이 상쇄되고, 남는 것이 모델 차이다. 신뢰구간이 0 을 지나가면 "차이 없음"
이라고 적는다 — 평균이 양수라는 이유로 이겼다고 쓰지 않는다.

    ../.venv/Scripts/python.exe compare_tiers.py
    ../.venv/Scripts/python.exe compare_tiers.py --target dm htn --rounds 2000
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

from sklearn.metrics import roc_auc_score
from splits import SEED, make_split
from targets import CATEGORICAL, DERIVED, TARGETS, Target
from train_multi import DATA, build_frame, lab_present, make_pipeline, monotone_vector

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

# 비교 대상. (tier, model, 표기)
BASELINE = ("basic", "logistic", "현행 — 검사값 미사용 · 로지스틱")
CANDIDATE = ("lab", "xgboost", "정밀형 — 검사값 사용 · GBDT")
# 두 변화를 갈라 보기 위한 중간 구성.
MIDPOINTS = [
    ("lab", "logistic", "검사값만 추가 (모델 그대로)"),
    ("basic", "xgboost", "모델만 교체 (검사값 없이)"),
]


def fit_and_score(
    data: pd.DataFrame, target: Target, tier: str, model: str, rows: pd.Index
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """지정된 행 위에서 학습하고 홀드아웃 확률을 낸다.

    ``rows`` 를 밖에서 받는 이유는 모든 구성이 **같은 사람들**을 채점해야 하기
    때문이다. 구성마다 자기가 쓸 수 있는 행을 스스로 고르면 검사값을 쓰는 쪽이
    더 건강한 표본을 받게 되고, 그 차이가 성능 차이로 둔갑한다.
    """
    columns = target.features(tier)
    subset = data.loc[rows]
    frame = build_frame(subset, columns)
    y = subset[target.label].astype("boolean").astype(int)

    cycle = subset["cycle"].astype(str)
    cycle.index = frame.index
    split = make_split(cycle, target.holdout_cycle)

    numeric = [c for c in columns if c not in CATEGORICAL]
    categorical = [c for c in columns if c in CATEGORICAL]
    monotone = monotone_vector(frame, numeric, categorical) if model == "xgboost" else None
    pipeline = make_pipeline(numeric, categorical, model, monotone).fit(
        frame.loc[split.train_index], y.loc[split.train_index]
    )

    probability = pipeline.predict_proba(frame.loc[split.holdout_index])[:, 1]
    meta = {
        "tier": tier,
        "model": model,
        "n_features": len(columns),
        "train_rows": int(len(split.train_index)),
    }
    return y.loc[split.holdout_index].to_numpy(), probability, meta


def paired_bootstrap(y: np.ndarray, baseline: np.ndarray, candidate: np.ndarray, rounds: int) -> dict[str, float | str]:
    observed = roc_auc_score(y, candidate) - roc_auc_score(y, baseline)
    rng = np.random.default_rng(SEED)
    gaps = np.empty(rounds)
    drawn = 0
    for _round in range(rounds):
        picked = rng.integers(0, len(y), len(y))
        y_picked = y[picked]
        if len(np.unique(y_picked)) < 2:
            continue
        gaps[drawn] = roc_auc_score(y_picked, candidate[picked]) - roc_auc_score(y_picked, baseline[picked])
        drawn += 1
    gaps = gaps[:drawn]

    low, high = np.quantile(gaps, [0.025, 0.975])
    crossing = float(min((gaps <= 0).mean(), (gaps >= 0).mean()) * 2)
    return {
        "delta_auroc": round(float(observed), 4),
        "ci_low": round(float(low), 4),
        "ci_high": round(float(high), 4),
        "two_sided_crossing": round(crossing, 4),
        "verdict": "유의" if low > 0 or high < 0 else "구분 안 됨",
    }


def run(data: pd.DataFrame, target: Target, rounds: int) -> dict[str, Any] | None:
    lab_columns = [c for c in target.features("lab") if c not in set(target.features("basic")) and c not in DERIVED]
    # 검사값 보유자이면서 라벨이 있는 행. 모든 구성이 이 집합을 공유한다.
    rows = data.index[data[target.label].astype("boolean").notna() & lab_present(data, lab_columns)]
    if len(rows) < 2000:
        return None

    configurations = [BASELINE, CANDIDATE, *MIDPOINTS]
    scored: dict[tuple[str, str], np.ndarray] = {}
    y_holdout: np.ndarray | None = None
    metadata: dict[tuple[str, str], dict[str, Any]] = {}

    for tier, model, _ in configurations:
        if tier not in target.tiers:
            continue
        y_holdout, probability, meta = fit_and_score(data, target, tier, model, rows)
        scored[(tier, model)] = probability
        metadata[(tier, model)] = meta

    if y_holdout is None or int(y_holdout.sum()) < 30:
        return None

    base_key = BASELINE[:2]
    entry: dict[str, Any] = {
        "target": target.key,
        "name": target.name,
        "holdout_cycle": target.holdout_cycle,
        "holdout_rows": int(len(y_holdout)),
        "holdout_positives": int(y_holdout.sum()),
        "baseline": {
            "label": BASELINE[2],
            "auroc": round(float(roc_auc_score(y_holdout, scored[base_key])), 4),
            **metadata[base_key],
        },
        "comparisons": [],
    }

    print("=" * 100)
    print(f"{target.key} — {target.name}   홀드아웃 {len(y_holdout):,}행 / 양성 {int(y_holdout.sum()):,}")
    print(f"  기준: {BASELINE[2]}  AUROC {entry['baseline']['auroc']:.3f}")
    print("=" * 100)

    for tier, model, label in configurations:
        if (tier, model) == base_key or (tier, model) not in scored:
            continue
        result = paired_bootstrap(y_holdout, scored[base_key], scored[(tier, model)], rounds)
        auroc = round(float(roc_auc_score(y_holdout, scored[(tier, model)])), 4)
        entry["comparisons"].append({"label": label, "auroc": auroc, **metadata[(tier, model)], **result})
        print(
            f"  {label:<32} AUROC {auroc:.3f}   차이 {result['delta_auroc']:+.4f}  "
            f"95% CI [{result['ci_low']:+.4f}, {result['ci_high']:+.4f}]  {result['verdict']}"
        )
    print()
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=[t.key for t in TARGETS.values() if t.serve])
    parser.add_argument("--rounds", type=int, default=2000)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "tier_comparison.json")
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    print(f"data: {args.data.name}  rows={len(data)}  부트스트랩 {args.rounds}회\n")

    results = [entry for key in args.target if (entry := run(data, TARGETS[key], args.rounds))]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
