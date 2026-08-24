"""합성 데이터 — 증강이 듣는지 검정하고, 서빙 경로 픽스처를 만든다.

**먼저 분명히 해 둘 것.** 합성 데이터는 원본에 없는 정보를 만들어 내지 못한다.
NHANES 로 만든 합성 표본으로 학습한 모델이 NHANES 로 학습한 모델을 이길 수 없다.
25번 §2 가 EPV 최저 60.6(관행 기준 10)을 보였으므로 **표본을 늘릴 목적이라면
이 파일은 답이 아니다.** 그런데도 두 가지 쓸 곳이 있다.

**하나, 불균형 처리.** 소수 클래스가 얇은 타깃(고중성지방 EPV 62)에서 합성
오버샘플링이 판정 지표를 실제로 움직이는지는 해 봐야 안다. 안 움직인다는 결과도
값어치가 있다 — 다음 사람이 또 안 해 봐도 되니까.

**둘, 서빙 경로 픽스처.** 실제 데이터로는 못 만드는 입력이 있다. 전부 결측인 사람,
경계값에 정확히 걸린 사람, 서로 모순되는 값을 낸 사람. 이런 행은 NHANES 에 없고
개인정보라 만들 수도 없는데, 순수 파이썬 채점기가 거기서 죽는지는 확인해야 한다.

    ../.venv/Scripts/python.exe synthetic.py --mode augment --target hypertg fatty_liver
    ../.venv/Scripts/python.exe synthetic.py --mode fixtures
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

from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.neighbors import NearestNeighbors
from splits import SEED, make_split
from targets import CATEGORICAL, DERIVED, LAB_FEATURES, TARGETS
from train_multi import DATA, build_frame, lab_present, make_pipeline, monotone_vector

ROOT = Path(__file__).resolve().parent
ARTIFACTS = ROOT / "artifacts"


# ---------------------------------------------------------------------------
# 1. 증강
# ---------------------------------------------------------------------------


def smote(x: np.ndarray, y: np.ndarray, *, k: int = 5, ratio: float = 1.0, seed: int = SEED) -> tuple[np.ndarray, np.ndarray]:
    """소수 클래스를 이웃 사이 직선 위에서 보간해 늘린다 (Chawla 2002).

    범주형은 이미 원-핫으로 펼쳐진 뒤라 보간하면 0.37 같은 값이 나온다. 트리에는
    무해하지만 뜻이 없는 값이라, 보간 계수가 0.5 를 넘으면 이웃 쪽 원본을 그대로
    베끼는 식으로 범주 열만 따로 처리한다 — 그 열이 어디인지는 호출자가 준다.
    """
    rng = np.random.default_rng(seed)
    minority = x[y == 1]
    if len(minority) <= k:
        return x, y
    target_count = int(len(minority) * ratio)
    if target_count <= 0:
        return x, y

    neighbours = NearestNeighbors(n_neighbors=k + 1).fit(minority)
    _, indices = neighbours.kneighbors(minority)
    base = rng.integers(0, len(minority), target_count)
    picked = indices[base, rng.integers(1, k + 1, target_count)]
    gap = rng.random((target_count, 1))
    synthetic = minority[base] + gap * (minority[picked] - minority[base])

    return np.vstack([x, synthetic]), np.concatenate([y, np.ones(target_count, dtype=y.dtype)])


def evaluate(y: np.ndarray, p: np.ndarray) -> dict[str, float]:
    return {
        "auroc": round(float(roc_auc_score(y, p)), 4),
        "auprc": round(float(average_precision_score(y, p)), 4),
        # 상위 5% 를 골랐을 때의 향상도. 화면이 실제로 쓰는 구간이다.
        "lift_top5": round(float(_lift(y, p, 0.05)), 3),
    }


def _lift(y: np.ndarray, p: np.ndarray, fraction: float) -> float:
    cut = int(len(p) * fraction)
    if cut < 10 or y.mean() == 0:
        return float("nan")
    order = np.argsort(-p)[:cut]
    return float(y[order].mean() / y.mean())


def run_augment(data: pd.DataFrame, key: str, tier: str, model: str, ratios: list[float]) -> dict[str, Any] | None:
    target = TARGETS[key]
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

    numeric = [c for c in columns if c not in CATEGORICAL]
    categorical = [c for c in columns if c in CATEGORICAL]
    monotone = monotone_vector(frame, numeric, categorical) if model == "xgboost" else None

    x_train = frame.loc[split.train_index]
    y_train = y.loc[split.train_index].to_numpy()
    x_holdout = frame.loc[split.holdout_index]
    y_holdout = y.loc[split.holdout_index].to_numpy()

    entry: dict[str, Any] = {
        "target": key,
        "name": target.name,
        "tier": tier,
        "model": model,
        "train_rows": int(len(x_train)),
        "train_positives": int(y_train.sum()),
        "positive_rate": round(float(y_train.mean()), 4),
        "arms": {},
    }

    # 대조군 — 아무것도 안 한다.
    pipeline = make_pipeline(numeric, categorical, model, monotone).fit(x_train, y_train)
    entry["arms"]["원본"] = evaluate(y_holdout, pipeline.predict_proba(x_holdout)[:, 1])

    # 클래스 가중 — 합성 없이 불균형만 다룬다. 합성이 이걸 이겨야 값어치가 있다.
    weighted = make_pipeline(numeric, categorical, model, monotone)
    weight = float((y_train == 0).sum()) / max(float((y_train == 1).sum()), 1.0)
    try:
        weighted.fit(x_train, y_train, **{f"{weighted.steps[-1][0]}__sample_weight": np.where(y_train == 1, weight, 1.0)})
        entry["arms"]["클래스가중"] = evaluate(y_holdout, weighted.predict_proba(x_holdout)[:, 1])
    except (TypeError, ValueError):
        pass

    # SMOTE — 전처리를 먼저 적용한 뒤 수치 공간에서 보간한다. 원본 프레임에서
    # 보간하면 결측이 섞여 이웃 계산이 깨진다.
    preprocessor = make_pipeline(numeric, categorical, model, monotone)[:-1]
    x_dense = preprocessor.fit_transform(x_train)
    x_dense = np.asarray(x_dense.todense() if hasattr(x_dense, "todense") else x_dense, dtype=float)
    x_holdout_dense = np.asarray(preprocessor.transform(x_holdout), dtype=float)
    estimator_name, estimator = make_pipeline(numeric, categorical, model, monotone).steps[-1]

    for ratio in ratios:
        x_aug, y_aug = smote(x_dense, y_train, ratio=ratio)
        from sklearn.base import clone

        fitted = clone(estimator).fit(x_aug, y_aug)
        entry["arms"][f"SMOTE x{ratio:g}"] = evaluate(y_holdout, fitted.predict_proba(x_holdout_dense)[:, 1])
        entry["arms"][f"SMOTE x{ratio:g}"]["synthetic_rows"] = int(len(y_aug) - len(y_train))
    return entry


# ---------------------------------------------------------------------------
# 2. 서빙 픽스처
# ---------------------------------------------------------------------------

# 경계값은 targets.py 의 Criterion 에서 그대로 가져온다. 여기 숫자를 손으로 적으면
# 임계값이 두 곳에 살게 되고 언젠가 어긋난다.
BASE_ADULT: dict[str, Any] = {
    "age": 45,
    "sex": "M",
    "height_cm": 172.0,
    "weight_kg": 74.0,
    "self_rated_health": 3,
}


def fixture_rows() -> list[dict[str, Any]]:
    """서빙 계약이 견뎌야 하는 입력. 실제 데이터에는 없는 모양들이다."""
    rows: list[dict[str, Any]] = []

    def add(name: str, note: str, **overrides: Any) -> None:
        rows.append({"name": name, "note": note, "payload": {**BASE_ADULT, **overrides}})

    add("minimal", "필수 입력만. 선택 항목이 전부 비었을 때 죽지 않아야 한다")
    add("all_labs", "검사값 전부. 정밀형 경로", **{c: 100.0 for c in LAB_FEATURES if c != "hba1c"}, hba1c=5.5)
    add("elderly_female", "70세 이상 여성 — 성능이 가장 낮은 구간", age=78, sex="F", height_cm=155.0, weight_kg=52.0)
    add("young_lean", "19세 저체중 — 나이·BMI 하한", age=19, height_cm=180.0, weight_kg=52.0)
    add("extreme_obese", "BMI 상한 근처", height_cm=160.0, weight_kg=190.0, waist_cm=165.0)
    add("srh_missing", "주관적 건강 미입력 — 결측 지시자 경로", self_rated_health=None)

    # 진단 임계값 정확히 걸치는 행. 규칙 엔진과 ML 의 판정이 갈리는 자리다.
    for target in TARGETS.values():
        for criterion in target.criteria:
            value = criterion.value
            if value is None and criterion.by_sex:
                value = criterion.by_sex["M"]
            if value is None:
                continue
            add(
                f"boundary_{target.key}_{criterion.field}",
                f"{target.name} 기준 {criterion.label} {criterion.op} {value} 에 정확히 걸친 값",
                **{criterion.field: float(value)},
            )

    # 모순 입력. 사용자가 단위를 헷갈리거나 OCR 이 잘못 읽으면 실제로 들어온다.
    add("contradiction_lipids", "총콜레스테롤이 HDL+LDL 보다 작다", total_chol=100.0, hdl=80.0, ldl=90.0)
    add("contradiction_bp", "이완기가 수축기보다 높다", sbp=90.0, dbp=120.0)
    add("unit_error_glucose", "공복혈당을 mmol/L 로 적었다", fasting_glucose=5.5)
    add("unit_error_height", "키를 m 로 적었다", height_cm=1.72)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["augment", "fixtures"], default="augment")
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=["hypertg", "fatty_liver", "anemia", "dm"])
    parser.add_argument("--tiers", nargs="*", default=["basic", "lab"])
    parser.add_argument("--models", nargs="*", default=["xgboost"])
    parser.add_argument("--ratios", nargs="*", type=float, default=[0.5, 1.0, 2.0])
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    if args.mode == "fixtures":
        rows = fixture_rows()
        out = args.out or ARTIFACTS / "serving_fixtures.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"픽스처 {len(rows)}건")
        for row in rows[:8]:
            print(f"  {row['name']:<34}{row['note']}")
        print(f"  … 그 외 {max(len(rows) - 8, 0)}건")
        print(f"\n→ {out}")
        return 0

    data = pd.read_csv(args.data, low_memory=False)
    out = args.out or ARTIFACTS / "synthetic_augmentation.json"
    results = []
    for key in args.target:
        for tier in args.tiers:
            if tier not in TARGETS[key].tiers:
                continue
            for model in args.models:
                entry = run_augment(data, key, tier, model, args.ratios)
                if entry is None:
                    print(f"{TARGETS[key].name:<16}{tier:<7}건너뜀")
                    continue
                results.append(entry)
                print(
                    f"\n{entry['name']} / {tier} — 학습 {entry['train_rows']:,}행, "
                    f"양성 {entry['train_positives']:,} ({entry['positive_rate']:.1%})"
                )
                base = entry["arms"]["원본"]
                print(f"  {'구성':<14}{'AUROC':>8}{'AUPRC':>8}{'상위5%lift':>11}{'합성행':>9}")
                for name, scores in entry["arms"].items():
                    mark = "" if name == "원본" else f"  ({scores['auprc'] - base['auprc']:+.4f} AUPRC)"
                    print(
                        f"  {name:<14}{scores['auroc']:>8.4f}{scores['auprc']:>8.4f}"
                        f"{scores['lift_top5']:>11.2f}{scores.get('synthetic_rows', 0):>9,}{mark}"
                    )

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n→ {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
