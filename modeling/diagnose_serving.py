"""Do optional answers move a user between training subpopulations?

The unified table stacks three sources with different variable coverage, so a
column that only one source collected has a missingness pattern that *is* the
source label. The model then learns "this field is blank, so this row is NHANES,
where the label was measured and prevalence is 18%" instead of learning anything
about the person.

At training time that is tolerable — per-source evaluation controls for it. At
serving time it is not: a user answering an optional question flips their row
between populations and the prediction jumps for no clinical reason.

Two measurements:

``coverage``
    Per serving feature, non-null share by source, and how well its missingness
    predicts the source. Anything near 1.0 is a source proxy, not a feature.

``sensitivity``
    Toggle each optional field on a fixed person and report how far the
    prediction moves. A field that swings the answer more than the required four
    do is a bug, not a signal.

    python modeling/diagnose_serving.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd
from train_risk import DATA

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services.risk import RiskModel  # noqa: E402

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
MODELS = ARTIFACTS / "models"

PERSON = {
    "age": 54,
    "sex": "M",
    "bmi": 27.72,
    "self_rated_health": 3,
}

# (label, payload delta) for each optional answer a user could give.
TOGGLES: list[tuple[str, dict]] = [
    ("veg_fruit_daily = 예", {"veg_fruit_daily": 1.0}),
    ("veg_fruit_daily = 아니오", {"veg_fruit_daily": 0.0}),
    ("difficulty_walking = 없음", {"difficulty_walking": 0.0}),
    ("difficulty_walking = 있음", {"difficulty_walking": 1.0}),
    ("smoking = never", {"smoking_status": "never"}),
    ("smoking = current", {"smoking_status": "current"}),
    ("waist_cm = 96", {"waist_cm": 96.0}),
    ("sbp/dbp = 130/82", {"sbp": 130.0, "dbp": 82.0}),
    ("sleep_hours = 7", {"sleep_hours": 7.0}),
    ("moderate_min = 150", {"moderate_min_per_week": 150.0}),
    ("vigorous_min = 60", {"vigorous_min_per_week": 60.0}),
    ("sedentary_min = 480", {"sedentary_min_per_day": 480.0}),
    ("alcohol_days = 52", {"alcohol_days_per_year": 52.0}),
]

# For scale: how much do the four required inputs move the answer?
REFERENCE_MOVES: list[tuple[str, dict]] = [
    ("건강 보통 -> 나쁨", {"self_rated_health": 4}),
    ("BMI 27.7 -> 31", {"bmi": 31.0}),
    ("나이 54 -> 64", {"age": 64}),
]


def coverage(unified: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    rows = []
    for column in features:
        present = unified[column].notna()
        entry: dict[str, object] = {"feature": column}
        for source, group in unified.groupby("source"):
            entry[str(source)] = round(float(group[column].notna().mean()), 3)

        # 결측 여부만 보고 출처를 맞힐 수 있는가. 1.0에 가까우면 출처 표시다.
        best = 0.0
        for source in unified["source"].unique():
            is_source = unified["source"].eq(source)
            for pattern in (present, ~present):
                agreement = float((pattern == is_source).mean())
                best = max(best, agreement)
        entry["출처_식별력"] = round(best, 3)
        rows.append(entry)
    return pd.DataFrame(rows).sort_values("출처_식별력", ascending=False)


def sensitivity(models: dict[str, RiskModel]) -> pd.DataFrame:
    rows = []
    baseline = {target: model.probability(PERSON) for target, model in models.items()}

    for label, delta in REFERENCE_MOVES + TOGGLES:
        entry: dict[str, object] = {
            "변경": label,
            "종류": "필수 입력 변화" if (label, delta) in REFERENCE_MOVES else "선택 항목 응답",
        }
        for target, model in models.items():
            moved = model.probability({**PERSON, **delta})
            entry[f"{target}_확률"] = round(moved, 4)
            entry[f"{target}_변화"] = round(moved - baseline[target], 4)
        rows.append(entry)

    frame = pd.DataFrame(rows)
    frame["최대_절대변화"] = frame[[c for c in frame.columns if c.endswith("_변화")]].abs().max(axis=1)
    return frame.sort_values("최대_절대변화", ascending=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--models", type=Path, default=MODELS)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "diagnose_serving.json")
    args = parser.parse_args()

    models = {}
    for path in sorted(args.models.glob("risk_*.json")):
        bundle = json.loads(path.read_text(encoding="utf-8"))
        models[bundle["target"]] = RiskModel(bundle)

    features = models["dm"].required + models["dm"].optional
    unified = pd.read_csv(args.data, low_memory=False)

    print("=" * 96)
    print("1. 서빙 입력의 출처별 커버리지")
    print("=" * 96)
    table = coverage(unified, [c for c in features if c in unified.columns])
    print(table.to_string(index=False))
    print()
    print("  출처_식별력: 결측 여부만으로 출처를 맞히는 정확도. 1.0에 가까우면 그 변수는")
    print("  사람에 대한 정보가 아니라 '어느 데이터셋에서 왔는지'를 말한다.")

    print()
    print("=" * 96)
    print(f"2. 응답 하나가 예측을 얼마나 움직이는가 (기준: {PERSON})")
    print("=" * 96)
    moves = sensitivity(models)
    print(moves.to_string(index=False))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(
            {"coverage": table.to_dict(orient="records"), "sensitivity": moves.to_dict(orient="records")},
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
