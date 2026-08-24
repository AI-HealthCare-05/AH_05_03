"""앙상블의 서빙 비용 — 번들이 얼마나 커지고 채점이 얼마나 느려지는가.

성능 이득만 보고 앙상블을 고르면 안 된다. 이 저장소의 서빙은 **sklearn 의존 0** 이고
GBDT 를 노드 배열 JSON 으로 내보내 순수 파이썬으로 순회한다. 멤버가 셋이 되면
번들도 셋이 되고 채점도 세 번 돈다. 브라우저에서 도는 로컬 런타임
(`docs/11_local_model_runtime_implementation.md`)이라 그 비용이 사용자에게 그대로 간다.

그래서 이득(ΔAUROC)과 비용(바이트·밀리초)을 같은 표에 놓는다.

    ../.venv/Scripts/python.exe ensemble_cost.py --target dm ckd anemia
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent / "data"))

from splits import SEED, make_split
from targets import CATEGORICAL, DERIVED, TARGETS
from train_multi import DATA, build_frame, lab_present, make_pipeline, monotone_vector

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"


def tree_size(model: str, fitted: Any) -> dict[str, int]:
    """내보냈을 때 실을 **숫자 개수**. 노드 수가 아니라 이쪽이 번들 크기를 정한다.

    두 트리 모델의 구조가 달라서 노드로 세면 CatBoost 가 부당하게 커 보인다.

    * XGBoost 는 노드마다 분할이 다르다. 노드 하나에 (피처, 임계값, 왼쪽, 오른쪽,
      잎값) 다섯을 실어야 한다.
    * CatBoost 는 **대칭(oblivious) 트리**라 같은 깊이의 노드가 전부 같은 분할을
      쓴다. 깊이 d 인 트리는 (피처, 임계값) d 쌍과 잎값 2^d 개로 **전부** 표현된다.
      노드를 2^(d+1)-1 개 펼쳐 실을 이유가 없고, 채점도 순회가 아니라 비교 d 번 뒤
      색인 한 번이라 더 빠르다.

    이 구분을 안 하면 CatBoost 를 20 배 비싸다고 오판하게 된다.
    """
    estimator = fitted.steps[-1][1]
    if model == "xgboost":
        frame = estimator.get_booster().trees_to_dataframe()
        nodes = int(len(frame))
        return {"trees": int(frame["Tree"].nunique()), "nodes": nodes, "values": nodes * 5}
    if model == "catboost":
        depth = int(estimator.get_param("depth") or 6)
        trees = int(estimator.tree_count_)
        naive_nodes = trees * (2 ** (depth + 1) - 1)
        compact = trees * (2 * depth + 2**depth)
        return {"trees": trees, "nodes": naive_nodes, "values": compact}
    if model == "logistic":
        size = int(estimator.coef_.size + 1)
        return {"trees": 0, "nodes": size, "values": size}
    return {"trees": 0, "nodes": 0, "values": 0}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=["dm", "ckd", "anemia"])
    parser.add_argument("--tiers", nargs="*", default=["basic", "lab"])
    parser.add_argument("--seeds", type=int, default=3)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "ensemble_cost.json")
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    rows = []
    for key in args.target:
        target = TARGETS[key]
        for tier in args.tiers:
            if tier not in target.tiers:
                continue
            lab_only = [c for c in target.features("lab") if c not in set(target.features("basic")) and c not in DERIVED]
            label = data[target.label].astype("boolean")
            usable = label.notna()
            if tier == "lab":
                usable = usable & lab_present(data, lab_only)
            subset = data.loc[usable]
            columns = target.features(tier)
            frame = build_frame(subset, columns)
            y = label[usable].astype(int)
            cycle = subset["cycle"].astype(str)
            cycle.index = frame.index
            try:
                split = make_split(cycle, target.holdout_cycle)
            except ValueError:
                continue

            numeric = [c for c in columns if c not in CATEGORICAL]
            categorical = [c for c in columns if c in CATEGORICAL]
            monotone = monotone_vector(frame, numeric, categorical)
            x_train, y_train = frame.loc[split.train_index], y.loc[split.train_index]
            x_holdout = frame.loc[split.holdout_index]

            per_model = {}
            for model in ("logistic", "xgboost", "catboost"):
                mono = monotone if model in ("xgboost", "catboost") else None
                fitted = make_pipeline(numeric, categorical, model, mono, seed=SEED).fit(x_train, y_train)
                size = tree_size(model, fitted)
                start = time.perf_counter()
                for _ in range(3):
                    fitted.predict_proba(x_holdout)
                elapsed = (time.perf_counter() - start) / 3
                per_model[model] = {
                    **size,
                    # 한 사람 채점에 드는 시간. sklearn 경로라 순수 파이썬보다 훨씬
                    # 빠르지만, **상대 비교**에는 쓸 수 있다.
                    "ms_per_row": round(elapsed / len(x_holdout) * 1000, 5),
                }

            base_values = per_model["xgboost"]["values"]
            rows.append(
                {
                    "target": key,
                    "name": target.name,
                    "tier": tier,
                    "per_model": per_model,
                    "current_values": base_values,
                    # 시드 앙상블은 같은 모델을 N 번, 스태킹은 세 멤버를 한 번씩.
                    "seed_ensemble_values": base_values * args.seeds,
                    "stack_values": sum(per_model[m]["values"] for m in ("logistic", "xgboost", "catboost")),
                    "trees2_values": per_model["xgboost"]["values"] + per_model["catboost"]["values"],
                }
            )

    print("실을 숫자 개수 (CatBoost 는 대칭 트리 압축 표현 기준)")
    print(f"{'질환':<14}{'tier':<7}{'XGB':>8}{'CB':>8}{'LR':>5}{'시드x3':>9}{'트리2':>9}{'스태킹':>9}{'배수':>7}")
    for row in rows:
        multiple = row["stack_values"] / max(row["current_values"], 1)
        print(
            f"{row['name']:<14}{row['tier']:<7}{row['per_model']['xgboost']['values']:>8,}"
            f"{row['per_model']['catboost']['values']:>8,}{row['per_model']['logistic']['values']:>5}"
            f"{row['seed_ensemble_values']:>9,}{row['trees2_values']:>9,}{row['stack_values']:>9,}{multiple:>6.1f}x"
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n현재 배포 번들 전체 2.4MB, risk_dm.json 131KB 기준으로 환산하면 배수를 그대로 곱하면 된다.")
    print(f"→ {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
