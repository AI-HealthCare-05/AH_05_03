"""앙상블 — 모델 셋과 시드 여럿을 섞으면 실제로 나아지는가.

두 종류를 나눠서 잰다.

**시드 앙상블.** 같은 모델을 시드만 바꿔 여러 번 학습하고 평균한다. 얻는 것은
새 정보가 아니라 **분산 감소**다. 부스팅은 행·열 표집(`subsample` 0.8,
`colsample_bytree` 0.8)이 들어 있어 시드마다 다른 모델이 나오고, 그 흔들림이
홀드아웃 성능의 일부를 차지한다. 로지스틱은 결정적이라 시드 앙상블이 항등이다 —
그것도 확인해서 적는다.

**모델 앙상블.** 로지스틱·XGBoost·CatBoost 를 섞는다. 셋을 고른 이유는 실패
방식이 다르기 때문이다. 로지스틱은 선형이라 편향이 크고, XGBoost 는 수준별
분할, CatBoost 는 대칭(oblivious) 트리에 순서형 부스팅을 쓴다.
`compare_catboost.py` 가 이미 CatBoost 가 당뇨 +0.0053 · 빈혈 +0.0096 로
유의하게 앞선다고 적어 뒀으므로, 두 트리 모델의 강점 자체가 다르다.

**보정을 어디서 하느냐가 이 파일의 핵심이다.** 이 저장소는 AUROC 로 모델을 고르지
않는다(`metrics.selection_score`). 확률이 틀리면 화면의 백분위·등급·경보가 전부
틀리므로 **보정 게이트를 먼저 통과해야 한다.** 그런데 잘 보정된 확률 여럿을
평균하면 결과는 중앙으로 몰려 **덜 날카로워진다** — 보정 기울기가 1 을 넘어가고
게이트에서 떨어진다. 그래서 순서를 이렇게 둔다.

    멤버별 out-of-fold 예측 -> 멤버별 보정 -> 결합 -> 결합값에 보정기를 다시 적합

마지막 단계가 없으면 앙상블은 판별력이 올라도 게이트에서 탈락한다.

    ../.venv/Scripts/python.exe ensemble.py
    ../.venv/Scripts/python.exe ensemble.py --target dm ckd --seeds 5
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

from metrics import evaluate, expected_calibration_error, selection_score
from scipy.stats import rankdata
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from splits import SEED, cv_folds, make_split
from targets import CATEGORICAL, DERIVED, TARGETS, Target
from train_multi import (
    DATA,
    MIN_EVAL_ROWS,
    MIN_POSITIVES,
    _logit,
    build_frame,
    lab_present,
    make_pipeline,
    monotone_for,
)

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

# 시드는 고정 목록에서 뽑는다. 무작위로 만들면 재현이 안 된다.
SEEDS = (SEED, SEED + 101, SEED + 202, SEED + 303, SEED + 404)

MEMBERS = ("logistic", "xgboost", "catboost")
# 시드를 바꿔도 같은 답이 나오는 모델. 시드 앙상블을 돌리지 않는다.
DETERMINISTIC = {"logistic"}


# ---------------------------------------------------------------------------
# 보정
# ---------------------------------------------------------------------------


def fit_calibrator_from(predicted: np.ndarray, target: np.ndarray) -> dict[str, Any]:
    """`train_multi.fit_calibrator` 와 같은 규칙인데 예측을 밖에서 받는다.

    앙상블은 멤버를 이미 적합해 뒀으므로 파이프라인을 다시 돌릴 이유가 없다.
    Platt·isotonic·무보정 셋을 두고 out-of-fold ECE 가 낮은 쪽을 고른다.
    """
    logit = _logit(predicted)
    platt = LogisticRegression(max_iter=1000).fit(logit.reshape(-1, 1), target)
    platt_out = 1.0 / (1.0 + np.exp(-(platt.coef_[0][0] * logit + platt.intercept_[0])))

    isotonic = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(predicted, target)

    # 반올림이 중복점을 만든다. 1e-6 보다 가까운 두 임계값은 같은 x 로 접히는데,
    # 그 지점에서 `np.interp`(학습)와 이분탐색(서빙 순수 파이썬)이 서로 다른 y 를
    # 고른다. 확률로 1e-5 쯤 어긋나고 AUROC 로는 절대 안 보인다. 그래서 여기서
    # **엄격 증가**로 접어 두고 양쪽이 같은 표를 보게 한다. 겹친 x 는 마지막 y 를
    # 남긴다 — 등장성 회귀는 계단이라 그 지점의 값이 오른쪽 층이다.
    thresholds_x, thresholds_y = [], []
    for x_value, y_value in zip(isotonic.X_thresholds_, isotonic.y_thresholds_, strict=True):
        rounded_x = round(float(x_value), 6)
        if thresholds_x and rounded_x <= thresholds_x[-1]:
            thresholds_y[-1] = round(float(y_value), 6)
            continue
        thresholds_x.append(rounded_x)
        thresholds_y.append(round(float(y_value), 6))

    candidates = {
        "platt": (
            expected_calibration_error(target, platt_out)[0],
            {"a": float(platt.coef_[0][0]), "b": float(platt.intercept_[0])},
        ),
        "isotonic": (
            expected_calibration_error(target, isotonic.predict(predicted))[0],
            {"x": thresholds_x, "y": thresholds_y},
        ),
        "none": (expected_calibration_error(target, predicted)[0], {}),
    }
    chosen = min(candidates, key=lambda name: candidates[name][0])
    return {"method": chosen, "parameters": candidates[chosen][1]}


def apply_calibrator(probability: np.ndarray, calibrator: dict[str, Any]) -> np.ndarray:
    method, parameters = calibrator["method"], calibrator["parameters"]
    if method == "platt":
        return 1.0 / (1.0 + np.exp(-(parameters["a"] * _logit(probability) + parameters["b"])))
    if method == "isotonic":
        return np.interp(probability, parameters["x"], parameters["y"])
    return probability


# ---------------------------------------------------------------------------
# 멤버 학습
# ---------------------------------------------------------------------------


def member_predictions(
    frame: pd.DataFrame,
    y: pd.Series,
    train_index: pd.Index,
    holdout_index: pd.Index,
    numeric: list[str],
    categorical: list[str],
    model: str,
    seeds: tuple[int, ...],
    target_key: str,
) -> tuple[np.ndarray, np.ndarray, dict[str, np.ndarray]]:
    """한 모델의 out-of-fold(학습 구간)와 홀드아웃 예측.

    시드마다 따로 내고 평균한 것을 함께 돌려준다. 개별 시드도 남기는 이유는
    "시드 앙상블이 단일 시드보다 나은가"를 재려면 둘 다 필요하기 때문이다.
    """
    x_train, y_train = frame.loc[train_index], y.loc[train_index]
    x_holdout = frame.loc[holdout_index]
    # 단조 제약을 **두 멤버 모두에** 건다. 원래는 XGBoost 에만 걸었다 — `train_multi.run_one`
    # 과 `compare_catboost.py` 의 비교가 그 조건이었고, 한쪽만 바꾸면 그 근거들과 나란히
    # 놓을 수 없었다. 같은 주석에 "서빙으로 옮길 때는 다시 봐야 한다"고 적어 뒀고 지금이
    # 그 시점이다.
    #
    # 이유는 성능이 아니라 계약이다. 번들은 XGBoost 3 시드와 CatBoost 3 시드의 평균이다.
    # 절반에만 제약을 걸면 평균에서 제약이 희석된다 — 맥압·평균동맥압을 파생으로 갈아 끼운
    # 뒤에도 `dm_lab` 의 혈압 단조 위반이 1 건 남은 것이 그 결과였다. 방향을 제품 계약으로
    # 삼기로 했으면 두 멤버가 같은 계약을 지켜야 한다.
    #
    # 28·29번 문서의 비교 수치는 CatBoost 무제약 조건에서 나왔다. 이 줄을 바꾼 뒤의
    # 성능은 그 표와 직접 비교하지 않는다.
    monotone = monotone_for(model, frame, numeric, categorical, target_key)

    # out-of-fold 는 **첫 시드로만** 낸다. 보정기는 두 모수짜리 사상이라 시드
    # 평균된 예측으로 적합하나 단일 시드로 적합하나 차이가 없는데, 폴드 수만큼
    # 곱해지는 비용은 그대로 시드 배수로 늘어난다.
    oof = np.zeros(len(y_train))
    for fold_train, fold_valid in cv_folds(y_train).split(x_train, y_train):
        fitted = make_pipeline(numeric, categorical, model, monotone, seed=seeds[0]).fit(
            x_train.iloc[fold_train], y_train.iloc[fold_train]
        )
        oof[fold_valid] = fitted.predict_proba(x_train.iloc[fold_valid])[:, 1]

    per_seed_holdout = []
    for seed in seeds:
        full = make_pipeline(numeric, categorical, model, monotone, seed=seed).fit(x_train, y_train)
        per_seed_holdout.append(full.predict_proba(x_holdout)[:, 1])

    singles = {"oof": oof, "holdout": per_seed_holdout[0]}
    return oof, np.mean(per_seed_holdout, axis=0), singles


# ---------------------------------------------------------------------------
# 결합 규칙
# ---------------------------------------------------------------------------


def combine(parts: list[np.ndarray], rule: str) -> np.ndarray:
    stacked = np.vstack(parts)
    if rule == "mean":
        return stacked.mean(axis=0)
    if rule == "logit":
        return 1.0 / (1.0 + np.exp(-np.vstack([_logit(p) for p in parts]).mean(axis=0)))
    if rule == "rank":
        # 순위 평균은 확률의 뜻을 없앤다. 뒤에 보정기를 다시 붙이므로 성립한다.
        ranked = np.vstack([rankdata(p) / len(p) for p in parts]).mean(axis=0)
        return np.clip(ranked, 1e-6, 1 - 1e-6)
    raise ValueError(rule)


def paired_bootstrap(y: np.ndarray, baseline: np.ndarray, candidate: np.ndarray, rounds: int) -> dict[str, Any]:
    observed = roc_auc_score(y, candidate) - roc_auc_score(y, baseline)
    rng = np.random.default_rng(SEED)
    gaps = []
    for _ in range(rounds):
        picked = rng.integers(0, len(y), len(y))
        if len(np.unique(y[picked])) < 2:
            continue
        gaps.append(roc_auc_score(y[picked], candidate[picked]) - roc_auc_score(y[picked], baseline[picked]))
    gaps = np.asarray(gaps)
    low, high = np.quantile(gaps, [0.025, 0.975])
    return {
        "delta_auroc": round(float(observed), 4),
        "ci_low": round(float(low), 4),
        "ci_high": round(float(high), 4),
        "verdict": "유의" if low > 0 or high < 0 else "구분 안 됨",
    }


# ---------------------------------------------------------------------------
# 실행
# ---------------------------------------------------------------------------


def run_cell(  # noqa: C901
    data: pd.DataFrame, target: Target, tier: str, seeds: tuple[int, ...], rounds: int
) -> dict[str, Any] | None:
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
    if len(split.holdout_index) < MIN_EVAL_ROWS or len(split.train_index) < 500:
        return None

    numeric = [c for c in columns if c not in CATEGORICAL]
    categorical = [c for c in columns if c in CATEGORICAL]
    y_train = y.loc[split.train_index].to_numpy()
    y_holdout = y.loc[split.holdout_index].to_numpy()

    # 멤버마다 시드 앙상블과 단일 시드를 둘 다 만든다.
    members: dict[str, dict[str, np.ndarray]] = {}
    for model in MEMBERS:
        model_seeds = (seeds[0],) if model in DETERMINISTIC else seeds
        oof, holdout, singles = member_predictions(
            frame, y, split.train_index, split.holdout_index, numeric, categorical, model, model_seeds, target.key
        )
        members[model] = {"oof": oof, "holdout": holdout, "oof1": singles["oof"], "holdout1": singles["holdout"]}

    def scored(oof_raw: np.ndarray, holdout_raw: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
        """out-of-fold 로 보정기를 적합하고 홀드아웃에 적용한다."""
        calibrator = fit_calibrator_from(oof_raw, y_train)
        return apply_calibrator(holdout_raw, calibrator), calibrator

    arms: dict[str, dict[str, Any]] = {}
    calibrated_oof: dict[str, np.ndarray] = {}
    calibrated_holdout: dict[str, np.ndarray] = {}

    # 단일 모델 — 단일 시드(현행)와 시드 앙상블
    for model in MEMBERS:
        p1, cal1 = scored(members[model]["oof1"], members[model]["holdout1"])
        arms[model] = {"probability": p1, "calibration": cal1, "seeds": 1}
        if model not in DETERMINISTIC:
            pn, caln = scored(members[model]["oof"], members[model]["holdout"])
            arms[f"{model}+시드{len(seeds)}"] = {"probability": pn, "calibration": caln, "seeds": len(seeds)}
        # 결합에는 시드 앙상블(로지스틱은 단일)을 쓴다. 보정된 값을 섞는다.
        calibrator = fit_calibrator_from(members[model]["oof"], y_train)
        calibrated_oof[model] = apply_calibrator(members[model]["oof"], calibrator)
        calibrated_holdout[model] = apply_calibrator(members[model]["holdout"], calibrator)

    # 모델 앙상블 — 결합 뒤 보정기를 한 번 더 붙인다.
    recipes = {
        "앙상블 평균": (MEMBERS, "mean"),
        "앙상블 로짓": (MEMBERS, "logit"),
        "앙상블 순위": (MEMBERS, "rank"),
        "트리2 평균": (("xgboost", "catboost"), "mean"),
    }
    # 스태킹 — 가중치를 손으로 정하지 않고 out-of-fold 예측에서 배운다.
    #
    # 동등 가중 평균은 약한 멤버가 있으면 그쪽으로 끌려간다. 로지스틱이 빈혈에서
    # AUROC 0.65 인데 3 분의 1 을 가져가면 앙상블이 XGBoost 단독보다 나빠진다.
    # 메타 학습기는 그 가중을 데이터에서 정하고, 음수 계수까지 허용하므로 한
    # 멤버를 보정용으로 쓰는 것도 가능하다.
    stack_oof = np.column_stack([_logit(calibrated_oof[m]) for m in MEMBERS])
    stack_holdout = np.column_stack([_logit(calibrated_holdout[m]) for m in MEMBERS])
    meta = LogisticRegression(max_iter=2000, C=1.0).fit(stack_oof, y_train)
    arms["스태킹"] = {
        "probability": meta.predict_proba(stack_holdout)[:, 1],
        # 메타 학습기 자체가 로지스틱이라 이미 보정된 확률을 낸다. 그래도 게이트는
        # 똑같이 통과해야 하므로 재보정 여지를 남기지 않고 그대로 잰다.
        "calibration": {"method": "meta", "parameters": {}},
        "seeds": len(seeds),
        # `stack_oof` 가 MEMBERS 순서로 열을 쌓았으므로 계수 수가 멤버 수와 같아야 한다.
        # 어긋나면 가중치가 엉뚱한 멤버에 붙으므로 조용히 지나가게 두지 않는다.
        "weights": {m: round(float(w), 3) for m, w in zip(MEMBERS, meta.coef_[0], strict=True)},
    }

    for name, (parts, rule) in recipes.items():
        oof_combined = combine([calibrated_oof[m] for m in parts], rule)
        holdout_combined = combine([calibrated_holdout[m] for m in parts], rule)
        # 재보정 전후를 둘 다 남긴다. "평균이 무뎌진다"를 숫자로 보이려는 것이다.
        before = evaluate(y_holdout, holdout_combined, min_rows=MIN_EVAL_ROWS, min_positives=MIN_POSITIVES)
        probability, calibrator = scored(oof_combined, holdout_combined)
        arms[name] = {
            "probability": probability,
            "calibration": calibrator,
            "seeds": len(seeds),
            "slope_before_recalibration": before["calibration_slope"] if before else None,
            "ece_before_recalibration": before["ece"] if before else None,
        }

    baseline_key = "xgboost"
    baseline = arms[baseline_key]["probability"]
    entry: dict[str, Any] = {
        "target": target.key,
        "name": target.name,
        "tier": tier,
        "holdout_cycle": split.holdout_cycle,
        "train_rows": int(len(split.train_index)),
        "holdout_rows": int(len(split.holdout_index)),
        "seeds": list(seeds),
        "baseline": baseline_key,
        "arms": {},
    }
    for name, arm in arms.items():
        scores = evaluate(y_holdout, arm["probability"], min_rows=MIN_EVAL_ROWS, min_positives=MIN_POSITIVES)
        if scores is None:
            continue
        record: dict[str, Any] = {
            "auroc": scores["auroc"],
            "auprc_lift": scores["auprc_lift"],
            "brier_skill": scores["brier_skill"],
            "ece": scores["ece"],
            "calibration_slope": scores["calibration_slope"],
            "calibration_method": arm["calibration"]["method"],
            "seeds": arm["seeds"],
            **selection_score(scores),
        }
        record["rank_key"] = list(record["rank_key"])
        for key in ("slope_before_recalibration", "ece_before_recalibration", "weights"):
            if arm.get(key) is not None:
                record[key] = arm[key]
        if name != baseline_key:
            record.update(paired_bootstrap(y_holdout, baseline, arm["probability"], rounds))
        entry["arms"][name] = record

    passing = {k: v for k, v in entry["arms"].items() if v["calibration_ok"]}
    if passing:
        entry["selected"] = max(passing, key=lambda k: tuple(passing[k]["rank_key"]))
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=[k for k, t in TARGETS.items() if t.serve])
    parser.add_argument("--tiers", nargs="*", default=["basic", "lab"])
    parser.add_argument("--seeds", type=int, default=3)
    parser.add_argument("--rounds", type=int, default=600)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "ensemble.json")
    args = parser.parse_args()

    seeds = SEEDS[: args.seeds]
    data = pd.read_csv(args.data, low_memory=False)
    print(f"data: {args.data.name}  시드 {len(seeds)}개  멤버 {', '.join(MEMBERS)}\n")

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
            print(f"  {'구성':<18}{'AUROC':>8}{'리프트':>7}{'ECE':>7}{'기울기':>7}{'게이트':>7}{'ΔAUROC':>10}")
            for name, arm in entry["arms"].items():
                gate = "통과" if arm["calibration_ok"] else "탈락"
                delta = (
                    f"{arm['delta_auroc']:+.4f}{'*' if arm.get('verdict') == '유의' else ' '}"
                    if "delta_auroc" in arm
                    else "  기준"
                )
                print(
                    f"  {name:<18}{arm['auroc']:>8.4f}{arm['auprc_lift']:>7.2f}{arm['ece']:>7.3f}"
                    f"{arm['calibration_slope']:>7.2f}{gate:>7}{delta:>10}"
                )
            print(f"  선택: {entry.get('selected', '없음')}\n")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"→ {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
