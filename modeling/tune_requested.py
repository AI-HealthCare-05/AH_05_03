"""요청받은 하이퍼파라미터를 현행과 맞대결시킨다 — 학습률 0.01 · 라운드 40 · 조기중단 5.

왜 이 파일이 따로 있나
----------------------
`tune_lab.py` 는 격자를 훑어 **고르는** 도구다. 여기서 할 일은 다르다. 지정된 설정
하나가 현행보다 나은지 아닌지를 같은 잣대로 재서 숫자로 답하는 것이다.

먼저 알아 둘 것 — 이 스택에 신경망이 없다
------------------------------------------
`epoch` 는 부스팅 라운드(`n_estimators`)에 대응한다. 그런데 부스팅에서 학습률과
라운드 수는 **곱으로 움직인다**. 대략의 학습 총량은 `n_estimators × learning_rate` 다.

    현행      200 × 0.05 = 10.0
    요청       40 × 0.01 =  0.4      ← 25 배 작다

그래서 요청 설정을 그대로 넣으면 과소적합이 거의 확실하다. 그것을 말로 주장하는
대신 **세 설정을 같이 돌려 표로 놓는다.**

    current     depth 3 · mcw 50 · n 200 · lr 0.05            지금 배포된 것
    requested   depth 3 · mcw 50 · n  40 · lr 0.01 · es 5     요청 그대로
    matched     depth 3 · mcw 50 · n 1000 · lr 0.01 · es 5    학습률만 낮추고 라운드로 보상

`matched` 를 같이 두는 이유는 "학습률 0.01 이 나쁜가" 와 "라운드 40 이 모자란가" 를
갈라 보기 위해서다. 둘을 한 칸에 섞으면 어느 쪽이 원인인지 알 수 없다.

조기중단은 어디서 보나
----------------------
XGBoost 의 `early_stopping_rounds` 는 평가셋이 있어야 동작한다. 홀드아웃을 평가셋으로
쓰면 시험지를 보고 멈추는 것이라 **학습 주기의 마지막 주기**를 떼어 쓴다 —
`tune_lab.run_validation` 이 설정을 고를 때 쓰는 것과 같은 분할이다.

전처리기를 두 번 fit 한다(평가셋을 변환하려고 한 번, 파이프라인 안에서 한 번).
같은 데이터에 같은 변환기라 결과가 같고, 이렇게 해야 `make_pipeline` 의 전처리
블록을 복사하지 않아도 된다 — 복사본은 한쪽만 고쳐진다(`tune_lab.build_pipeline` 주석).

    ../.venv/Scripts/python.exe tune_requested.py
    ../.venv/Scripts/python.exe tune_requested.py --target dm dlp --tiers lab
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent / "data"))

from compare_tiers import paired_bootstrap  # noqa: E402
from metrics import evaluate, selection_score  # noqa: E402
from targets import TARGETS  # noqa: E402
from train_multi import DATA  # noqa: E402
from tune_lab import CURRENT, DEFAULT_TARGETS, build_pipeline, prepare  # noqa: E402

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

REQUESTED = {"max_depth": 3, "min_child_weight": 50, "n_estimators": 40, "learning_rate": 0.01}
MATCHED = {"max_depth": 3, "min_child_weight": 50, "n_estimators": 1000, "learning_rate": 0.01}
EARLY_STOPPING_ROUNDS = 5


def fit_and_score(
    frame,
    y,
    train_index,
    score_index,
    numeric,
    categorical,
    monotone,
    params: dict[str, Any],
    *,
    early_stop: tuple[Any, Any] | None = None,
):
    """한 설정을 fit 하고 채점한다. `early_stop` 이 있으면 조기중단을 건다."""
    extra = dict(params)
    fit_kwargs: dict[str, Any] = {}
    if early_stop is not None:
        extra["early_stopping_rounds"] = EARLY_STOPPING_ROUNDS

    pipeline = build_pipeline(numeric, categorical, extra, monotone)

    if early_stop is not None:
        eval_frame, eval_y = early_stop
        # 전처리기만 먼저 맞춰 평가셋을 같은 공간으로 옮긴다. 아래 `fit` 이 다시
        # 맞추지만 같은 학습 데이터라 같은 변환이 나온다.
        pre = pipeline.named_steps["preprocess"]
        pre.fit(frame.loc[train_index])
        fit_kwargs["model__eval_set"] = [(pre.transform(eval_frame), eval_y)]
        fit_kwargs["model__verbose"] = False

    pipeline.fit(frame.loc[train_index], y.loc[train_index], **fit_kwargs)
    probability = pipeline.predict_proba(frame.loc[score_index])[:, 1]
    booster = pipeline.named_steps["model"]
    used = getattr(booster, "best_iteration", None)
    return probability, evaluate(y.loc[score_index].to_numpy(), probability), used


def run_target(data: pd.DataFrame, key: str, tier: str, rounds: int) -> dict[str, Any] | None:
    frame, y, split, cycle, numeric, categorical, monotone, _ = prepare(data, key, tier)
    train_cycles = sorted(split.train_cycles)
    if len(train_cycles) < 3:
        return None

    # 조기중단이 볼 검증 주기. 홀드아웃이 아니다.
    validation_cycle = train_cycles[-1]
    inner_train = frame.index[cycle.isin(train_cycles[:-1]).to_numpy()]
    inner_valid = frame.index[cycle.eq(validation_cycle).to_numpy()]
    if int(y.loc[inner_valid].sum()) < 30:
        return None
    early = (frame.loc[inner_valid], y.loc[inner_valid].to_numpy())

    y_holdout = y.loc[split.holdout_index].to_numpy()
    runs: dict[str, dict[str, Any]] = {}
    probabilities: dict[str, Any] = {}

    plans = [
        ("current", CURRENT, None),
        ("requested", REQUESTED, early),
        ("matched", MATCHED, early),
    ]
    for label, params, early_stop in plans:
        # 조기중단을 쓰는 설정은 검증 주기를 학습에서 뺀다. 안 빼면 멈출 시점을
        # 학습에 쓴 데이터로 정하게 되어 멈추지 않는다.
        train_index = inner_train if early_stop is not None else split.train_index
        probability, scored, used = fit_and_score(
            frame, y, train_index, split.holdout_index, numeric, categorical, monotone, params, early_stop=early_stop
        )
        if scored is None:
            continue
        runs[label] = {
            **params,
            "early_stopping_rounds": EARLY_STOPPING_ROUNDS if early_stop is not None else None,
            "trees_used": None if used is None else int(used) + 1,
            "train_rows": int(len(train_index)),
            "auroc": scored["auroc"],
            "auprc": scored["auprc"],
            "auprc_lift": scored["auprc_lift"],
            "ece": scored["ece"],
            "brier": scored["brier"],
            "calibration_slope": scored["calibration_slope"],
            "gate": selection_score(scored),
        }
        probabilities[label] = probability

    if "current" not in runs:
        return None

    comparisons = {
        label: paired_bootstrap(y_holdout, probabilities["current"], probabilities[label], rounds)
        for label in ("requested", "matched")
        if label in probabilities
    }

    return {
        "target": key,
        "name": TARGETS[key].name,
        "tier": tier,
        "holdout_rows": int(len(y_holdout)),
        "holdout_positives": int(y_holdout.sum()),
        "validation_cycle": validation_cycle,
        "runs": runs,
        "vs_current": comparisons,
    }


def show(entry: dict[str, Any]) -> None:
    print("=" * 108)
    print(
        f"{entry['name']} · {entry['tier']}  홀드아웃 {entry['holdout_rows']:,}행 / 양성 {entry['holdout_positives']:,}"
    )
    print("=" * 108)
    print(f"  {'설정':<12}{'트리':>7}{'lr':>7}{'실제쓴':>8}{'AUROC':>9}{'AUPRC×':>9}{'ECE':>8}{'보정':>6}  현행 대비")
    for label in ("current", "requested", "matched"):
        run = entry["runs"].get(label)
        if run is None:
            continue
        delta = ""
        if label in entry["vs_current"]:
            cmp = entry["vs_current"][label]
            delta = f"{cmp['delta_auroc']:+.4f}  CI [{cmp['ci_low']:+.4f}, {cmp['ci_high']:+.4f}]  {cmp['verdict']}"
        print(
            f"  {label:<12}{run['n_estimators']:>7}{run['learning_rate']:>7}"
            f"{(run['trees_used'] or run['n_estimators']):>8}"
            f"{run['auroc']:>9.4f}{run['auprc_lift']:>9.2f}{run['ece']:>8.4f}"
            f"{('통과' if run['gate']['calibration_ok'] else '탈락'):>6}  {delta}"
        )
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=DEFAULT_TARGETS)
    parser.add_argument("--tiers", nargs="*", default=["lab"])
    parser.add_argument("--rounds", type=int, default=2000)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "tune_requested.json")
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    print(f"data: {args.data.name}  rows={len(data):,}\n")

    results = []
    for key in args.target:
        for tier in args.tiers:
            if tier not in TARGETS[key].tiers:
                continue
            entry = run_target(data, key, tier, args.rounds)
            if entry is None:
                print(f"{key} · {tier} 건너뜀 (표본 부족)\n")
                continue
            show(entry)
            results.append(entry)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
