"""온보딩이 묻는데 모델이 안 쓰는 입력 셋의 기여도를 짝지은 부트스트랩으로 잰다.

이 실험이 필요한 이유는 **기존 결론이 측정될 수 없는 조건에서 나왔기 때문**이다.

`21_modeling_overview.md` §7.3 은 가족력을 "성능 기여 +0.000" 으로 기각했다.
그런데 NHANES 는 `MCQ300A`/`MCQ300C`(가족력)를 2018 년 이후 주기에서 빼 버렸고,
모든 타깃의 홀드아웃은 `2021_2023` 이다. 즉 **평가 주기에 가족력이 한 행도 없다.**
학습에서 무엇을 배웠든 홀드아웃에서는 전부 결측 대치되므로 기여도는 구조적으로
0 이 나온다. `difficulty_walking`(PFQ, 2013-2018 만 존재)도 같은 처지인데 이쪽은
더 나쁘다 — 지금 `BASIC_FEATURES` 에 **들어가 있는 채로** 그렇다.

그래서 홀드아웃을 두 주기 다 살아 있는 `2017_2018` 로 옮겨서 다시 잰다.
비교는 언제나 같은 행 위에서 하고, 신뢰구간이 0 을 지나면 "구분 안 됨"으로 적는다.

    ../.venv/Scripts/python.exe experiment_features.py
    ../.venv/Scripts/python.exe experiment_features.py --target dm htn ckd --rounds 2000
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent / "data"))

from compare_tiers import paired_bootstrap
from splits import make_split
from targets import CATEGORICAL, DERIVED, NEW_INDICES, TARGETS, Target, enable_indices
from train_multi import DATA, build_frame, lab_present, make_pipeline, monotone_vector

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

# 가족력·보행곤란이 둘 다 살아 있는 마지막 주기. 2021_2023 을 홀드아웃으로 쓰면
# 이 실험은 아무것도 잴 수 없다.
HOLDOUT = "2017_2018"

# 온보딩 화면이 실제로 묻는데(`docs/planning/02_IA_화면목록.md` SCR-ONBD-02)
# 어느 tier 도 쓰지 않는 입력.
FAMILY_HISTORY = ("fh_diabetes", "fh_cvd")
# 기왕력. 타깃의 blocked 에 걸리면 자동으로 빠진다 — 당뇨 모델에서 dx_diabetes 는
# 라벨 누출이지만 신기능 모델에서는 KDIGO 가 첫 줄에 적는 위험인자다.
COMORBIDITY = ("dx_stroke", "dx_heart_disease", "dx_diabetes", "dx_hypertension")

# 폐경·체중변화·신장질환 문진. 가족력과 결정적으로 다른 점은 **여덟 주기 전부에
# 있다**는 것이다 — 운영 홀드아웃(2021_2023)을 그대로 두고 잴 수 있다.
MENOPAUSE = ("postmenopausal", "age_at_last_period")
WEIGHT_CHANGE = ("weight_change_1yr_pct",)
KIDNEY_DX = ("dx_kidney",)

# 임상 지수 묶음. 한 지수만 남기고 나머지 신규 지수를 전부 빼는 식으로 팔을 만든다.
INDEX_GROUPS: dict[str, tuple[str, ...]] = {
    "+인슐린저항성": ("tyg", "mets_ir"),
    "+지방간지수": ("fli",),
    "+내장지방": ("lap", "vai", "cmi"),
    "+체형(ABSI)": ("absi",),
    "+지질비": ("remnant_chol", "tc_hdl_ratio", "ldl_hdl_ratio"),
    "+혈압파생": ("pulse_pressure", "mean_arterial_pressure"),
    "+요산크레아티닌": ("uric_creatinine_ratio",),
}


def _index_arms() -> list[tuple[str, tuple[str, ...], tuple[str, ...]]]:
    """base 는 신규 지수를 통째로 빼고, 각 팔은 자기 묶음만 되살린다."""
    arms: list[tuple[str, tuple[str, ...], tuple[str, ...]]] = [("base", (), NEW_INDICES)]
    for name, keep in INDEX_GROUPS.items():
        arms.append((name, (), tuple(c for c in NEW_INDICES if c not in keep)))
    arms.append(("+전부", (), ()))
    return arms


# 프리셋마다 홀드아웃이 다른 이유는 재려는 변수가 어느 주기에 사는지가 다르기
# 때문이다. legacy 는 2018 년까지만 있는 변수를 재고, onboarding 은 전 주기에
# 있는 변수를 재므로 운영과 같은 홀드아웃을 쓴다.
PRESETS: dict[str, tuple[str, list[tuple[str, tuple[str, ...], tuple[str, ...]]]]] = {
    "legacy": (
        "2017_2018",
        [
            ("base", (), ()),
            ("−보행곤란", (), ("difficulty_walking",)),
            ("+가족력", FAMILY_HISTORY, ()),
            ("+기왕력", COMORBIDITY, ()),
            ("+가족력+기왕력", FAMILY_HISTORY + COMORBIDITY, ()),
            ("+둘−보행곤란", FAMILY_HISTORY + COMORBIDITY, ("difficulty_walking",)),
        ],
    ),
    "onboarding": (
        "2021_2023",
        [
            ("base", (), ()),
            ("−보행곤란", (), ("difficulty_walking",)),
            ("+폐경", MENOPAUSE, ()),
            ("+체중변화", WEIGHT_CHANGE, ()),
            ("+신장질환문진", KIDNEY_DX, ()),
            ("+기왕력", COMORBIDITY, ()),
            ("+전부", MENOPAUSE + WEIGHT_CHANGE + KIDNEY_DX + COMORBIDITY, ("difficulty_walking",)),
        ],
    ),
    # 임상 지수. 이 팔들은 새 입력을 요구하지 않는다 — 이미 받는 값을 다시 조합할 뿐이다.
    # base 가 신규 지수를 전부 빼야 비교가 성립하므로 drop 쪽에 NEW_INDICES 를 넣는다.
    "indices": ("2021_2023", _index_arms()),
}

# 이 프리셋을 쓸 때만 지수를 켠다. 기본 파이프라인은 26번 §8 에 따라 꺼진 채로 둔다.
enable_indices(*NEW_INDICES)
ADDED = FAMILY_HISTORY + COMORBIDITY + MENOPAUSE + WEIGHT_CHANGE + KIDNEY_DX

MIN_TRAIN_POSITIVES = 100
MIN_HOLDOUT_POSITIVES = 30


def arm_columns(target: Target, tier: str, add: tuple[str, ...], drop: tuple[str, ...]) -> list[str]:
    """이 팔이 쓸 컬럼. blocked 는 추가 요청이 있어도 절대 통과시키지 않는다."""
    blocked = set(target.blocked)
    columns = [c for c in target.features(tier) if c not in drop]
    for column in add:
        if column not in blocked and column not in columns:
            columns.append(column)
    return columns


def fit_arm(
    data: pd.DataFrame, target: Target, tier: str, model: str, columns: list[str], rows: pd.Index
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]] | None:
    subset = data.loc[rows]
    frame = build_frame(subset, columns)
    y = subset[target.label].astype("boolean").astype(int)

    cycle = subset["cycle"].astype(str)
    cycle.index = frame.index
    try:
        split = make_split(cycle, target.holdout_cycle)
    except ValueError:
        return None
    if int(y.loc[split.train_index].sum()) < MIN_TRAIN_POSITIVES:
        return None
    if int(y.loc[split.holdout_index].sum()) < MIN_HOLDOUT_POSITIVES:
        return None

    numeric = [c for c in columns if c not in CATEGORICAL]
    categorical = [c for c in columns if c in CATEGORICAL]
    monotone = monotone_vector(frame, numeric, categorical) if model == "xgboost" else None
    pipeline = make_pipeline(numeric, categorical, model, monotone).fit(
        frame.loc[split.train_index], y.loc[split.train_index]
    )
    probability = pipeline.predict_proba(frame.loc[split.holdout_index])[:, 1]
    meta = {
        "n_features": len(columns),
        "train_rows": int(len(split.train_index)),
        "train_positives": int(y.loc[split.train_index].sum()),
        "holdout_rows": int(len(split.holdout_index)),
        # 추가한 컬럼이 홀드아웃에서 실제로 채워져 있는지. 이 실험의 전제다.
        "added_coverage": {
            c: round(float(subset.loc[split.holdout_index, c].notna().mean()), 3)
            for c in columns
            if c in ADDED
        },
    }
    return y.loc[split.holdout_index].to_numpy(), probability, meta


def run_target(
    data: pd.DataFrame, target: Target, tier: str, model: str, rounds: int, arms: list[tuple[str, tuple[str, ...], tuple[str, ...]]]
) -> dict[str, Any] | None:
    lab_only = [c for c in target.features("lab") if c not in set(target.features("basic")) and c not in DERIVED]
    usable = data[target.label].astype("boolean").notna()
    if tier == "lab":
        usable = usable & lab_present(data, lab_only)
    rows = data.index[usable]
    if len(rows) < 1000:
        return None

    base_spec = next((a for a in arms if a[0] == "base"), None)
    if base_spec is None:
        return None
    base_columns = arm_columns(target, tier, base_spec[1], base_spec[2])

    scored: dict[str, tuple[np.ndarray, np.ndarray, dict[str, Any]]] = {}
    for name, add, drop in arms:
        columns = arm_columns(target, tier, add, drop)
        # 이 타깃에서 base 와 같은 열이 되는 팔은 돌리지 않는다. 지수 프리셋에서는
        # 흔한 일이다 — 대사증후군은 재료가 거의 다 blocked 라 살아남는 지수가 없다.
        if name != "base" and columns == base_columns:
            continue
        result = fit_arm(data, target, tier, model, columns, rows)
        if result is not None:
            scored[name] = result
    if "base" not in scored:
        return None

    y, base_probability, base_meta = scored["base"]
    from sklearn.metrics import roc_auc_score

    entry: dict[str, Any] = {
        "target": target.key,
        "name": target.name,
        "tier": tier,
        "model": model,
        "holdout_cycle": target.holdout_cycle,
        "base_auroc": round(float(roc_auc_score(y, base_probability)), 4),
        "base": base_meta,
        "arms": {},
    }
    for name, (_y, probability, meta) in scored.items():
        if name == "base":
            continue
        comparison = paired_bootstrap(y, base_probability, probability, rounds)
        comparison.update({"auroc": round(float(roc_auc_score(y, probability)), 4), **meta})
        entry["arms"][name] = comparison
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=[k for k, t in TARGETS.items() if t.serve])
    parser.add_argument("--tiers", nargs="*", default=["basic", "lab"])
    parser.add_argument("--models", nargs="*", default=["xgboost"])
    parser.add_argument("--preset", default="legacy", choices=sorted(PRESETS))
    parser.add_argument("--holdout", default=None, help="프리셋 기본 홀드아웃을 덮어쓴다")
    parser.add_argument("--rounds", type=int, default=1000)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    default_holdout, arms = PRESETS[args.preset]
    holdout = args.holdout or default_holdout
    out = args.out or ARTIFACTS / f"experiment_features_{args.preset}.json"

    data = pd.read_csv(args.data, low_memory=False)
    print(f"data: {args.data.name}  rows={len(data):,}  프리셋: {args.preset}  홀드아웃: {holdout}\n")

    results: list[dict[str, Any]] = []
    for key in args.target:
        target = replace(TARGETS[key], holdout_cycle=holdout)
        for tier in args.tiers:
            if tier not in target.tiers:
                continue
            for model in args.models:
                entry = run_target(data, target, tier, model, args.rounds, arms)
                if entry is None:
                    print(f"{target.name:<16}{tier:<7}{model:<10}건너뜀 (표본 부족)")
                    continue
                results.append(entry)
                print(f"{target.name:<16}{tier:<7}{model:<10}base={entry['base_auroc']:.4f}")
                for arm, value in entry["arms"].items():
                    mark = "*" if value["verdict"] == "유의" else " "
                    print(
                        f"    {arm:<18}{value['auroc']:.4f}  Δ{value['delta_auroc']:+.4f}"
                        f"  [{value['ci_low']:+.4f}, {value['ci_high']:+.4f}] {mark}"
                    )

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"preset": args.preset, "holdout": holdout, "results": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n→ {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
