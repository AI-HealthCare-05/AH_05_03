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

**어디서 고르나 — 이게 더 중요하다.**
`--select holdout` 은 격자 24 개를 홀드아웃에서 전부 채점하고 최고를 고른다.
진단용으로는 쓸모가 있지만 **그렇게 고른 숫자를 성능으로 보고하면 안 된다** —
시험지를 보고 답을 고른 것이라 배포 성능보다 높게 나온다. 24 번 고르면 우연히
좋아 보이는 설정이 하나쯤 나오기 마련이다.

`--select validation`(기본값) 은 학습 주기의 **마지막 주기를 검증으로 떼어** 거기서
고르고, 홀드아웃은 고른 뒤 한 번만 본다. 무작위 CV 가 아니라 시간 순인 이유는
배포가 그렇게 일어나기 때문이다 — 과거 주기로 배워서 다음 주기를 맞힌다.
현행 설정도 같은 방식으로 한 번 재서 나란히 놓고, 차이는 짝지은 부트스트랩으로 본다.

    ../.venv/Scripts/python.exe tune_lab.py
    ../.venv/Scripts/python.exe tune_lab.py --target dm anemia --tiers lab basic
    ../.venv/Scripts/python.exe tune_lab.py --select holdout   # 진단용 전수 스캔
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

from compare_tiers import paired_bootstrap  # noqa: E402
from metrics import evaluate, selection_score  # noqa: E402
from splits import make_split  # noqa: E402
from targets import CATEGORICAL, DERIVED, TARGETS  # noqa: E402
from train_multi import (  # noqa: E402
    DATA,
    apply_calibrator,
    build_frame,
    fit_calibrator,
    lab_present,
    make_pipeline,
    monotone_vector,
)  # noqa: E402

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
    """`train_multi.make_pipeline` 에 위임한다.

    예전에는 전처리 블록(중앙값 대치 → 표준화 → 원핫)을 여기 복사해 갖고 있었다.
    복사본은 학습 경로가 바뀌어도 안 따라가므로, 여기서 고른 하이퍼파라미터가 실제
    배포되는 파이프라인의 것이라는 보장이 사라진다. 한 곳에서만 만든다.
    """
    return make_pipeline(numeric, categorical, "xgboost", monotone, params=params)


def prepare(data: pd.DataFrame, key: str, tier: str):
    """(frame, y, split, numeric, categorical, monotone). 두 선택 경로가 같이 쓴다."""
    target = TARGETS[key]
    columns = target.features(tier)
    basic = set(target.features("basic"))
    lab_columns = [c for c in target.features("lab") if c not in basic and c not in DERIVED]

    label = data[target.label].astype("boolean")
    usable = label.notna()
    if tier == "lab":
        usable = usable & lab_present(data, lab_columns)
    subset = data.loc[usable]
    frame = build_frame(subset, columns)
    y = label[usable].astype(int)

    cycle = subset["cycle"].astype(str)
    cycle.index = frame.index
    split = make_split(cycle, target.holdout_cycle)

    numeric = [c for c in columns if c not in CATEGORICAL]
    categorical = [c for c in columns if c in CATEGORICAL]
    monotone = monotone_vector(frame, numeric, categorical, key)
    return frame, y, split, cycle, numeric, categorical, monotone, columns


def grid_points() -> list[dict[str, Any]]:
    return [
        {"max_depth": d, "min_child_weight": m, "n_estimators": n, "learning_rate": r}
        for d, m, n, r in product(
            GRID["max_depth"], GRID["min_child_weight"], GRID["n_estimators"], GRID["learning_rate"]
        )
    ]


def score_config(frame, y, train_index, score_index, numeric, categorical, monotone, params):
    """한 설정을 fit 하고 채점한다. 보정은 걸지 않는다 — 선택은 순위·리프트로 한다."""
    pipeline = build_pipeline(numeric, categorical, params, monotone).fit(frame.loc[train_index], y.loc[train_index])
    probability = pipeline.predict_proba(frame.loc[score_index])[:, 1]
    return probability, evaluate(y.loc[score_index].to_numpy(), probability)


