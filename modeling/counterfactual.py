"""Which numbers can a user change to move their predicted risk, and by how much?

For each modifiable field this applies a realistic intervention to every holdout
respondent, re-scores them, and reports the average change in predicted
probability. The interventions are sized to what a lifestyle programme could
plausibly achieve in twelve weeks, not to a best case.

READ THIS BEFORE QUOTING A NUMBER
---------------------------------
These are model counterfactuals, not causal effects. The model learned
associations from cross-sectional surveys. "People with a lower BMI have a lower
predicted risk" is not the same claim as "losing weight lowers your risk", even
when both happen to be true. Nothing here has a control group and nobody was
followed over time.

Two consequences for the product:

* Use the direction and the ordering. Do not put "−3.2%p" on a screen as a
  promise of what a challenge will deliver.
* Fields the model barely uses cannot move the number, no matter how healthy the
  behaviour is. That is a property of this dataset, not a statement about health.

    python modeling/counterfactual.py
    python modeling/counterfactual.py --target dm
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from train_risk import AGE_BINS, AGE_LABELS, CATEGORICAL, DATA, TARGETS, make_pipeline, split_index

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

# Serving-realistic inputs: everything a phone form can ask for, no blood work.
# Lifestyle fields are kept even though they add almost nothing to AUROC — they
# are the only levers a challenge can pull, and a field the model never sees can
# never move the score.
SERVING_FEATURES = [
    "age",
    "sex",
    "bmi",
    "waist_cm",
    "smoking_status",
    "self_rated_health",
    "difficulty_walking",
    "sbp",
    "dbp",
    "alcohol_days_per_year",
    "heavy_alcohol",
    "moderate_min_per_week",
    "vigorous_min_per_week",
    "physical_activity_any",
    "sedentary_min_per_day",
    "sleep_hours",
    "veg_fruit_daily",
    "education_level",
    "income_rank",
]


@dataclass(frozen=True)
class Intervention:
    key: str
    label: str
    apply: Callable[[pd.DataFrame], pd.DataFrame]
    eligible: Callable[[pd.DataFrame], pd.Series]


def _weight_loss(fraction: float) -> Callable[[pd.DataFrame], pd.DataFrame]:
    def apply(frame: pd.DataFrame) -> pd.DataFrame:
        out = frame.copy()
        # BMI is proportional to weight at fixed height.
        out["bmi"] = pd.to_numeric(out["bmi"], errors="coerce") * (1 - fraction)
        if "waist_cm" in out.columns:
            # Waist falls roughly in step with weight; ~0.7 cm per 1% of body weight.
            out["waist_cm"] = pd.to_numeric(out["waist_cm"], errors="coerce") - fraction * 100 * 0.7
        return out

    return apply


def _set(column: str, value: float | str) -> Callable[[pd.DataFrame], pd.DataFrame]:
    def apply(frame: pd.DataFrame) -> pd.DataFrame:
        out = frame.copy()
        out[column] = value
        return out

    return apply


def _add(column: str, amount: float, floor: float | None = None) -> Callable[[pd.DataFrame], pd.DataFrame]:
    def apply(frame: pd.DataFrame) -> pd.DataFrame:
        out = frame.copy()
        shifted = pd.to_numeric(out[column], errors="coerce") + amount
        out[column] = shifted.clip(lower=floor) if floor is not None else shifted
        return out

    return apply


def _everyone(frame: pd.DataFrame) -> pd.Series:
    return pd.Series(True, index=frame.index)


INTERVENTIONS: list[Intervention] = [
    Intervention(
        "weight_5",
        "체중 5% 감량 (BMI·허리둘레 동반)",
        _weight_loss(0.05),
        lambda f: pd.to_numeric(f["bmi"], errors="coerce") >= 23,
    ),
    Intervention(
        "weight_10",
        "체중 10% 감량",
        _weight_loss(0.10),
        lambda f: pd.to_numeric(f["bmi"], errors="coerce") >= 23,
    ),
    Intervention(
        "activity_150",
        "중강도 운동 주 150분 추가",
        _add("moderate_min_per_week", 150.0),
        _everyone,
    ),
    Intervention(
        "sedentary_60",
        "좌식 시간 하루 60분 감소",
        _add("sedentary_min_per_day", -60.0, floor=0.0),
        lambda f: pd.to_numeric(f["sedentary_min_per_day"], errors="coerce") >= 120,
    ),
    Intervention(
        "sleep_7",
        "수면 7시간으로 조정",
        _set("sleep_hours", 7.0),
        lambda f: ~pd.to_numeric(f["sleep_hours"], errors="coerce").between(7, 8),
    ),
    Intervention(
        "quit_smoking",
        "금연 (현재 흡연 -> 과거 흡연)",
        _set("smoking_status", "former"),
        lambda f: f["smoking_status"].astype(str).eq("current"),
    ),
    Intervention(
        "alcohol_half",
        "음주 일수 절반으로",
        lambda f: f.assign(
            alcohol_days_per_year=pd.to_numeric(f["alcohol_days_per_year"], errors="coerce") * 0.5,
            heavy_alcohol=False,
        ),
        lambda f: pd.to_numeric(f["alcohol_days_per_year"], errors="coerce") > 52,
    ),
    Intervention(
        "veg_fruit",
        "채소·과일 매일 섭취",
        _set("veg_fruit_daily", True),
        lambda f: f["veg_fruit_daily"].ne(True),
    ),
    Intervention(
        "bp_10",
        "수축기 혈압 10 mmHg 감소",
        lambda f: f.assign(
            sbp=pd.to_numeric(f["sbp"], errors="coerce") - 10,
            dbp=pd.to_numeric(f["dbp"], errors="coerce") - 5,
        ),
        lambda f: pd.to_numeric(f["sbp"], errors="coerce") >= 120,
    ),
]


def prepare(unified: pd.DataFrame, target: str) -> tuple[pd.DataFrame, pd.Series, list[str]]:
    blocked = set(TARGETS[target]["blocked"])
    columns = [c for c in SERVING_FEATURES if c not in blocked]

    label = unified[TARGETS[target]["label"]].astype("boolean")
    keep = label.notna()
    frame = unified.loc[keep, columns].copy()
    for column in columns:
        if column in CATEGORICAL:
            frame[column] = frame[column].astype("object").fillna("__missing__").astype(str)
        else:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame, label[keep].astype(int), columns


def run(unified: pd.DataFrame, target: str) -> list[dict]:
    x, y, columns = prepare(unified, target)
    numeric = [c for c in columns if c not in CATEGORICAL]
    categorical = [c for c in columns if c in CATEGORICAL]
    train_index, holdout_index = split_index(unified, x.index)

    model = make_pipeline(numeric, categorical).fit(x.loc[train_index], y.loc[train_index])

    # Evaluate on the NHANES slice: measured labels and the full variable set.
    holdout = holdout_index[unified.loc[holdout_index, "source"].eq("nhanes_pooled").to_numpy()]
    base_frame = x.loc[holdout]
    baseline = model.predict_proba(base_frame)[:, 1]
    flag_threshold = float(np.quantile(baseline, 0.90))

    age = pd.to_numeric(unified.loc[holdout, "age"], errors="coerce")
    band = pd.cut(age, AGE_BINS, labels=AGE_LABELS)

    print("=" * 100)
    print(f"{target} — 무엇을 바꾸면 예측 위험도가 내려가는가 (NHANES 홀드아웃 n={len(holdout)})")
    print(f"  평균 예측 위험도 {baseline.mean():.1%}   상위 10% 임계값 {flag_threshold:.3f}")
    print("=" * 100)
    print(f"  {'개입':<32}{'대상':>8}{'평균 변화':>11}{'상대':>9}{'경보 해제':>10}   연령대별 변화")

    rows = []
    for intervention in INTERVENTIONS:
        if any(c in TARGETS[target]["blocked"] for c in ("sbp", "dbp")) and intervention.key == "bp_10":
            continue

        eligible = intervention.eligible(base_frame).fillna(False).to_numpy()
        if eligible.sum() < 100:
            continue

        changed = intervention.apply(base_frame)
        updated = model.predict_proba(changed)[:, 1]

        delta = (updated - baseline)[eligible]
        base_eligible = baseline[eligible]
        relative = float(np.mean(delta / np.maximum(base_eligible, 1e-6)))
        # People who were above the alert threshold and drop below it.
        was_flagged = base_eligible >= flag_threshold
        cleared = int(((updated[eligible] < flag_threshold) & was_flagged).sum())
        clear_rate = cleared / max(int(was_flagged.sum()), 1)

        per_band = {}
        for name in AGE_LABELS:
            mask = band.eq(name).to_numpy() & eligible
            per_band[name] = float(np.mean((updated - baseline)[mask])) if mask.sum() >= 50 else None

        band_text = "  ".join(f"{k} {v * 100:+.2f}%p" if v is not None else f"{k} n/a" for k, v in per_band.items())
        print(
            f"  {intervention.label:<32}{int(eligible.sum()):>8}"
            f"{np.mean(delta) * 100:>+10.2f}%p{relative * 100:>+8.1f}%{clear_rate:>10.1%}   {band_text}"
        )
        rows.append(
            {
                "target": target,
                "intervention": intervention.key,
                "label": intervention.label,
                "eligible": int(eligible.sum()),
                "mean_delta": float(np.mean(delta)),
                "relative_change": relative,
                "alert_cleared_rate": clear_rate,
                "by_band": per_band,
            }
        )

    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--target", nargs="*", default=list(TARGETS))
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "counterfactual.json")
    args = parser.parse_args()

    unified = pd.read_csv(args.data, low_memory=False)
    results = []
    for target in args.target:
        results += run(unified, target)
        print()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
