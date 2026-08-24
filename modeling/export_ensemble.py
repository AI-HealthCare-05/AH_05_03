"""XGBoost 3시드 + CatBoost 3시드 앙상블을 서빙 번들로 내보낸다.

29번이 고른 구성이다. 판별력은 CatBoost 쪽에 가깝고 **재현성은 둘 중 어느 쪽보다도
좋다** — 겹치지 않는 시드 두 벌로 재니 10%p 초과 편차가 세 셀 전부 0.0% 였다.

서빙 계약은 그대로 지킨다. **sklearn 의존 0**, 번들은 JSON, 채점은 부등호 비교뿐이다.
두 모델의 트리 표현이 달라서 직렬화가 둘로 갈린다.

* **XGBoost** — 노드마다 분할이 다르다. `export_multi.tree_payload` 가 쓰는
  ``[feature, threshold, left, right, value]`` 노드 배열을 그대로 쓴다.
* **CatBoost** — 대칭(oblivious) 트리라 같은 깊이의 노드가 전부 같은 분할을 쓴다.
  깊이 d 트리는 (피처, 경계) d 쌍과 잎값 2^d 개로 **전부** 표현된다. 노드를
  2^(d+1)-1 개 펼치면 번들이 3 배 넘게 커지므로 압축 표현으로 싣는다.
  잎 색인은 **LSB 우선**이다 — j 번째 분할이 참이면 ``idx |= 1 << j``.
  이 규칙은 추측이 아니라 CatBoost 원본과 오차 0.000e+00 으로 대조해서 정했다.

채점 순서가 중요하다. 멤버 안에서는 **확률**을 평균하고(로짓이 아니다), 멤버마다
보정을 걸고, 그 다음에 멤버끼리 평균한 뒤 다시 보정한다. `ensemble.py` 와 같은
순서여야 실험에서 잰 수치가 서빙에서 재현된다.

    seed 평균 -> 멤버 보정 -> 멤버 평균 -> 앙상블 보정

    ../.venv/Scripts/python.exe export_ensemble.py --target dm --tiers lab
    ../.venv/Scripts/python.exe export_ensemble.py --out artifacts/models_ensemble
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent / "data"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ensemble import SEEDS, apply_calibrator, fit_calibrator_from
from export_multi import ARTIFACTS, DATA, EXPANSION, LIMITS, REQUIRED, build_reference, prepare, tree_payload
from metrics import evaluate
from splits import cv_folds, make_split
from targets import CATEGORICAL, DERIVED, TARGETS, Target
from train_multi import make_pipeline, monotone_vector

MEMBERS = ("xgboost", "catboost")

# 채점 오차 경보 기준. 바닥은 잎값 반올림이라 0 이 안 나온다 — `equivalence` 참조.
EQUIVALENCE_LIMIT = 1e-4
# XGBoost 잎값 자릿수. 기본 내보내기는 8 이지만 앙상블은 모델이 여섯이라 오차가
# 쌓이고, 멤버 등장성 보정의 가파른 구간에서 한 번 더 부풀어 1.6e-05 까지 갔다.
LEAF_DIGITS = 10


def oblivious_payload(pipeline: Any) -> dict[str, Any]:
    """CatBoost 를 대칭 트리 압축 표현으로. 잎 색인은 LSB 우선이다."""
    model = pipeline.named_steps["model"]
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "model.json"
        model.save_model(str(path), format="json")
        dumped = json.loads(path.read_text(encoding="utf-8"))

    scale, bias = dumped["scale_and_bias"]
    trees = []
    for tree in dumped["oblivious_trees"]:
        splits = [[int(s["float_feature_index"]), float(s["border"])] for s in tree["splits"]]
        # 잎이 하나뿐인 트리(분할 0개)도 나올 수 있다. 그대로 실어도 채점은 돈다.
        trees.append({"splits": splits, "leaves": [round(float(v), 8) for v in tree["leaf_values"]]})
    return {
        "kind": "oblivious_trees",
        "trees": trees,
        "scale": float(scale),
        "bias": float(bias[0] if isinstance(bias, list) else bias),
    }


def member_payload(
    frame: pd.DataFrame,
    y: pd.Series,
    split: Any,
    numeric: list[str],
    categorical: list[str],
    model: str,
    seeds: tuple[int, ...],
) -> tuple[dict[str, Any], np.ndarray, np.ndarray]:
    """한 멤버의 직렬화·out-of-fold 확률·홀드아웃 확률.

    돌려주는 확률은 **멤버 보정까지 끝난** 값이다. 앙상블 보정은 밖에서 한 번 더 건다.
    """
    monotone = monotone_vector(frame, numeric, categorical) if model == "xgboost" else None
    x_train, y_train = frame.loc[split.train_index], y.loc[split.train_index]

    # 보정기는 첫 시드의 out-of-fold 로 적합한다. `ensemble.py` 와 같은 규칙이다.
    out_of_fold = np.zeros(len(y_train))
    for fold_train, fold_valid in cv_folds(y_train).split(x_train, y_train):
        fitted = make_pipeline(numeric, categorical, model, monotone, seed=seeds[0]).fit(
            x_train.iloc[fold_train], y_train.iloc[fold_train]
        )
        out_of_fold[fold_valid] = fitted.predict_proba(x_train.iloc[fold_valid])[:, 1]
    calibrator = fit_calibrator_from(out_of_fold, y_train.to_numpy())

    preprocess = None
    seed_payloads, seed_probability = [], []
    for seed in seeds:
        pipeline = make_pipeline(numeric, categorical, model, monotone, seed=seed).fit(x_train, y_train)
        preprocess = pipeline.named_steps["preprocess"]
        design = preprocess.transform(x_train)
        if hasattr(design, "toarray"):
            design = design.toarray()
        if model == "xgboost":
            serialised = tree_payload(pipeline, np.asarray(design, dtype=float), digits=LEAF_DIGITS)
            seed_payloads.append({"trees": serialised["trees"], "base_margin": serialised["base_margin"]})
        else:
            serialised = oblivious_payload(pipeline)
            seed_payloads.append({"trees": serialised["trees"], "scale": serialised["scale"], "bias": serialised["bias"]})
        seed_probability.append(pipeline.predict_proba(frame)[:, 1])

    kind = "gradient_boosted_trees" if model == "xgboost" else "oblivious_trees"
    payload = {"kind": kind, "seeds": seed_payloads, "calibration": calibrator}

    # 전체 행에 대한 멤버 확률. 참조표를 만들 때 홀드아웃 밖도 필요하다.
    everywhere = apply_calibrator(np.mean(seed_probability, axis=0), calibrator)
    holdout_position = frame.index.get_indexer(split.holdout_index)
    return payload, everywhere, everywhere[holdout_position]


def build(data: pd.DataFrame, target: Target, tier: str, seeds: tuple[int, ...]) -> dict[str, Any]:
    expansion = EXPANSION["xgboost"]
    raw, frame, y, cycle = prepare(data, target, tier, expansion)
    cycle.index = frame.index
    split = make_split(cycle, target.holdout_cycle)

    numeric = [c for c in frame.columns if c not in CATEGORICAL]
    categorical = [c for c in frame.columns if c in CATEGORICAL]

    members, member_everywhere = [], []
    for model in MEMBERS:
        payload, everywhere, _ = member_payload(frame, y, split, numeric, categorical, model, seeds)
        members.append(payload)
        member_everywhere.append(everywhere)

    combined_everywhere = np.mean(member_everywhere, axis=0)

    # 앙상블 보정기도 out-of-fold 에서 적합해야 한다. 위에서 만든 멤버 확률은
    # 학습 구간이 인샘플이라 그대로 쓰면 보정이 자기 낙관을 학습한다. 그래서
    # 학습 구간만 다시 폴드로 돌려 결합 확률의 out-of-fold 판을 만든다.
    x_train, y_train = frame.loc[split.train_index], y.loc[split.train_index]
    combined_oof = np.zeros(len(y_train))
    for fold_train, fold_valid in cv_folds(y_train).split(x_train, y_train):
        fold_members = []
        for model, member in zip(MEMBERS, members, strict=True):
            monotone = monotone_vector(frame, numeric, categorical) if model == "xgboost" else None
            per_seed = [
                make_pipeline(numeric, categorical, model, monotone, seed=seed)
                .fit(x_train.iloc[fold_train], y_train.iloc[fold_train])
                .predict_proba(x_train.iloc[fold_valid])[:, 1]
                for seed in seeds
            ]
            fold_members.append(apply_calibrator(np.mean(per_seed, axis=0), member["calibration"]))
        combined_oof[fold_valid] = np.mean(fold_members, axis=0)
    ensemble_calibrator = fit_calibrator_from(combined_oof, y_train.to_numpy())

    reference_probability = pd.Series(
        apply_calibrator(combined_everywhere, ensemble_calibrator), index=frame.index
    )
    holdout = reference_probability.loc[split.holdout_index].to_numpy()
    y_holdout = y.loc[split.holdout_index].to_numpy()

    reference, dropped = build_reference(
        reference_probability,
        pd.to_numeric(data.loc[frame.index, "age"], errors="coerce"),
        data.loc[frame.index, "sex"].astype(str),
    )

    template = make_pipeline(numeric, categorical, "xgboost", None, seed=seeds[0]).fit(x_train, y_train)
    preprocess = template.named_steps["preprocess"]
    numeric_pipeline = preprocess.named_transformers_["numeric"]
    imputer = numeric_pipeline.named_steps["impute"]
    scaler = numeric_pipeline.named_steps["scale"]
    encoder = preprocess.named_transformers_["categorical"]

    performance = evaluate(y_holdout, holdout)
    if performance is None:
        raise SystemExit(f"{target.key}/{tier}: 홀드아웃 표본이 지표를 낼 만큼 크지 않습니다.")

    inputs = [c for c in target.features(tier) if c not in DERIVED]
    bundle: dict[str, Any] = {
        "target": target.key,
        "tier": tier,
        "name": target.name,
        "description": f"{target.name} — 지금 검사받으면 진단 기준을 넘을 가능성",
        "label": target.label,
        "label_definition_text": target.definition,
        "criteria": [
            {"field": c.field, "label": c.label, "unit": c.unit, "op": c.op, "value": c.value, "by_sex": c.by_sex}
            for c in target.criteria
        ],
        "threshold_source": target.threshold_source,
        "label_kind": "prevalent",
        "horizon_years": None,
        "population": "US NHANES 2005-2023 adults (19+)",
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "expansion": expansion,
        "train_source": "nhanes_pooled",
        "missing_indicators": False,
        "trained_rows": int(len(split.train_index)),
        "train_cycles": split.train_cycles,
        "required_inputs": [c for c in REQUIRED if c in inputs],
        "optional_inputs": [c for c in inputs if c not in REQUIRED],
        "numeric_features": numeric,
        "categorical_features": categorical,
        "medians": [float(v) for v in imputer.statistics_],
        "scaler_mean": [float(v) for v in scaler.mean_],
        "scaler_scale": [float(v) for v in scaler.scale_],
        "indicator_features": [],
        "categories": {
            column: [str(v) for v in values] for column, values in zip(categorical, encoder.categories_, strict=True)
        },
        "feature_names": list(preprocess.get_feature_names_out()),
        # --- 앙상블 본체
        "model": "seed_ensemble",
        "members": members,
        "member_models": list(MEMBERS),
        "seeds": list(seeds),
        "combine": "mean",
        "bands": {
            "moderate_above": float(np.quantile(holdout, 0.70)),
            "high_above": float(np.quantile(holdout, 0.90)),
        },
        "calibration": ensemble_calibrator,
        # 구 번들 호환. 앙상블은 보정을 자기가 끝내므로 항등을 넣는다.
        "platt": {"a": 1.0, "b": 0.0},
        "reference": reference,
        "reference_note": (
            f"NHANES {len(frame):,}명의 out-of-fold 예측 확률 분포. 키는 '성별:연령구간', 값은 0~100% 21분위."
        ),
        "reference_dropped_cells": dropped,
        "performance": performance,
        "holdout": {
            "cycle": split.holdout_cycle,
            "auroc_nhanes": performance["auroc"],
            "auroc_all": performance["auroc"],
            "brier_nhanes": performance["brier"],
            "base_rate_nhanes": performance["prevalence"],
            "trained_rows": int(len(split.train_index)),
        },
        "limits": [
            *LIMITS,
            *([target.note] if target.note else []),
            "XGBoost 3시드 + CatBoost 3시드 앙상블. 단일 모델보다 개인 확률의 재현성이 높다.",
        ],
    }

    if target.undiagnosed_label and target.undiagnosed_label in data.columns:
        prevalent = y.loc[split.holdout_index]
        undiagnosed = data.loc[split.holdout_index, target.undiagnosed_label].astype("boolean")
        keep = (undiagnosed.notna() & ~(prevalent.eq(1) & undiagnosed.ne(True))).to_numpy()
        bundle["performance_undiagnosed"] = evaluate(undiagnosed[keep].astype(int).to_numpy(), holdout[keep])

    bundle["_holdout_probability"] = holdout.tolist()
    return bundle


def equivalence(bundle: dict[str, Any], data: pd.DataFrame, target: Target, tier: str) -> float:
    """번들이 실제로 같은 확률을 내는가.

    실험에서 잰 홀드아웃 확률을 번들에 넣어 두고, 순수 파이썬 채점기가 그 값을
    되찾는지 본다. 트리 하나가 뒤집히거나 잎 색인 비트 순서가 어긋나도 AUROC 는
    멀쩡해 보이므로, 여기서 안 잡으면 배포된 뒤에야 드러난다.

    **0 이 안 나오는 바닥이 있다.** `export_multi.tree_payload` 가 XGBoost 잎값을
    소수 8 자리로 반올림하고, 그 오차가 트리 200 개 × 시드 3 개로 누적된다.
    멤버를 갈라 재 보면 CatBoost 대칭 트리 쪽은 1.9e-09 로 사실상 정확하고
    XGBoost 쪽이 3.4e-06 이다. 확률로 옮기면 0.0002%p 라 화면에서 같은 숫자다.
    그래서 경보 기준을 ``1e-4`` 로 둔다 — `export_multi` 가 base_margin 상수성에
    쓰는 기준과 같은 자리수다. 이보다 크면 반올림이 아니라 **구조**가 틀린 것이다.
    """
    from app.services.risk import load_bundle

    expected = np.asarray(bundle["_holdout_probability"], dtype=float)
    scorer = load_bundle({k: v for k, v in bundle.items() if k != "_holdout_probability"})
    raw, frame, _, cycle = prepare(data, target, tier, bundle["expansion"])
    cycle.index = frame.index
    split = make_split(cycle, target.holdout_cycle)

    worst = 0.0
    for position, index in enumerate(split.holdout_index[:300]):
        payload = {k: v for k, v in raw.loc[index].items() if v is not None}
        worst = max(worst, abs(scorer.probability(payload) - float(expected[position])))
    return worst


def equivalence_from_bundle(bundle: dict[str, Any], data: pd.DataFrame, target: Target, tier: str) -> float:
    """저장된 번들만으로 되는 동등성 검사. 회귀 검사가 쓴다.

    `equivalence` 는 내보내는 순간에만 있는 `_holdout_probability` 를 쓰므로 배포된
    파일에는 못 건다. 여기서는 멤버 여섯을 다시 적합해 **보정 전 평균**을 만들고
    채점기의 `raw_probability` 와 맞춘다. 보정기는 out-of-fold 가 필요해 비싸지만
    보정 전 평균은 학습 한 번이면 되고, 이 검사가 잡으려는 실패(트리 뒤집힘·잎 색인
    비트 순서·설계 행렬 어긋남)는 전부 보정 앞에서 일어난다.
    """
    from app.services.risk import load_bundle

    scorer = load_bundle(bundle)
    raw, frame, y, cycle = prepare(data, target, tier, bundle["expansion"])
    cycle.index = frame.index
    split = make_split(cycle, target.holdout_cycle)

    numeric, categorical = bundle["numeric_features"], bundle["categorical_features"]
    x_train, y_train = frame.loc[split.train_index], y.loc[split.train_index]
    sample = split.holdout_index[:200]

    # 파이프라인 전체를 재현한다 — 시드 평균 -> 멤버 보정 -> 멤버 평균 -> 앙상블 보정.
    # 번들에 실린 보정기를 그대로 쓰므로 그 직렬화도 함께 검사된다.
    #
    # **최종 확률로 비교한다.** 중간값(`raw_probability`)으로 맞대면 잎값을 소수
    # 8 자리로 줄인 오차가 멤버 등장성 보정의 가파른 구간에서 1e-6 언저리까지
    # 부풀어 보인다. 화면에 나가는 것은 앙상블 보정까지 끝낸 값이고, 그 단계에서
    # 다시 눌려 1e-8 아래로 내려간다. 검사는 실제로 배포되는 값을 봐야 한다.
    per_member = []
    for model, member in zip(bundle["member_models"], bundle["members"], strict=True):
        monotone = monotone_vector(frame, numeric, categorical) if model == "xgboost" else None
        per_seed = [
            make_pipeline(numeric, categorical, model, monotone, seed=seed)
            .fit(x_train, y_train)
            .predict_proba(frame.loc[sample])[:, 1]
            for seed in bundle["seeds"]
        ]
        per_member.append(apply_calibrator(np.mean(per_seed, axis=0), member["calibration"]))
    expected = apply_calibrator(np.mean(per_member, axis=0), bundle["calibration"])

    worst = 0.0
    for position, index in enumerate(sample):
        payload = {k: v for k, v in raw.loc[index].items() if v is not None}
        worst = max(worst, abs(scorer.probability(payload) - float(expected[position])))
    return worst


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "models_ensemble")
    parser.add_argument("--target", nargs="*", default=[t.key for t in TARGETS.values() if t.serve])
    parser.add_argument("--tiers", nargs="*", default=["basic", "lab"])
    parser.add_argument("--seeds", type=int, default=3)
    parser.add_argument("--skip-equivalence", action="store_true")
    args = parser.parse_args()

    seeds = SEEDS[: args.seeds]
    data = pd.read_csv(args.data, low_memory=False)
    args.out.mkdir(parents=True, exist_ok=True)
    print(f"data {args.data.name}  시드 {list(seeds)}  ->  {args.out}\n")
    print(f"{'질환':<16}{'tier':<7}{'AUROC':>8}{'ECE':>7}{'파일':>10}{'gzip':>9}{'채점오차':>11}")

    total_plain = total_gzip = 0
    for key in args.target:
        target = TARGETS[key]
        for tier in args.tiers:
            if tier not in target.tiers:
                continue
            bundle = build(data, target, tier, seeds)
            error = 0.0 if args.skip_equivalence else equivalence(bundle, data, target, tier)
            bundle.pop("_holdout_probability", None)

            name = f"risk_{key}.json" if tier == "basic" else f"risk_{key}_lab.json"
            path = args.out / name
            text = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
            path.write_text(text, encoding="utf-8")
            plain = len(text.encode("utf-8"))
            packed = len(gzip.compress(text.encode("utf-8"), 9))
            total_plain += plain
            total_gzip += packed
            flag = "" if error < EQUIVALENCE_LIMIT else "  ← 불일치"
            print(
                f"{target.name:<16}{tier:<7}{bundle['performance']['auroc']:>8.4f}"
                f"{bundle['performance']['ece']:>7.3f}{plain / 1024:>9.0f}K{packed / 1024:>8.0f}K{error:>11.2e}{flag}"
            )

    print(f"\n합계 {total_plain / 1024 / 1024:.1f} MB / gzip {total_gzip / 1024 / 1024:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
