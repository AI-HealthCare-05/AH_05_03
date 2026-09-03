"""선택된 모델을 API 가 sklearn 없이 채점할 수 있는 JSON 으로 내보낸다.

`train_multi.py` 가 지표 묶음으로 구성을 고르고, 이 스크립트가 그 선택을 배포
형식으로 옮긴다. 두 단계를 나눠 둔 이유는 **무엇을 고를지와 어떻게 실을지가
서로 다른 실패를 하기 때문**이다. 선택이 틀리면 성능이 낮고, 직렬화가 틀리면
성능은 그대로인데 서빙 값이 다르다. 후자는 지표를 아무리 봐도 안 보인다.
그래서 마지막에 순수 파이썬 채점기로 다시 돌려 sklearn 과 대조한다.

번들에 들어가는 것
------------------
로지스틱은 계수와 절편, 부스팅 트리는 노드 배열이다. 둘 다 앞단은 같다 —
결측 대치 중앙값, 표준화 상수, 원핫 범주. `app/services/risk.py` 의
``BaseRiskModel`` 이 그 앞단을 공유하고 마지막 한 단계만 갈라진다.

두 가지를 고쳐 넣는다
---------------------
**참조표를 out-of-fold 로 만든다.** 기존 `export_model.py` 는 학습 행의 인샘플
예측으로 백분위 표를 만들었다(그 docstring 이 스스로 밝혀 뒀다). 인샘플 예측은
실제보다 잘 퍼져 있어서 사용자의 백분위가 체계적으로 낮게 나온다.

**운영점을 번들에 싣는다.** 상위 10%가 어느 확률인지, 그 지점의 PPV·민감도가
얼마인지를 화면이 알아야 "네 명 중 한 명"처럼 정직하게 쓸 수 있다.

    ../.venv/Scripts/python.exe export_multi.py
    ../.venv/Scripts/python.exe export_multi.py --target dm htn --out artifacts/models
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent / "data"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import bundle_io  # noqa: E402
from metrics import evaluate  # noqa: E402
from splits import cv_folds, make_split  # noqa: E402
from targets import CATEGORICAL, DERIVED, TARGETS, Target, substituted_materials  # noqa: E402
from train_multi import (  # noqa: E402
    DATA,
    MONOTONE,
    apply_calibrator,
    fit_calibrator,
    lab_present,
    make_pipeline,
    monotone_vector,
)

from app.services.risk import expand_features, peer_cell, to_float32  # noqa: E402

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
RESULTS = ARTIFACTS / "multi_target_results.json"

REFERENCE_STEPS = 21
MIN_CELL_ROWS = 200

REQUIRED = ["age", "sex", "bmi", "self_rated_health"]

LIMITS = [
    "미국 인구(NHANES 2005-2023)로 학습했으며 한국인 보정을 하지 않았다.",
    "단면 데이터 기반이라 발병 예측이 아니라 측정 기준 유병 여부 선별이다.",
    "임계값은 임상 검토를 받지 않았다.",
    "의료 진단이 아니며 재측정과 의료기관 상담 안내로만 사용한다.",
]


# ---------------------------------------------------------------------------
# 설계 행렬 — 서빙과 같은 확장 함수를 통과시킨다
# ---------------------------------------------------------------------------


# 모델 종류별 특징 확장. 구간 더미는 선형 모델을 위한 장치라 트리에는 넣지
# 않는다 — 자세한 근거는 app/services/risk.py 의 expand_features docstring.
EXPANSION = {"logistic": "+bins+ratios", "xgboost": "ratios"}


def serving_frame(raw: pd.DataFrame, expansion: str) -> pd.DataFrame:
    """`expand_features` 를 행마다 적용한다.

    벡터화한 판보다 느리고, 의도적으로 그렇다. 학습과 서빙이 같은 함수 하나를
    통과해야 둘이 갈라질 수 없다. 40,000행에 몇 초 더 쓰는 값으로는 싸다.
    """
    records = [expand_features(record, expansion) for record in raw.to_dict(orient="records")]
    return pd.DataFrame(records, index=raw.index)


def prepare(
    data: pd.DataFrame, target: Target, tier: str, expansion: str
) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series]:
    """(원본 입력, 확장 설계 행렬, 라벨, 주기). 네 개가 같은 인덱스를 공유한다."""
    columns = target.features(tier)
    raw_columns = sorted({c for c in columns if c not in DERIVED} | {p for c in columns for p in DERIVED.get(c, ())})

    label = data[target.label].astype("boolean")
    keep = label.notna()
    if tier == "lab":
        basic = set(target.features("basic"))
        lab_columns = [c for c in columns if c not in basic and c not in DERIVED]
        keep = keep & lab_present(data, lab_columns)

    raw = data.loc[keep, raw_columns].copy()
    for column in raw_columns:
        if column not in CATEGORICAL:
            raw[column] = pd.to_numeric(raw[column], errors="coerce")
    # NaN 을 None 으로 바꿔야 expand_features 가 "값 없음"으로 읽는다.
    raw = raw.astype(object).where(raw.notna(), None)

    frame = serving_frame(raw, expansion)
    # 확장이 만든 컬럼 중 이 타깃이 쓸 수 있는 것만 남긴다. 확장은 원본에 없던
    # 이름(srh 더미, 연령·BMI 구간, 파생 비율)을 만들지만 차단된 재료에서 나온
    # 것은 애초에 raw 에 없으므로 여기 나타나지 않는다.
    #
    # **갈아 끼운 원재료는 여기서 빼야 한다.** 위 `raw_columns` 가 파생을 계산하려고
    # 재료를 다시 붙였으므로 `raw` 에는 `sbp`·`dbp` 가 있고 확장 결과에도 따라온다.
    # 그대로 두면 맥압·평균동맥압과 완전 공선이 되어, 제약 없는 원값 쪽으로 단조
    # 제약이 우회된다. 실제로 우회했다 — 평균동맥압을 올리는데 확률이 내려갔다.
    dropped = substituted_materials(columns)
    design_columns = [c for c in frame.columns if c not in dropped]
    frame = frame[design_columns]
    for column in design_columns:
        if column in CATEGORICAL:
            frame[column] = frame[column].astype("object").fillna("__missing__").astype(str)
        else:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")

    return raw, frame, label[keep].astype(int), data.loc[keep, "cycle"].astype(str)


# ---------------------------------------------------------------------------
# 직렬화
# ---------------------------------------------------------------------------


def logistic_payload(pipeline, numeric: list[str]) -> dict[str, Any]:
    """계수와 절편. 부호가 임상 상식과 반대면 여기서 멈춘다.

    트리에는 단조 제약을 걸 수 있지만 로지스틱에는 그런 손잡이가 없다. 대신
    계수가 하나뿐이라 부호만 보면 된다 — 주관적 건강 계수가 음수면 건강이
    나쁘다고 답할수록 위험이 내려가는 모델이고, 그건 배포할 물건이 아니다.
    `docs/23_multi_disease_model_design.md` §8 이 요구한 검사다.
    """
    model = pipeline.named_steps["model"]
    coefficients = [float(v) for v in model.coef_[0]]

    for name, direction in MONOTONE.items():
        if name not in numeric:
            continue
        value = coefficients[numeric.index(name)]
        if value * direction < 0:
            raise SystemExit(f"{name} 계수가 {value:+.4f} 로 임상 상식과 반대 부호입니다. 배포를 멈춥니다.")

    return {
        "model": "logistic_regression",
        "coefficients": coefficients,
        "intercept": float(model.intercept_[0]),
    }


def _node_value(node: dict, cache: dict[int, float]) -> float:
    """내부 노드의 값 = 자식 값을 cover 로 가중평균한 것.

    경로 기여도(Saabas)를 서빙에서 계산하려면 노드마다 "여기까지 왔을 때의
    예측값"이 있어야 한다. XGBoost 덤프는 잎 값과 cover 만 주므로 올라오면서
    직접 접는다.
    """
    if "leaf" in node:
        cache[node["nodeid"]] = float(node["leaf"])
        return cache[node["nodeid"]]
    total_cover, total_value = 0.0, 0.0
    for child in node["children"]:
        cover = float(child.get("cover", 1.0))
        total_cover += cover
        total_value += cover * _node_value(child, cache)
    value = total_value / total_cover if total_cover else 0.0
    cache[node["nodeid"]] = value
    return value


def _flatten(node: dict, values: dict[int, float], nodes: list[list[float]], index: dict[int, int]) -> int:
    """중첩 JSON 을 [feature, threshold, left, right, value] 배열로 편다."""
    position = len(nodes)
    index[node["nodeid"]] = position
    nodes.append([-1.0, 0.0, -1.0, -1.0, values[node["nodeid"]]])
    if "leaf" in node:
        return position

    children = {child["nodeid"]: child for child in node["children"]}
    left = _flatten(children[node["yes"]], values, nodes, index)
    right = _flatten(children[node["no"]], values, nodes, index)
    nodes[position] = [
        float(int(node["split"][1:])),
        # 임계값을 float32 로 접어서 싣는다. XGBoost 가 float32 로 비교하므로
        # 서빙도 같은 정밀도에서 비교해야 경계에 걸린 행이 갈라지지 않는다.
        to_float32(float(node["split_condition"])),
        float(left),
        float(right),
        values[node["nodeid"]],
    ]
    return position


def tree_payload(pipeline, design: np.ndarray, digits: int = 8) -> dict[str, Any]:
    """부스팅 트리를 노드 배열로. base_margin 은 실측으로 되찾는다.

    XGBoost 버전마다 base_score 를 확률로 저장하기도 로짓으로 저장하기도 한다.
    설정 파일을 파싱해 추측하는 대신 ``output_margin`` 예측에서 잎 값의 합을 빼
    남는 상수를 쓴다. 버전이 바뀌어도 이 방법은 틀리지 않는다.
    """
    booster = pipeline.named_steps["model"].get_booster()
    trees: list[list[list[float]]] = []
    for dumped in booster.get_dump(dump_format="json", with_stats=True):
        root = json.loads(dumped)
        values: dict[int, float] = {}
        _node_value(root, values)
        nodes: list[list[float]] = []
        _flatten(root, values, nodes, {})
        # 임계값(1번 칸)은 반올림하지 않는다. float32 를 8자리로 자르면 더는
        # float32 로 정확히 표현되는 수가 아니게 되고, 경계에 걸린 행이 다시
        # 갈라진다. 잎 값만 줄여서 파일 크기를 줄인다.
        # 잎값 자릿수가 채점 오차의 바닥을 정한다. 트리 200 개를 더하면 자리당
        # 오차가 쌓이고, 뒤에 등장성 보정이 붙으면 가파른 구간에서 더 부풀 수 있다.
        # 단일 모델은 8 자리로 충분하지만(오차 2e-07) 앙상블은 모델이 여섯이라
        # 여유가 필요하다 — `export_ensemble` 이 10 을 넘긴다.
        trees.append([[node[0], node[1], node[2], node[3], round(node[4], digits)] for node in nodes])

    sample = design[: min(len(design), 512)]
    margin = pipeline.named_steps["model"].predict(sample, output_margin=True)
    folded = [[to_float32(value) for value in row] for row in sample]
    leaves = np.array([sum(_walk(tree, row) for tree in trees) for row in folded])
    offsets = margin - leaves
    base = float(np.median(offsets))
    spread = float(np.max(np.abs(offsets - base)))
    if spread > 1e-4:
        raise AssertionError(f"base_margin 이 상수가 아닙니다 (편차 {spread:.2e}). 트리 순회 규칙을 확인하세요.")

    return {"model": "gradient_boosted_trees", "trees": trees, "base_margin": base}


def _walk(tree: list[list[float]], row: list[float]) -> float:
    node = tree[0]
    while int(node[0]) != -1:
        node = tree[int(node[2])] if row[int(node[0])] < node[1] else tree[int(node[3])]
    return node[4]


# ---------------------------------------------------------------------------
# 참조표
# ---------------------------------------------------------------------------


def build_reference(
    probability: pd.Series, age: pd.Series, sex: pd.Series
) -> tuple[dict[str, list[float]], list[tuple[str, int]]]:
    """연령 구간 × 성별 셀마다 예측 확률의 21분위."""
    cells = [peer_cell(a, s) if pd.notna(a) else None for a, s in zip(age, sex, strict=True)]
    grouped = pd.DataFrame({"cell": cells, "p": probability.to_numpy()}).dropna(subset=["cell"])
    steps = np.linspace(0, 1, REFERENCE_STEPS)

    reference: dict[str, list[float]] = {}
    dropped: list[tuple[str, int]] = []
    for cell, group in grouped.groupby("cell"):
        if len(group) < MIN_CELL_ROWS:
            dropped.append((str(cell), len(group)))
            continue
        reference[str(cell)] = [round(float(v), 6) for v in np.quantile(group["p"], steps)]
    return reference, dropped


# ---------------------------------------------------------------------------
# 빌드
# ---------------------------------------------------------------------------


def choose_model(results: list[dict], target: str, tier: str, override: str | None) -> str:
    """train_multi 의 선택을 그대로 따른다. 파일이 없으면 명시적으로 실패한다."""
    if override:
        return override
    candidates = [e for e in results if e["target"] == target and e["tier"] == tier and e.get("selection")]
    if not candidates:
        raise SystemExit(f"{target}/{tier} 의 평가 결과가 없습니다. 먼저 train_multi.py 를 실행하세요 ({RESULTS}).")
    return max(candidates, key=lambda e: e["selection"]["rank_key"])["model"]


def build(data: pd.DataFrame, target: Target, tier: str, model: str) -> dict[str, Any]:
    expansion = EXPANSION[model]
    raw, frame, y, cycle = prepare(data, target, tier, expansion)
    cycle.index = frame.index
    split = make_split(cycle, target.holdout_cycle)

    numeric = [c for c in frame.columns if c not in CATEGORICAL]
    categorical = [c for c in frame.columns if c in CATEGORICAL]
    monotone = monotone_vector(frame, numeric, categorical) if model == "xgboost" else None

    pipeline = make_pipeline(numeric, categorical, model, monotone).fit(
        frame.loc[split.train_index], y.loc[split.train_index]
    )
    calibrator = fit_calibrator(
        frame.loc[split.train_index], y.loc[split.train_index], numeric, categorical, model, monotone
    )

    holdout_raw = pipeline.predict_proba(frame.loc[split.holdout_index])[:, 1]
    holdout = apply_calibrator(holdout_raw, calibrator)
    y_holdout = y.loc[split.holdout_index].to_numpy()

    # 참조표는 out-of-fold 예측으로. 인샘플 예측은 실제보다 넓게 퍼져 있어서
    # 사용자의 백분위를 체계적으로 낮게 만든다.
    out_of_fold = pd.Series(0.0, index=frame.index)
    for train_rows, valid_rows in cv_folds(y.loc[split.train_index]).split(
        frame.loc[split.train_index], y.loc[split.train_index]
    ):
        rows = split.train_index[valid_rows]
        fold = make_pipeline(numeric, categorical, model, monotone).fit(
            frame.loc[split.train_index[train_rows]], y.loc[split.train_index[train_rows]]
        )
        out_of_fold.loc[rows] = fold.predict_proba(frame.loc[rows])[:, 1]
    out_of_fold.loc[split.holdout_index] = holdout_raw
    reference_probability = pd.Series(apply_calibrator(out_of_fold.to_numpy(), calibrator), index=frame.index)

    reference, dropped = build_reference(
        reference_probability,
        pd.to_numeric(data.loc[frame.index, "age"], errors="coerce"),
        data.loc[frame.index, "sex"].astype(str),
    )

    preprocess = pipeline.named_steps["preprocess"]
    numeric_pipeline = preprocess.named_transformers_["numeric"]
    imputer = numeric_pipeline.named_steps["impute"]
    scaler = numeric_pipeline.named_steps["scale"]
    encoder = preprocess.named_transformers_["categorical"]

    design = preprocess.transform(frame.loc[split.holdout_index])
    if hasattr(design, "toarray"):
        design = design.toarray()

    serialised = (
        logistic_payload(pipeline, numeric)
        if model == "logistic"
        else tree_payload(pipeline, np.asarray(design, dtype=float))
    )
    performance = evaluate(y_holdout, holdout)
    if performance is None:
        raise SystemExit(f"{target.key}/{tier}: 홀드아웃 표본이 지표를 낼 만큼 크지 않습니다.")

    # 사용자에게 보이는 입력 이름. 확장으로 만들어진 이름은 뺀다.
    inputs = [c for c in target.features(tier) if c not in DERIVED]

    bundle: dict[str, Any] = {
        "target": target.key,
        "tier": tier,
        "name": target.name,
        "description": f"{target.name} — 지금 검사받으면 진단 기준을 넘을 가능성",
        "label": target.label,
        "label_definition_text": target.definition,
        # 기계가 읽는 진단 기준. 검사값이 들어오면 서빙이 ML 확률 대신
        # 이걸로 판정한다 — 라벨을 만든 값은 ML 입력에서 차단돼 있어서
        # 확률만 보여주면 "답을 넣었는데 화면이 안심시키는" 사고가 난다.
        "criteria": [
            {
                "field": c.field,
                "label": c.label,
                "unit": c.unit,
                "op": c.op,
                "value": c.value,
                "by_sex": c.by_sex,
            }
            for c in target.criteria
        ],
        "threshold_source": target.threshold_source,
        # 지금은 전부 유병 라벨이다. 발병 라벨로 갈아탈 때 probability 의 뜻이
        # 조용히 바뀌는 사고를 막으려고 미리 넣는다.
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
        **serialised,
        # 참조표가 있으면 등급은 백분위로 정한다. 아래는 참조 구간을 못 찾을 때의 대비책.
        "bands": {
            "moderate_above": float(np.quantile(holdout, 0.70)),
            "high_above": float(np.quantile(holdout, 0.90)),
        },
        "calibration": calibrator,
        # 구 번들과의 호환. RiskModel 은 platt 를 읽고, isotonic 을 고른 경우에는
        # 항등 변환이 들어간다 — 보정은 calibration 쪽에서 이미 끝났다.
        "platt": calibrator["parameters"] if calibrator["method"] == "platt" else {"a": 1.0, "b": 0.0},
        "reference": reference,
        "reference_note": (
            f"NHANES {len(frame):,}명의 out-of-fold 예측 확률 분포. 키는 '성별:연령구간', 값은 0~100% 21분위."
        ),
        "reference_dropped_cells": dropped,
        "performance": performance,
        # 기존 API 응답이 읽는 이름. 이름을 바꾸면 /model-info 가 깨진다.
        "holdout": {
            "cycle": split.holdout_cycle,
            "auroc_nhanes": performance["auroc"],
            "auroc_all": performance["auroc"],
            "brier_nhanes": performance["brier"],
            "base_rate_nhanes": performance["prevalence"],
            "trained_rows": int(len(split.train_index)),
        },
        "limits": [*LIMITS, *([target.note] if target.note else [])],
    }

    if target.undiagnosed_label and target.undiagnosed_label in data.columns:
        prevalent = y.loc[split.holdout_index]
        undiagnosed = data.loc[split.holdout_index, target.undiagnosed_label].astype("boolean")
        keep = (undiagnosed.notna() & ~(prevalent.eq(1) & undiagnosed.ne(True))).to_numpy()
        # 화면에 찍는 성능 수치는 이쪽이다. 이미 진단받은 사람을 맞히는 건 쉽다.
        bundle["performance_undiagnosed"] = evaluate(undiagnosed[keep].astype(int).to_numpy(), holdout[keep])

    return bundle


def equivalence(bundle: dict[str, Any], data: pd.DataFrame, target: Target, tier: str, model_kind: str) -> float:
    """sklearn 파이프라인과 순수 파이썬 채점기의 최대 절대 오차.

    계수 하나가 밀리거나 트리의 자식이 뒤집혀도 AUROC 는 멀쩡해 보인다. 여기서
    잡지 않으면 배포된 뒤에야, 그것도 누가 손으로 값을 넣어 봐야 드러난다.
    """
    from app.services.risk import load_bundle

    scorer = load_bundle(bundle)
    raw, frame, y, cycle = prepare(data, target, tier, bundle["expansion"])
    cycle.index = frame.index
    split = make_split(cycle, target.holdout_cycle)

    numeric, categorical = bundle["numeric_features"], bundle["categorical_features"]
    monotone = monotone_vector(frame, numeric, categorical) if model_kind == "xgboost" else None
    pipeline = make_pipeline(numeric, categorical, model_kind, monotone).fit(
        frame.loc[split.train_index], y.loc[split.train_index]
    )
    sample = split.holdout_index[:300]
    expected = pipeline.predict_proba(frame.loc[sample])[:, 1]

    worst = 0.0
    for index, reference in zip(sample, expected, strict=True):
        payload = {k: v for k, v in raw.loc[index].items() if v is not None}
        worst = max(worst, abs(scorer.raw_probability(payload) - float(reference)))
    return worst


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "models")
    parser.add_argument("--results", type=Path, default=RESULTS)
    parser.add_argument("--target", nargs="*", default=[t.key for t in TARGETS.values() if t.serve])
    parser.add_argument("--tiers", nargs="*", default=["basic", "lab"])
    parser.add_argument("--model", default=None, help="선택을 무시하고 이 모델로 고정한다")
    parser.add_argument("--skip-equivalence", action="store_true")
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    results = json.loads(args.results.read_text(encoding="utf-8")) if args.results.exists() else []
    args.out.mkdir(parents=True, exist_ok=True)

    print(f"data {args.data.name}  rows={len(data)}  ->  {args.out}\n")
    for key in args.target:
        target = TARGETS[key]
        for tier in args.tiers:
            if tier not in target.tiers:
                continue
            model_kind = choose_model(results, key, tier, args.model)
            bundle = build(data, target, tier, model_kind)

            suffix = "" if tier == "basic" else f"_{tier}"
            destination = args.out / f"risk_{key}{suffix}.json"
            # 사후 주입된 `rule_anchor` 를 덮어쓰지 않는다 — 이유는 `bundle_io` 참조.
            carried = bundle_io.carry_over(destination, bundle)
            destination.write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
            if carried:
                print(f"  {destination.name}{bundle_io.note(carried)}")

            gap = "-" if args.skip_equivalence else f"{equivalence(bundle, data, target, tier, model_kind):.2e}"
            performance = bundle["performance"]
            top10 = performance["operating_points"]["top_10pct"]
            size = destination.stat().st_size / 1024
            print(
                f"{key + suffix:<22}{model_kind:<10}변수 {len(bundle['numeric_features']):>2}+"
                f"{len(bundle['categorical_features'])}  AUROC {performance['auroc']:.3f}  "
                f"Brier {performance['brier']:.4f}  ECE {performance['ece']:.4f}  "
                f"PPV@10% {top10['ppv']:.3f}  참조 {len(bundle['reference'])}칸  "
                f"{size:>6.0f}KB  오차 {gap}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