def pick(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """서빙 선택 규칙과 같다 — 보정 게이트 먼저, 통과한 것들 사이에서 AUPRC 리프트."""
    passed = [r for r in rows if r["gate"]["calibration_ok"]] or rows
    return max(passed, key=lambda r: (r["auprc_lift"], r["auroc"]))


def run_validation(data: pd.DataFrame, key: str, tier: str, rounds: int) -> dict[str, Any] | None:
    """검증 주기에서 고르고 홀드아웃은 한 번만 본다."""
    target = TARGETS[key]
    frame, y, split, cycle, numeric, categorical, monotone, columns = prepare(data, key, tier)
    train_cycles = sorted(split.train_cycles)
    if len(train_cycles) < 3:
        return None
    validation_cycle = train_cycles[-1]
    inner_train = frame.index[cycle.isin(train_cycles[:-1]).to_numpy()]
    inner_valid = frame.index[cycle.eq(validation_cycle).to_numpy()]
    if int(y.loc[inner_valid].sum()) < 30 or int(y.loc[inner_train].sum()) < 100:
        return None

    picked_rows = []
    for params in grid_points():
        _, scored = score_config(frame, y, inner_train, inner_valid, numeric, categorical, monotone, params)
        if scored is None:
            continue
        picked_rows.append({**params, **scored, "gate": selection_score(scored)})
    if not picked_rows:
        return None
    chosen = pick(picked_rows)
    chosen_params = {k: chosen[k] for k in ("max_depth", "min_child_weight", "n_estimators", "learning_rate")}

    # 여기서부터가 홀드아웃이다. 두 설정을 한 번씩만 본다.
    y_holdout = y.loc[split.holdout_index].to_numpy()
    p_chosen, s_chosen = score_config(
        frame, y, split.train_index, split.holdout_index, numeric, categorical, monotone, chosen_params
    )
    p_current, s_current = score_config(
        frame, y, split.train_index, split.holdout_index, numeric, categorical, monotone, CURRENT
    )
    comparison = paired_bootstrap(y_holdout, p_current, p_chosen, rounds)

    entry = {
        "target": key,
        "name": target.name,
        "tier": tier,
        "select": "validation",
        "validation_cycle": validation_cycle,
        "holdout_cycle": target.holdout_cycle,
        "n_features": len(columns),
        "grid": len(picked_rows),
        "chosen": chosen_params,
        "chosen_validation_auroc": round(chosen["auroc"], 4),
        "current": CURRENT,
        "holdout_auroc_current": round(s_current["auroc"], 4),
        "holdout_auroc_chosen": round(s_chosen["auroc"], 4),
        "holdout_ece_current": round(s_current["ece"], 4),
        "holdout_ece_chosen": round(s_chosen["ece"], 4),
        "gate_chosen": selection_score(s_chosen),
        **{f"delta_{k}": v for k, v in comparison.items()},
    }
    same = chosen_params == CURRENT
    print(
        f"  {target.name:<10}{tier:<7}검증 {validation_cycle}  선택 d{chosen_params['max_depth']}"
        f"/mcw{chosen_params['min_child_weight']}/n{chosen_params['n_estimators']}"
        + ("  (현행과 같음)" if same else "")
        + f"   홀드아웃 {s_current['auroc']:.4f} -> {s_chosen['auroc']:.4f} "
        f"({comparison['delta_auroc']:+.4f}, {comparison['verdict']})"
    )
    return entry


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
    monotone = monotone_vector(frame, numeric, categorical, key)
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
    parser.add_argument("--select", default="validation", choices=("validation", "holdout"))
    parser.add_argument("--tiers", nargs="*", default=["lab"])
    parser.add_argument("--rounds", type=int, default=1000)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    combos = len(GRID["max_depth"]) * len(GRID["min_child_weight"]) * len(GRID["n_estimators"])
    default_out = ARTIFACTS / ("tune_lab.json" if args.select == "holdout" else "tune_validation.json")
    out = args.out or default_out
    print(f"data {args.data.name}  격자 {combos}개  선택 {args.select}  타깃 {len(args.target)}개\n")

    rows: list[dict[str, Any]] = []
    if args.select == "validation":
        for key in args.target:
            for tier in args.tiers:
                if tier not in TARGETS[key].tiers:
                    continue
                entry = run_validation(data, key, tier, args.rounds)
                if entry is not None:
                    rows.append(entry)
    else:
        for key in args.target:
            rows += run(data, key, args.calibrate)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
