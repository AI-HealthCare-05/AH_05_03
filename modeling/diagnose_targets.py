"""당뇨 모델이 정말 고혈압 모델보다 못하는가.

화면에서 당뇨만 규칙 엔진과 어긋나 보이는 것이 **모델 성능 차이인지 표시 문제인지**
가리기 위한 진단이다. 두 가지는 처방이 정반대다. 성능 문제면 데이터를 더 구해야 하고,
표시 문제면 데이터를 아무리 구해도 그대로다.

배포된 서빙 모델(`app/services/risk.py`)로 NHANES holdout 주기를 직접 채점하고
세 갈래로 나눠 본다.

``overall``
    라벨 전체. 배포된 모델의 holdout AUROC 와 같아야 한다.

``undiagnosed``
    이미 진단받은 양성을 빼고 다시 잰다. 선별 제품이 실제로 찾아야 하는 사람은
    "자기가 당뇨인 줄 모르는 사람"이다. 진단자를 알아맞히는 것은 쉽고 값어치가 없다.

``by_age``
    연령대별. 고령에서 무너지는지 본다.

    python modeling/diagnose_targets.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd
from sklearn.metrics import roc_auc_score
from splits import SEED
from train_risk import DATA

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services.risk import RiskModel  # noqa: E402

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
MODELS = ARTIFACTS / "models"
HOLDOUT_CYCLE = "2021_2023"

# 서빙 모델이 받는 입력. 표에 있는 것만 넘긴다.
SERVING_INPUTS = [
    "age",
    "sex",
    "bmi",
    "self_rated_health",
    "waist_cm",
    "smoking_status",
    "difficulty_walking",
    "alcohol_days_per_year",
    "moderate_min_per_week",
    "vigorous_min_per_week",
    "sedentary_min_per_day",
    "sleep_hours",
    "sbp",
    "dbp",
]

TARGETS = {
    "dm": {
        "prevalent": "label_dm_prevalent",
        "undiagnosed": "label_dm_undiagnosed",
        "name": "당뇨",
    },
    "htn": {
        "prevalent": "label_htn_prevalent",
        "undiagnosed": "label_htn_undiagnosed",
        "name": "고혈압",
    },
}

AGE_BANDS = [(19, 40), (40, 50), (50, 60), (60, 70), (70, 200)]


def payloads(frame: pd.DataFrame) -> list[dict]:
    columns = [c for c in SERVING_INPUTS if c in frame.columns]
    rows = []
    for record in frame[columns].to_dict(orient="records"):
        rows.append({k: v for k, v in record.items() if pd.notna(v)})
    return rows


def safe_auroc(y: pd.Series, scores: pd.Series) -> float | None:
    # 라벨이 nullable boolean 이라 그대로 넘기면 sklearn 이 dtype 을 못 읽는다.
    labels = pd.to_numeric(y, errors="coerce")
    keep = labels.notna() & scores.notna()
    labels, scores = labels[keep].astype(int), scores[keep]
    if labels.nunique() < 2 or len(labels) < 50:
        return None
    return float(roc_auc_score(labels, scores))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--models", type=Path, default=MODELS)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "diagnose_targets.json")
    args = parser.parse_args()

    unified = pd.read_csv(args.data, low_memory=False)
    holdout = unified[unified["source"].eq("nhanes_pooled") & unified["cycle"].eq(HOLDOUT_CYCLE)].reset_index(drop=True)
    print(f"holdout: NHANES {HOLDOUT_CYCLE} · {len(holdout):,}행 · seed {SEED}")

    report: dict = {"holdout_cycle": HOLDOUT_CYCLE, "rows": len(holdout), "targets": {}}
    scored = holdout.copy()

    for key, spec in TARGETS.items():
        bundle = json.loads((args.models / f"risk_{key}.json").read_text(encoding="utf-8"))
        model = RiskModel(bundle)
        scored[f"p_{key}"] = [model.raw_probability(p) for p in payloads(holdout)]

        prevalent = scored[spec["prevalent"]]
        undiagnosed = scored[spec["undiagnosed"]]
        usable = prevalent.notna() & scored[f"p_{key}"].notna()

        entry: dict = {"name": spec["name"]}
        entry["overall"] = {
            "n": int(usable.sum()),
            "positives": int(prevalent[usable].sum()),
            "rate": round(float(prevalent[usable].mean()), 4),
            "auroc": safe_auroc(prevalent[usable], scored.loc[usable, f"p_{key}"]),
        }

        # 이미 진단받은 양성을 뺀다. 남는 것은 음성 + 미진단 양성.
        diagnosed_positive = prevalent.eq(1) & undiagnosed.ne(1)
        subset = usable & ~diagnosed_positive & undiagnosed.notna()
        entry["undiagnosed"] = {
            "n": int(subset.sum()),
            "positives": int(undiagnosed[subset].sum()),
            "rate": round(float(undiagnosed[subset].mean()), 4),
            "auroc": safe_auroc(undiagnosed[subset], scored.loc[subset, f"p_{key}"]),
        }

        entry["by_age"] = []
        for low, high in AGE_BANDS:
            band = usable & scored["age"].ge(low) & scored["age"].lt(high)
            entry["by_age"].append(
                {
                    "band": f"{low}-{high if high < 200 else '+'}",
                    "n": int(band.sum()),
                    "rate": round(float(prevalent[band].mean()), 4) if band.sum() else None,
                    "auroc": safe_auroc(prevalent[band], scored.loc[band, f"p_{key}"]),
                }
            )
        report["targets"][key] = entry

    print()
    print("=" * 88)
    print("1. 라벨 전체 vs 미진단자만")
    print("=" * 88)
    print(f"  {'':6s} {'전체 AUROC':>12s} {'유병률':>8s}    {'미진단 AUROC':>13s} {'미진단률':>9s}")
    for entry in report["targets"].values():
        o, u = entry["overall"], entry["undiagnosed"]
        print(f"  {entry['name']:6s} {o['auroc']:12.3f} {o['rate']:8.3f}    {u['auroc']:13.3f} {u['rate']:9.3f}")
    print()
    print("  전체 AUROC 는 이미 진단받은 사람을 알아맞히는 몫이 섞여 있다. 그 사람들은")
    print("  주관적 건강이 나쁘고 동반질환이 있어 쉽게 잡힌다. 선별 제품이 찾아야 하는")
    print("  사람은 미진단자다.")

    print()
    print("=" * 88)
    print("2. 연령대별 (라벨 전체)")
    print("=" * 88)
    header = "  연령    " + "".join(f"{entry['name']:>18s}" for entry in report["targets"].values())
    print(header)
    for index, band in enumerate(AGE_BANDS):
        label = f"{band[0]}-{band[1] if band[1] < 200 else '+'}"
        cells = ""
        for entry in report["targets"].values():
            row = entry["by_age"][index]
            cells += f"{row['auroc']:>11.3f} (n={row['n']:>4d})" if row["auroc"] else f"{'-':>18s}"
        print(f"  {label:8s}{cells}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
