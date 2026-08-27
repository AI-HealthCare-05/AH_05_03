"""학습 테이블 탐색 — 분포·결측 구조·동반이환·연관.

`audit_features.py` 가 "무엇이 있고 얼마나 비었나"를 셌다면 이쪽은 **그 값들이
어떻게 생겼나**를 본다. 모델을 고치기 전에 데이터가 어떤 모양인지 알아야 하는데,
이 저장소에는 BRFSS 노트북 하나 말고 그 기록이 없다.

네 가지를 낸다.

1. **분포와 이상값** — 검사값에 단위 오류나 센티널이 남아 있으면 여기서 보인다.
2. **결측 구조** — 결측은 무작위가 아니다. "검진을 받았는가"가 한 덩어리로 움직이고
   그 덩어리가 곧 tier 를 가른다.
3. **동반이환** — 열 질환이 서로 얼마나 겹치는가. 카드를 열 장 띄우는 화면 설계와
   직결되고, 다중 라벨 학습을 할 값어치가 있는지도 여기서 갈린다.
4. **연관** — 타깃마다 어떤 입력이 실제로 갈리는가. 표준화 평균차로 잰다.

    ../.venv/Scripts/python.exe eda.py
    ../.venv/Scripts/python.exe eda.py --data data/processed/unified.csv
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

from targets import BASIC_FEATURES, LAB_FEATURES, TARGETS

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "processed" / "nhanes_pooled.csv"
ARTIFACTS = ROOT / "artifacts"

# 생리적으로 가능한 범위. 벗어난 값은 단위 오류나 코딩 사고를 의심한다.
# 진단 임계값이 아니라 **있을 수 없는 값**의 경계다 — 좁게 잡으면 진짜 환자를 지운다.
PLAUSIBLE: dict[str, tuple[float, float]] = {
    "age": (19, 100),
    "bmi": (12, 80),
    "height_cm": (120, 220),
    "weight_kg": (25, 300),
    "waist_cm": (50, 200),
    "sbp": (60, 260),
    "dbp": (30, 200),
    "fasting_glucose": (30, 700),
    "hba1c": (3, 20),
    "total_chol": (50, 600),
    "hdl": (5, 200),
    "ldl": (5, 500),
    "triglyceride": (10, 3000),
    "creatinine": (0.1, 20),
    "egfr": (2, 200),
    "ast": (1, 2000),
    "alt": (1, 2000),
    "ggt": (1, 3000),
    "uric_acid": (0.5, 30),
    "hemoglobin": (3, 25),
    "albumin": (1, 7),
    "urine_acr": (0, 20000),
    "sleep_hours": (0, 24),
    "weight_change_1yr_pct": (-70, 200),
}


def describe_numeric(frame: pd.DataFrame, columns: list[str]) -> list[dict[str, Any]]:
    rows = []
    for column in columns:
        if column not in frame.columns:
            continue
        series = pd.to_numeric(frame[column], errors="coerce")
        present = series.dropna()
        if present.empty:
            continue
        low, high = PLAUSIBLE.get(column, (-np.inf, np.inf))
        outside = int(((present < low) | (present > high)).sum())
        quantiles = present.quantile([0.01, 0.25, 0.5, 0.75, 0.99])
        rows.append(
            {
                "column": column,
                "n": int(present.size),
                "coverage": round(float(series.notna().mean()), 4),
                "mean": round(float(present.mean()), 3),
                "std": round(float(present.std()), 3),
                "p1": round(float(quantiles.iloc[0]), 3),
                "p25": round(float(quantiles.iloc[1]), 3),
                "median": round(float(quantiles.iloc[2]), 3),
                "p75": round(float(quantiles.iloc[3]), 3),
                "p99": round(float(quantiles.iloc[4]), 3),
                "skew": round(float(present.skew()), 3),
                # 같은 값이 몰려 있으면 코딩 사고를 의심한다. 0 이 대표적이다.
                "mode_share": round(float(present.value_counts(normalize=True).iloc[0]), 4),
                "implausible": outside,
            }
        )
    return rows


def missingness_blocks(frame: pd.DataFrame, columns: list[str]) -> dict[str, Any]:
    """결측이 함께 움직이는 덩어리를 찾는다.

    결측 지시자끼리의 상관을 보면 "같이 비는" 컬럼이 묶인다. 검진 하위표본,
    공복 채혈 하위표본, 특정 주기에만 있는 문항이 각각 한 덩어리로 나온다.
    """
    present = frame[[c for c in columns if c in frame.columns]].notna().astype(int)
    present = present.loc[:, present.nunique() > 1]
    if present.shape[1] < 2:
        return {"pairs": [], "note": "결측 변동이 있는 컬럼이 둘 미만"}
    correlation = present.corr()
    pairs = []
    names = list(correlation.columns)
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            value = correlation.loc[a, b]
            if pd.notna(value) and abs(value) >= 0.8:
                pairs.append({"a": a, "b": b, "r": round(float(value), 3)})
    pairs.sort(key=lambda row: -abs(row["r"]))
    return {"pairs": pairs[:40], "n_columns": int(present.shape[1])}


def comorbidity(frame: pd.DataFrame) -> dict[str, Any]:
    """열 질환이 서로 얼마나 겹치는가.

    두 값을 함께 낸다. **동시 유병률**은 둘 다 라벨이 있는 사람 중 둘 다 양성인 비율,
    **lift** 는 그 값을 독립 가정 기대치로 나눈 배수다. lift 가 1 이면 무관하고
    2 면 한쪽이 있을 때 다른 쪽이 두 배로 흔하다는 뜻이다.
    """
    keys = [k for k, t in TARGETS.items() if t.serve]
    labels = {k: frame[TARGETS[k].label].astype("boolean") for k in keys}
    rows = []
    for i, a in enumerate(keys):
        for b in keys[i + 1 :]:
            both = labels[a].notna() & labels[b].notna()
            n = int(both.sum())
            if n < 500:
                continue
            x, y = labels[a][both].astype(int), labels[b][both].astype(int)
            joint = float((x & y).mean())
            expected = float(x.mean()) * float(y.mean())
            rows.append(
                {
                    "a": TARGETS[a].name,
                    "b": TARGETS[b].name,
                    "n": n,
                    "prev_a": round(float(x.mean()), 4),
                    "prev_b": round(float(y.mean()), 4),
                    "joint": round(joint, 4),
                    "lift": round(joint / expected, 3) if expected > 0 else None,
                    # a 가 있을 때 b 의 조건부 유병률. 화면 문구를 쓸 때 이 값이 필요하다.
                    "p_b_given_a": round(float(y[x == 1].mean()), 4) if int(x.sum()) else None,
                }
            )
    rows.sort(key=lambda r: -(r["lift"] or 0))

    # 한 사람이 동시에 몇 개를 갖고 있는가.
    stacked = pd.DataFrame({k: labels[k] for k in keys})
    complete = stacked.dropna()
    counts = complete.sum(axis=1).value_counts().sort_index() if len(complete) else pd.Series(dtype=int)
    return {
        "pairs": rows,
        "n_complete": int(len(complete)),
        "count_distribution": {int(k): int(v) for k, v in counts.items()},
    }


def associations(frame: pd.DataFrame, target_key: str, columns: list[str]) -> list[dict[str, Any]]:
    """양성군과 음성군의 표준화 평균차(Cohen's d).

    AUROC 나 모델 중요도와 달리 방향과 크기를 함께 보여 주고, 다른 특징을 보정하지
    않으므로 "이 변수 하나만 봤을 때"의 그림이 된다. 혼란변수를 다 안고 있는 값이라
    인과로 읽으면 안 된다.
    """
    label = frame[TARGETS[target_key].label].astype("boolean")
    usable = label.notna()
    rows = []
    for column in columns:
        if column not in frame.columns:
            continue
        series = pd.to_numeric(frame.loc[usable, column], errors="coerce")
        y = label[usable].astype(int)
        positive, negative = series[y == 1].dropna(), series[y == 0].dropna()
        if len(positive) < 50 or len(negative) < 50:
            continue
        pooled = np.sqrt((positive.var() + negative.var()) / 2)
        if not np.isfinite(pooled) or pooled == 0:
            continue
        rows.append(
            {
                "column": column,
                "d": round(float((positive.mean() - negative.mean()) / pooled), 3),
                "mean_positive": round(float(positive.mean()), 3),
                "mean_negative": round(float(negative.mean()), 3),
                "n_positive": int(len(positive)),
            }
        )
    rows.sort(key=lambda r: -abs(r["d"]))
    return rows


def subgroup_prevalence(frame: pd.DataFrame) -> list[dict[str, Any]]:
    age = pd.to_numeric(frame["age"], errors="coerce")
    band = pd.cut(age, [19, 40, 50, 60, 70, 200], labels=["19-40", "40-50", "50-60", "60-70", "70+"], right=False)
    rows = []
    for target in TARGETS.values():
        if not target.serve:
            continue
        label = frame[target.label].astype("boolean")
        for sex in ("M", "F"):
            mask = label.notna() & frame["sex"].eq(sex)
            for name in band.cat.categories:
                cell = mask & band.eq(name)
                n = int(cell.sum())
                if n < 100:
                    continue
                rows.append(
                    {
                        "target": target.name,
                        "sex": sex,
                        "age_band": str(name),
                        "n": n,
                        "prevalence": round(float(label[cell].astype(int).mean()), 4),
                    }
                )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "eda.json")
    args = parser.parse_args()

    frame = pd.read_csv(args.data, low_memory=False)
    numeric_columns = [c for c in list(BASIC_FEATURES) + list(LAB_FEATURES) if c != "sex"]

    print(f"data: {args.data.name}  rows={len(frame):,}  columns={len(frame.columns)}\n")

    numeric = describe_numeric(frame, numeric_columns)
    print("분포 — 생리적 범위를 벗어난 값과 최빈값 점유율")
    print(f"{'컬럼':<24}{'n':>8}{'중앙':>10}{'p1':>9}{'p99':>10}{'왜도':>8}{'최빈%':>8}{'이상값':>7}")
    for row in numeric:
        flag = "  ←" if row["implausible"] or row["mode_share"] > 0.3 else ""
        print(
            f"{row['column']:<24}{row['n']:>8,}{row['median']:>10.2f}{row['p1']:>9.2f}"
            f"{row['p99']:>10.2f}{row['skew']:>8.2f}{row['mode_share'] * 100:>7.1f}%{row['implausible']:>7,}{flag}"
        )

    blocks = missingness_blocks(frame, numeric_columns)
    print(f"\n결측이 함께 움직이는 쌍 (|r| >= 0.8) — {len(blocks['pairs'])}개")
    for pair in blocks["pairs"][:12]:
        print(f"  {pair['a']:<24}{pair['b']:<24}r={pair['r']:+.3f}")

    co = comorbidity(frame)
    print(f"\n동반이환 — 열 질환 라벨이 모두 있는 {co['n_complete']:,}명")
    print("  질환 수 분포: " + ", ".join(f"{k}개={v:,}" for k, v in co["count_distribution"].items()))
    print(f"  {'질환 A':<16}{'질환 B':<16}{'동시':>8}{'lift':>7}{'A|B':>8}")
    for pair in co["pairs"][:12]:
        print(f"  {pair['a']:<16}{pair['b']:<16}{pair['joint']:>8.3f}{pair['lift']:>7.2f}{pair['p_b_given_a']:>8.3f}")

    assoc = {}
    for key, target in TARGETS.items():
        if not target.serve:
            continue
        allowed = [c for c in target.features("lab") if c in numeric_columns]
        assoc[key] = associations(frame, key, allowed)
    print("\n타깃별 상위 연관 (Cohen's d, 차단된 변수는 제외)")
    for key, rows in assoc.items():
        top = ", ".join(f"{r['column']} {r['d']:+.2f}" for r in rows[:4])
        print(f"  {TARGETS[key].name:<16}{top}")

    payload = {
        "data": str(args.data),
        "rows": int(len(frame)),
        "numeric": numeric,
        "missingness": blocks,
        "comorbidity": co,
        "associations": assoc,
        "subgroups": subgroup_prevalence(frame),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n→ {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
