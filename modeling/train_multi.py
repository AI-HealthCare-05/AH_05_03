"""질환 8개 × 입력 tier 2개 × 모델 2종을 같은 홀드아웃에서 재는 하네스.

답하려는 질문은 두 개다.

**하나. 질환을 늘릴 수 있는가.** 당뇨·고혈압 말고 이상지질혈증·대사증후군·
신기능·지방간·빈혈을 NHANES 로 라벨링할 수 있다. 새로 받은 데이터는 없고
이미 내려받아 둔 8개 주기 안에 있던 파일을 읽었을 뿐이다. 각 타깃이 실제로
학습되는지, 판별력이 화면에 올릴 만한지를 여기서 잰다.

**둘. 검사값을 특징으로 넣으면 성능이 오르는가.** 지금 서빙 모델은 검사값 중
혈압만 받는다. 그런데 라벨 누출 차단 집합은 질환마다 다르다 — 당뇨 라벨은
공복혈당·HbA1c 로 정의되므로 지질·간효소·요산·혈색소는 **막을 이유가 없다.**
막지 않아도 되는 검사값을 한 번도 넣어 본 적이 없다는 것이 이 실험의 출발점이다.

    ../.venv/Scripts/python.exe train_multi.py
    ../.venv/Scripts/python.exe train_multi.py --target dm htn dlp
    ../.venv/Scripts/python.exe train_multi.py --models logistic
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

from metrics import evaluate, selection_score
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from splits import SEED, cv_folds, make_split
from targets import CATEGORICAL, DERIVED, NEW_INDICES, TARGETS, Target

DATA = Path(__file__).resolve().parent / "data" / "processed" / "nhanes_pooled.csv"
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

AGE_EDGES = [19, 40, 50, 60, 70, 200]
AGE_LABELS = ["19-40", "40-50", "50-60", "60-70", "70+"]

# 최소 표본. 이보다 작은 셀의 AUROC 는 숫자로 남기지 않는다 — 보고하면
# 반드시 누군가 인용하고, 그 인용은 노이즈다.
MIN_EVAL_ROWS = 150
MIN_POSITIVES = 15

# --drop 으로 채워지는 전역. 특징 하나를 빼면 얼마를 잃는지 재려고 둔다.
#
# 주관적 건강이 이 손잡이가 필요한 이유: 역학에서 가장 강한 예측변수 중 하나인데
# 동시에 **자가보고**다. 같은 사람이 날마다 다르게 답하고, "몸이 안 좋다"가
# 위험도를 올린다는 결과는 사용자가 이미 아는 것을 되돌려 줄 뿐이다. 빼는 게
# 맞는지는 취향이 아니라 손실 폭으로 정한다.
DROPPED: set[str] = set()


# ---------------------------------------------------------------------------
# 특징
# ---------------------------------------------------------------------------


def _ratio(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    """0 과 음수 분모는 결측으로. 검사값에 0 이 오는 건 미측정이지 값이 아니다."""
    safe = denominator.where(denominator > 0)
    return numerator / safe


# 임상 지수의 원 논문은 SI 단위(mmol/L)로 적혀 있고 이 저장소의 검사값은 mg/dL 이다.
# 계수를 그대로 쓰면 값이 통째로 어긋나는데 **AUROC 로는 안 보인다** — 단조 변환이라
# 판별력이 그대로기 때문이다. 어긋난 채로 절단값을 화면에 쓰는 순간 사고가 된다.
TG_MG_TO_MMOL = 88.57
CHOL_MG_TO_MMOL = 38.67


def add_clinical_indices(frame: pd.DataFrame, columns: list[str]) -> None:  # noqa: C901
    """학회·코호트에서 검증된 지수. 재료가 없으면 `columns` 에 애초에 안 들어온다.

    어느 지수가 이 타깃에서 허용되는지는 `targets.DERIVED` 와 각 타깃의 ``blocked``
    이 이미 정했다. 여기서는 계산만 하고 판단하지 않는다.
    """
    if not any(name in columns for name in NEW_INDICES):
        return

    def col(name: str) -> pd.Series:
        return frame[name]

    if "tyg" in columns:
        # ln[TG(mg/dL) x FPG(mg/dL) / 2]
        product = col("triglyceride") * col("fasting_glucose") / 2.0
        frame["tyg"] = np.log(product.where(product > 0))
    if "fli" in columns:
        linear = (
            0.953 * np.log(col("triglyceride").where(col("triglyceride") > 0))
            + 0.139 * col("bmi")
            + 0.718 * np.log(col("ggt").where(col("ggt") > 0))
            + 0.053 * col("waist_cm")
            - 15.745
        )
        # 100/(1+e^-L). 로지스틱이라 0~100 으로 눌린다.
        frame["fli"] = 100.0 / (1.0 + np.exp(-linear))
    if "lap" in columns:
        female = col("sex").astype("object").eq("F")
        baseline = pd.Series(np.where(female, 58.0, 65.0), index=frame.index).where(col("sex").notna())
        excess = (col("waist_cm") - baseline).clip(lower=0)
        frame["lap"] = excess * (col("triglyceride") / TG_MG_TO_MMOL)
    if "vai" in columns:
        female = col("sex").astype("object").eq("F")
        tg = col("triglyceride") / TG_MG_TO_MMOL
        hdl = col("hdl") / CHOL_MG_TO_MMOL
        denominator = pd.Series(np.where(female, 36.58, 39.68), index=frame.index) + pd.Series(
            np.where(female, 1.89, 1.88), index=frame.index
        ) * col("bmi")
        tg_reference = pd.Series(np.where(female, 0.81, 1.03), index=frame.index)
        hdl_reference = pd.Series(np.where(female, 1.52, 1.31), index=frame.index)
        value = _ratio(col("waist_cm"), denominator) * (tg / tg_reference) * (hdl_reference / hdl.where(hdl > 0))
        frame["vai"] = value.where(col("sex").notna())
    if "cmi" in columns:
        tg = col("triglyceride") / TG_MG_TO_MMOL
        hdl = col("hdl") / CHOL_MG_TO_MMOL
        frame["cmi"] = _ratio(tg, hdl) * _ratio(col("waist_cm"), col("height_cm"))
    if "mets_ir" in columns:
        # {ln[(2·FPG) + TG] × BMI} / ln(HDL). 괄호 위치가 중요하다 — BMI 를 로그
        # 안에 넣으면 값이 2 언저리로 눌리고 문헌 분포(30~50)와 어긋난다.
        inner = 2.0 * col("fasting_glucose") + col("triglyceride")
        hdl = col("hdl")
        # ln(HDL) 이 분모라 HDL=1 에서 0 으로 나뉜다. 실제로는 없는 값이지만 막아 둔다.
        denominator = np.log(hdl.where(hdl > 1))
        frame["mets_ir"] = _ratio(np.log(inner.where(inner > 0)) * col("bmi"), denominator)
    if "absi" in columns:
        # WC 와 height 를 m 로 맞춘다. BMI 는 kg/m^2 그대로.
        waist_m = col("waist_cm") / 100.0
        height_m = col("height_cm") / 100.0
        frame["absi"] = _ratio(waist_m, col("bmi").clip(lower=0) ** (2 / 3) * height_m.clip(lower=0) ** 0.5)
    if "remnant_chol" in columns:
        frame["remnant_chol"] = col("total_chol") - col("hdl") - col("ldl")
    if "tc_hdl_ratio" in columns:
        frame["tc_hdl_ratio"] = _ratio(col("total_chol"), col("hdl"))
    if "ldl_hdl_ratio" in columns:
        frame["ldl_hdl_ratio"] = _ratio(col("ldl"), col("hdl"))
    if "uric_creatinine_ratio" in columns:
        frame["uric_creatinine_ratio"] = _ratio(col("uric_acid"), col("creatinine"))
    if "pulse_pressure" in columns:
        frame["pulse_pressure"] = col("sbp") - col("dbp")
    if "mean_arterial_pressure" in columns:
        frame["mean_arterial_pressure"] = col("dbp") + (col("sbp") - col("dbp")) / 3.0


def build_frame(source: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    """요청된 컬럼만 담은 설계용 프레임. 파생 비율은 여기서 계산한다."""
    raw_needed = {c for c in columns if c not in DERIVED}
    for name in columns:
        raw_needed.update(DERIVED.get(name, ()))

    frame = pd.DataFrame(index=source.index)
    for column in sorted(raw_needed):
        series = source[column]
        frame[column] = series if column in CATEGORICAL else pd.to_numeric(series, errors="coerce")

    if "tg_hdl_ratio" in columns:
        frame["tg_hdl_ratio"] = _ratio(frame["triglyceride"], frame["hdl"])
    if "non_hdl" in columns:
        frame["non_hdl"] = frame["total_chol"] - frame["hdl"]
    if "ast_alt_ratio" in columns:
        frame["ast_alt_ratio"] = _ratio(frame["ast"], frame["alt"])
    if "waist_height_ratio" in columns:
        frame["waist_height_ratio"] = _ratio(frame["waist_cm"], frame["height_cm"])
    add_clinical_indices(frame, columns)

    frame = frame[columns]
    for column in columns:
        if column in CATEGORICAL:
            frame[column] = frame[column].astype("object").fillna("__missing__").astype(str)
    return frame


# 방향이 임상적으로 정해져 있고 제품이 계약으로 삼는 특징.
#
# 주관적 건강이 나빠지면 위험이 올라가야 한다. 이건 데이터에 맡길 문제가 아니다 —
# 표본의 작은 요철 때문에 "매우 좋음"이 "좋음"보다 위험하게 학습되면, 사용자가
# 설문에서 자기 건강을 더 좋게 답했을 때 숫자가 나빠진다. 제품으로서 설명할 수
# 없는 동작이고, 실제로 트리 모델에서 그 역전이 나왔다.
#
# 나이·BMI 는 넣지 않는다. 방향이 뚜렷해 보이지만 타깃마다 다르다 — 빈혈은 BMI 가
# 높을수록 유병률이 낮고, 지방간은 고령에서 오히려 떨어진다. 틀린 제약은 제약이
# 없느니만 못하다.
#
# 혈압 파생 둘은 방향이 타깃과 무관하게 정해져 있다. 평균동맥압이 오르면 위험이
# 올라가고, 맥압이 커지면(혈관이 굳으면) 위험이 올라간다. 어느 질환에서도 반대로
# 말할 근거가 없다. `sbp`·`dbp` 원값에는 이 제약을 걸 수 없었다 — dbp 의 임상적
# 방향이 sbp 를 고정했을 때와 함께 올릴 때 서로 반대이기 때문이다. 그래서
# `targets.SUBSTITUTED_MATERIALS` 로 원값을 빼고 파생으로 갈아 끼운 다음 제약을 건다.
MONOTONE: dict[str, int] = {
    "self_rated_health": 1,
    "mean_arterial_pressure": 1,
    "pulse_pressure": 1,
}

# 타깃별 예외. `MONOTONE` 을 이 값으로 덮는다. `0` 은 제약 해제.
#
# **평균동맥압을 전 타깃에 +1 로 걸었던 것이 틀렸다.** 위 주석이 나이·BMI 를 두고
# "방향이 뚜렷해 보이지만 타깃마다 다르다 — 틀린 제약은 제약이 없느니만 못하다"고
# 적어 뒀는데, 평균동맥압도 같은 부류였다.
#
# 빈혈이 그 자리다. 실측으로 `anemia` 만 AUROC −0.0157 떨어졌다(다른 하락 최대치가
# −0.0047 이니 3 배 넘는다). 이유는 생리다 — 빈혈은 혈액 점도를 낮추고 말초저항을
# 떨어뜨려서 **평균동맥압을 낮춘다.** 맥압은 반대로 넓어지므로(26번 문서 §6 의
# 빈혈 일반형 +0.0055 가 그 관찰이다) 맥압 +1 은 맞고 MAP +1 만 거꾸로였다.
#
# 새 타깃을 넣을 때 방향을 모르면 `0` 으로 둔다. 추측한 제약은 판별력만 깎는다.
MONOTONE_OVERRIDES: dict[str, dict[str, int]] = {
    "anemia": {"mean_arterial_pressure": -1},
}


#: 단조 제약을 받는 모델. 로지스틱은 계수 부호 검사로 따로 다룬다.
#
# 원래는 XGBoost 만이었고 그 판단이 `ensemble.py`·`export_ensemble.py` 에 네 벌 복사돼
# 있었다. 한 곳만 고쳤더니 학습 경로는 바뀌고 내보내기 경로는 그대로여서 AUROC 가
# 소수 넷째 자리까지 똑같이 나왔다 — 바뀐 줄 알았는데 안 바뀐 것이다. 그래서 모았다.
MONOTONE_MODELS: tuple[str, ...] = ("xgboost", "catboost")


def monotone_direction(target_key: str | None, feature: str) -> int:
    """이 타깃에서 이 특징에 걸린 방향. 제약이 없으면 0.

    번들에 실어 보내려고 만들었다. 방향을 학습 쪽 한 곳에서만 정하고 서빙 테스트는
    번들에 적힌 값을 읽게 해야, 예외를 추가할 때 테스트가 조용히 어긋나지 않는다.
    """
    rules = dict(MONOTONE)
    if target_key:
        rules.update(MONOTONE_OVERRIDES.get(target_key, {}))
    return rules.get(feature, 0)


def monotone_for(
    model: str,
    frame: pd.DataFrame,
    numeric: list[str],
    categorical: list[str],
    target_key: str | None = None,
) -> tuple[int, ...] | None:
    """모델별 단조 제약 벡터. 제약을 안 받는 모델이면 None.

    `target_key` 를 넘기면 `MONOTONE_OVERRIDES` 가 적용된다. 안 넘기면 전역 기본값만
    쓰므로, 새 호출부를 만들 때 넘기는 것을 잊으면 타깃 예외가 조용히 사라진다.
    """
    if model not in MONOTONE_MODELS:
        return None
    return monotone_vector(frame, numeric, categorical, target_key)


def monotone_vector(
    frame: pd.DataFrame, numeric: list[str], categorical: list[str], target_key: str | None = None
) -> tuple[int, ...] | None:
    """설계 행렬 순서에 맞춘 단조 제약 벡터.

    XGBoost 는 열 이름이 아니라 위치로 제약을 읽고, 벡터가 특징 수보다 길면
    거부한다. 원핫 폭을 미리 세려고 하면 학습에 실제로 등장한 범주 수를 맞혀야
    하는데 폴드마다 달라질 수 있다 — 한 번 어긋나서 학습이 통째로 죽었다.

    그래서 세지 않는다. 제약이 걸린 마지막 위치까지만 벡터를 만들고 자른다.
    XGBoost 는 짧은 벡터를 허용하고 나머지를 제약 없음으로 읽으며, 제약 대상은
    전부 numeric 블록(설계 행렬 앞쪽)에 있으므로 원핫 자리에는 닿지 않는다.
    """
    _ = frame, categorical
    directions = [monotone_direction(target_key, name) for name in numeric]
    if not any(directions):
        return None
    last = max(index for index, value in enumerate(directions) if value)
    return tuple(directions[: last + 1])


def make_pipeline(
    numeric: list[str],
    categorical: list[str],
    model: str,
    monotone: tuple[int, ...] | None = None,
    seed: int = SEED,
    params: dict[str, Any] | None = None,
) -> Pipeline:
    """결측 지시자를 쓰지 않는다.

    "이 질문을 건너뛰었다"가 특징이 되면, 사용자가 선택 항목 하나를 비우는
    행위만으로 확률이 튄다. 빈칸은 '평균이라고 가정'이라는 뜻이어야 한다.

    `params` 는 모델 하이퍼파라미터를 덮어쓴다. **튜닝 스크립트가 파이프라인을 따로
    만들지 않게 하려고 있다.** `tune_lab.py` 가 전처리 블록을 통째로 복사해 갖고
    있었는데, 그러면 전처리를 한쪽에서 고치는 순간 "튜닝해서 고른 설정" 과 "실제로
    배포되는 파이프라인" 이 조용히 달라진다 — 34번 문서 §0 의 사고 1 과 같은 모양이다.
    """
    steps: list[tuple[str, Any]] = [
        (
            "preprocess",
            ColumnTransformer(
                [
                    (
                        "numeric",
                        Pipeline(
                            [
                                ("impute", SimpleImputer(strategy="median", add_indicator=False)),
                                ("scale", StandardScaler()),
                            ]
                        ),
                        numeric,
                    ),
                    ("categorical", OneHotEncoder(handle_unknown="ignore", drop="first"), categorical),
                ]
            ),
        )
    ]

    if model == "logistic":
        steps.append(("model", LogisticRegression(max_iter=5000, C=0.1, random_state=seed)))
    elif model == "xgboost":
        from xgboost import XGBClassifier

        # EXPERIMENTS_REPORT.md 4장에서 튜닝한 설정. 기본값(depth 4, 400트리)은
        # 이 표본 크기에 과하다.
        steps.append(
            (
                "model",
                XGBClassifier(
                    **{
                        "n_estimators": 200,
                        "max_depth": 3,
                        "min_child_weight": 50,
                        "learning_rate": 0.05,
                        "subsample": 0.8,
                        "colsample_bytree": 0.8,
                        "reg_lambda": 1.0,
                        "eval_metric": "logloss",
                        "random_state": seed,
                        "n_jobs": 4,
                        **(params or {}),
                    },
                    **({"monotone_constraints": monotone} if monotone else {}),
                ),
            )
        )
    elif model == "catboost":
        # 비교 실험용 분기다 (`compare_catboost.py`). 기본 경로에서는 쓰지 않으므로
        # import 도 여기서만 한다 — catboost 가 없는 환경에서 하네스가 죽지 않는다.
        from catboost import CatBoostClassifier

        steps.append(
            (
                "model",
                CatBoostClassifier(
                    **{
                        "iterations": 400,
                        "depth": 6,
                        "learning_rate": 0.05,
                        "l2_leaf_reg": 3.0,
                        "random_seed": seed,
                        "verbose": 0,
                        "allow_writing_files": False,
                        **(params or {}),
                    },
                    **({"monotone_constraints": list(monotone)} if monotone else {}),
                ),
            )
        )
    else:
        raise ValueError(f"알 수 없는 모델: {model}")

    return Pipeline(steps)


# ---------------------------------------------------------------------------
# 확률 보정
# ---------------------------------------------------------------------------
#
# 판별력과 보정은 다른 문제다. 순위를 아무리 잘 매겨도 확률이 틀리면 화면의
# 숫자가 틀리고, 이 제품은 확률에서 백분위·등급·경보가 전부 파생된다. GBDT 는
# 로지스틱보다 순위는 잘 매기지만 확률이 중앙으로 몰리는 성질이 있어서
# (보정 기울기 1.1~1.2) 보정을 붙이지 않으면 지표 묶음의 확률 층에서 진다.


def score(y: np.ndarray, p: np.ndarray) -> dict | None:
    return evaluate(y, p, min_rows=MIN_EVAL_ROWS, min_positives=MIN_POSITIVES)


def _out_of_fold(frame: pd.DataFrame, y: pd.Series, numeric, categorical, model: str, monotone=None) -> np.ndarray:
    """학습 구간의 out-of-fold 예측.

    보정을 인샘플 예측에 맞추면 모델 자신의 낙관을 학습하게 되고, 홀드아웃에서는
    아무것도 나아지지 않는다. 보정기는 모델이 본 적 없는 행에서 적합해야 한다.
    """
    predictions = np.zeros(len(y))
    for train_rows, valid_rows in cv_folds(y).split(frame, y):
        fold = make_pipeline(numeric, categorical, model, monotone).fit(frame.iloc[train_rows], y.iloc[train_rows])
        predictions[valid_rows] = fold.predict_proba(frame.iloc[valid_rows])[:, 1]
    return predictions


def _logit(p: np.ndarray) -> np.ndarray:
    clipped = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(clipped / (1 - clipped))


def fit_calibrator(
    frame: pd.DataFrame, y: pd.Series, numeric, categorical, model: str, monotone=None
) -> dict[str, Any]:
    """Platt 와 isotonic 을 둘 다 적합하고 out-of-fold ECE 가 낮은 쪽을 고른다.

    둘의 성질이 다르다. Platt 은 로짓에 직선 하나를 얹는 두 모수짜리라 표본이
    적어도 안정적이지만 휘어진 오차는 못 편다. Isotonic 은 단조 계단함수라
    무엇이든 맞출 수 있는 대신 표본이 적으면 계단이 데이터 잡음을 따라간다.
    어느 쪽이 나은지는 타깃마다 다르므로 미리 정하지 않고 매번 잰다.

    둘 다 단조 변환이라 **AUROC 와 백분위 순위는 어느 쪽을 골라도 변하지 않는다.**
    바뀌는 것은 Brier·ECE 뿐이고, 그게 이 단계가 노리는 것이다.
    """
    from metrics import expected_calibration_error

    predicted = _out_of_fold(frame, y, numeric, categorical, model, monotone)
    target = y.to_numpy()

    platt = LogisticRegression(max_iter=1000).fit(_logit(predicted).reshape(-1, 1), target)
    platt_out = 1.0 / (1.0 + np.exp(-(platt.coef_[0][0] * _logit(predicted) + platt.intercept_[0])))

    isotonic = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(predicted, target)
    isotonic_out = isotonic.predict(predicted)

    candidates = {
        "platt": (
            expected_calibration_error(target, platt_out)[0],
            {"a": float(platt.coef_[0][0]), "b": float(platt.intercept_[0])},
        ),
        "isotonic": (
            expected_calibration_error(target, isotonic_out)[0],
            {
                "x": [round(float(v), 6) for v in isotonic.X_thresholds_],
                "y": [round(float(v), 6) for v in isotonic.y_thresholds_],
            },
        ),
        "none": (expected_calibration_error(target, predicted)[0], {}),
    }
    chosen = min(candidates, key=lambda name: candidates[name][0])
    return {
        "method": chosen,
        "parameters": candidates[chosen][1],
        "out_of_fold_ece": {name: round(value, 5) for name, (value, _) in candidates.items()},
    }


def apply_calibrator(probability: np.ndarray, calibrator: dict[str, Any]) -> np.ndarray:
    method, parameters = calibrator["method"], calibrator["parameters"]
    if method == "platt":
        return 1.0 / (1.0 + np.exp(-(parameters["a"] * _logit(probability) + parameters["b"])))
    if method == "isotonic":
        return np.interp(probability, parameters["x"], parameters["y"])
    return probability


# ---------------------------------------------------------------------------
# 실행
# ---------------------------------------------------------------------------


def lab_present(source: pd.DataFrame, lab_columns: list[str]) -> pd.Series:
    """검진 결과지를 실제로 가진 행.

    한 컬럼만 보고 판정하지 않는다. 지질 4종 중 LDL·중성지방은 공복 채혈
    하위표본에만 있어서 그 둘로 자르면 표본이 반으로 준다. 반대로 총콜레스테롤
    하나만 보면 생화학 검사를 안 받은 행이 섞인다. 그래서 비율로 자른다.
    """
    if not lab_columns:
        return pd.Series(True, index=source.index)
    filled = source[lab_columns].notna().mean(axis=1)
    return filled >= 0.6


def run_one(
    data: pd.DataFrame,
    target: Target,
    tier: str,
    model: str,
    *,
    restrict_to_lab_rows: bool = False,
    label_tier: str | None = None,
) -> dict[str, Any] | None:
    """한 (타깃, tier, 모델) 조합을 학습하고 홀드아웃에서 잰다.

    ``restrict_to_lab_rows`` 는 basic 모델을 검사값 보유자만으로 평가할 때 쓴다.
    정밀형의 이득은 "검사값을 낸 사람에게 얼마나 더 잘 맞히는가"이지 전체 인구
    평균이 아니다. 두 tier 를 서로 다른 사람들 위에서 비교하면 그 차이가 모델
    성능이 아니라 표본 구성 차이를 재게 된다.
    """
    columns = [c for c in target.features(tier) if c not in DROPPED]
    # 파생 비율은 재료가 이미 이 목록에 있으므로 보유 판정에서 뺀다.
    basic_columns = set(target.features("basic"))
    lab_columns = [c for c in target.features("lab") if c not in basic_columns and c not in DERIVED]

    label = data[target.label].astype("boolean")
    usable = label.notna()
    if tier == "lab" or restrict_to_lab_rows:
        usable = usable & lab_present(data, lab_columns)
    if int(usable.sum()) < 500:
        return None

    subset = data.loc[usable]
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

    monotone = monotone_for(model, frame, numeric, categorical, target.key)
    pipeline = make_pipeline(numeric, categorical, model, monotone)
    pipeline.fit(frame.loc[split.train_index], y.loc[split.train_index])
    raw = pipeline.predict_proba(frame.loc[split.holdout_index])[:, 1]
    y_holdout = y.loc[split.holdout_index].to_numpy()

    calibrator = fit_calibrator(
        frame.loc[split.train_index], y.loc[split.train_index], numeric, categorical, model, monotone
    )
    probability = apply_calibrator(raw, calibrator)

    uncalibrated = score(y_holdout, raw)
    calibrated = score(y_holdout, probability)

    entry: dict[str, Any] = {
        "target": target.key,
        "name": target.name,
        "tier": label_tier or tier,
        "model": model,
        "evaluated_on": "검사값 보유자" if (tier == "lab" or restrict_to_lab_rows) else "전체",
        "n_features": len(columns),
        "features": columns,
        "train_rows": int(len(split.train_index)),
        "train_cycles": split.train_cycles,
        "holdout_cycle": split.holdout_cycle,
        "calibration": calibrator,
        # 보정 전후를 둘 다 남긴다. 보정이 판별력 문제를 가리는 위장이 아니라는
        # 것을 보이려면 "보정 전후 AUROC 가 같다"를 숫자로 확인할 수 있어야 한다.
        "overall_uncalibrated": uncalibrated,
        "overall": calibrated,
    }
    if calibrated:
        entry["selection"] = selection_score(calibrated)

    # 미진단자만. 이미 진단받은 사람을 맞히는 건 쉽고 값어치가 없다 —
    # 제품이 찾아야 하는 사람은 자기가 그 질환인 줄 모르는 사람이다.
    # 남기는 집합은 음성 + 미진단 양성이고, 진단받은 양성은 통째로 뺀다.
    # diagnose_targets.py 와 같은 규칙이라 두 리포트의 숫자를 나란히 놓을 수 있다.
    if target.undiagnosed_label and target.undiagnosed_label in subset.columns:
        prevalent = y.loc[split.holdout_index]
        undiagnosed = subset.loc[split.holdout_index, target.undiagnosed_label].astype("boolean")
        keep = (undiagnosed.notna() & ~(prevalent.eq(1) & undiagnosed.ne(True))).to_numpy()
        entry["undiagnosed"] = score(undiagnosed[keep].astype(int).to_numpy(), probability[keep])

    age = pd.to_numeric(subset.loc[split.holdout_index, "age"], errors="coerce")
    band = pd.cut(age, AGE_EDGES, labels=AGE_LABELS, right=False)
    entry["by_age"] = {
        name: score(y_holdout[band.eq(name).to_numpy()], probability[band.eq(name).to_numpy()]) for name in AGE_LABELS
    }
    sex = subset.loc[split.holdout_index, "sex"].astype(str)
    entry["by_sex"] = {
        value: score(y_holdout[sex.eq(value).to_numpy()], probability[sex.eq(value).to_numpy()]) for value in ("M", "F")
    }

    if model == "logistic":
        names = list(pipeline.named_steps["preprocess"].get_feature_names_out())
        weights = pipeline.named_steps["model"].coef_[0]
        entry["coefficients"] = {
            name.split("__", 1)[-1]: round(float(w), 4)
            for name, w in sorted(zip(names, weights, strict=True), key=lambda kv: -abs(kv[1]))
        }

    return entry


HEADER = (
    f"  {'구성':<11}{'모델':<10}{'변수':>4}{'AUROC':>8}{'AUPRC×':>8}{'Brier':>8}"
    f"{'BSS':>7}{'ECE':>8}{'기울기':>7}{'상위10% PPV':>12}{'민감도':>8}{'MCC':>7}  보정"
)


def show(entry: dict[str, Any], baseline: dict[str, Any] | None) -> None:
    overall = entry["overall"]
    if overall is None:
        print(f"  {entry['tier']:<11}{entry['model']:<10} 표본 부족")
        return
    delta = ""
    if baseline and baseline.get("overall"):
        delta = f" ({overall['auroc'] - baseline['overall']['auroc']:+.3f})"
    top10 = overall["operating_points"]["top_10pct"]
    gate = "" if entry.get("selection", {}).get("calibration_ok", True) else "  ← 보정 탈락"
    print(
        f"  {entry['tier']:<11}{entry['model']:<10}{entry['n_features']:>4}"
        f"{overall['auroc']:>8.3f}{overall['auprc_lift']:>8.2f}{overall['brier']:>8.4f}"
        f"{overall['brier_skill']:>7.3f}{overall['ece']:>8.4f}{overall['calibration_slope']:>7.2f}"
        f"{top10['ppv']:>12.3f}{top10['sensitivity']:>8.3f}{top10['mcc']:>7.3f}"
        f"  {entry['calibration']['method']}{delta}{gate}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=list(TARGETS))
    parser.add_argument("--tiers", nargs="*", default=["basic", "lab"])
    parser.add_argument("--models", nargs="*", default=["logistic", "xgboost"])
    parser.add_argument("--drop", nargs="*", default=[], help="이 특징을 빼고 학습한다")
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "multi_target_results.json")
    args = parser.parse_args()

    DROPPED.update(args.drop)
    data = pd.read_csv(args.data, low_memory=False)
    print(f"data: {args.data.name}  rows={len(data)}" + (f"  제외: {', '.join(args.drop)}" if args.drop else "") + "\n")

    results: list[dict[str, Any]] = []
    for key in args.target:
        target = TARGETS[key]
        labelled = int(data[target.label].astype("boolean").notna().sum())
        positives = int(data[target.label].astype("boolean").sum(skipna=True))
        print("=" * 120)
        print(
            f"{target.key} — {target.name}  "
            f"라벨 {labelled:,}행 / 양성 {positives:,} ({positives / max(labelled, 1):.1%})  "
            f"차단 {len(target.blocked)}개"
        )
        print(f"  정의: {target.definition}")
        print("=" * 120)
        print(HEADER)

        # 세 줄을 나란히 놓아야 정밀형의 이득이 읽힌다.
        #   basic      전체 인구, 검사값 없음        — 지금 서빙 중인 것
        #   basic@lab  검사값 보유자, 검사값 미사용  — 정밀형과 같은 사람들
        #   lab        검사값 보유자, 검사값 사용    — 정밀형
        # 이득은 lab − basic@lab 이다. lab − basic 은 표본 구성 차이가 섞인다.
        plans: list[tuple[str, dict[str, Any]]] = [("basic", {})]
        if "lab" in target.tiers and "lab" in args.tiers:
            plans.append(("basic", {"restrict_to_lab_rows": True, "label_tier": "basic@lab"}))
            plans.append(("lab", {}))
        plans = [(tier, options) for tier, options in plans if tier in args.tiers or options.get("label_tier")]

        comparison: dict[str, Any] | None = None
        for tier, options in plans:
            for model in args.models:
                entry = run_one(data, target, tier, model, **options)
                if entry is None:
                    print(f"  {options.get('label_tier', tier):<10}{model:<10} 건너뜀 (표본 부족)")
                    continue
                if entry["tier"] == "basic@lab" and model == "logistic":
                    comparison = entry
                show(entry, comparison if entry["tier"] == "lab" else None)
                results.append(entry)
        print()

    summarise(results)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {args.out}")
    return 0


def summarise(results: list[dict[str, Any]]) -> None:
    """타깃마다 지표 묶음으로 한 구성을 고르고, 그 이유를 같이 적는다.

    AUROC 최고를 고르지 않는다. 보정 게이트(ECE·기울기·Brier skill)를 먼저
    통과해야 하고, 통과한 것들 사이에서 AUPRC 리프트로 순위를 매긴다.
    """
    print("\n" + "=" * 120)
    print("선택 — 보정 게이트 통과 후 AUPRC 리프트 순")
    print("=" * 120)
    print(f"  {'질환':<20}{'선택 구성':<26}{'AUROC':>8}{'AUPRC×':>8}{'ECE':>8}{'PPV@10%':>9}{'MCC':>7}  탈락한 것")

    by_target: dict[str, list[dict[str, Any]]] = {}
    for entry in results:
        if entry.get("overall") and entry["tier"] != "basic":
            by_target.setdefault(entry["target"], []).append(entry)

    for key, entries in by_target.items():
        ranked = sorted(entries, key=lambda e: e["selection"]["rank_key"], reverse=True)
        winner = ranked[0]
        overall = winner["overall"]
        rejected = [f"{e['tier']}·{e['model']}" for e in entries if not e["selection"]["calibration_ok"]]
        print(
            f"  {winner['name']:<20}{winner['tier'] + ' · ' + winner['model']:<26}"
            f"{overall['auroc']:>8.3f}{overall['auprc_lift']:>8.2f}{overall['ece']:>8.4f}"
            f"{overall['operating_points']['top_10pct']['ppv']:>9.3f}"
            f"{overall['operating_points']['top_10pct']['mcc']:>7.3f}"
            f"  {', '.join(rejected) if rejected else '-'}"
        )
        _ = key


if __name__ == "__main__":
    raise SystemExit(main())
