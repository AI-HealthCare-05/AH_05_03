"""주기 드리프트 — 학습 주기와 홀드아웃 주기가 얼마나 다른가.

왜 따로 재나
------------
`eda.py` 는 테이블을 **한 덩어리로** 본다(분포·결측·동반이환·연관). 그런데 이
저장소의 평가는 무작위 분할이 아니라 **주기 분할**이다. 2005–2018 로 배우고
2021–2023 을 맞힌다. 그러면 표본 차이가 아니라 **조사 설계 차이**가 성능에 섞인다.

`docs/21_modeling_overview.md` §2.1 이 그 차이를 이미 표로 적어 뒀다.

    혈압      2005–2018 `BPX` 청진식(최대 4회)  →  2021–2023 `BPXO` 오실로메트릭(3회)
    신체활동  긴 GPAQ 형식                      →  짧은 여가활동 형식
    음주      `ALQ120Q` + 단위                  →  `ALQ121` 빈도 범주
    가족력    `MCQ300A`/`MCQ300C`               →  **없음**
    보행 곤란 `PFQ061B`                         →  **없음**

혈압은 이 제품의 핵심 입력이다. 재는 방법이 바뀌면 같은 사람도 다른 값이 나온다.
그런데 지금까지 그 이동을 **잰 적이 없다** — `eda.json` 에 `cycle` 이라는 낱말이
한 번도 나오지 않는다.

특히 잡으려는 것 — 홀드아웃에 없는 변수
----------------------------------------
홀드아웃 주기에 **아예 없는** 특징은 기여도가 자동으로 0 으로 측정된다. 모델이 그
변수를 안 쓰는 게 아니라 **잴 수가 없는** 것인데, 표에는 "쓸모없음" 으로 찍힌다.
이 저장소는 그 함정을 이미 한 번 밟았다(가족력을 그 근거로 기각할 뻔했다). 여기서는
그걸 변수 하나가 아니라 **전수로** 본다.

무엇을 내나
-----------
1. **주기별 라벨 유병률** — 라벨 자체가 흔들리면 보정이 먼저 깨진다.
2. **주기별 커버리지** — 어느 주기에서 변수가 사라지는가. 홀드아웃 0% 는 따로 표시한다.
3. **학습 ↔ 홀드아웃 표준화 평균차(SMD)** — 값의 이동. |SMD| ≥ 0.1 이면 표시한다.

SMD 를 쓰는 이유는 단위에 무관하기 때문이다. mmHg 와 mg/dL 를 같은 표에 놓고
"어느 쪽이 더 움직였나" 를 물으려면 단위를 지워야 한다.

    ../.venv/Scripts/python.exe eda_drift.py
    ../.venv/Scripts/python.exe eda_drift.py --holdout 2021_2023
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

from targets import BASIC_FEATURES, CATEGORICAL, LAB_FEATURES, TARGETS  # noqa: E402

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "processed" / "nhanes_pooled.csv"
ARTIFACTS = ROOT / "artifacts"

# |SMD| 가 이 위면 "옮겨갔다" 고 본다. 관례값이고, 짝짓기 연구에서 균형이 깨졌다고
# 판정하는 경계와 같다.
SMD_FLAG = 0.1


def standardised_difference(train: pd.Series, holdout: pd.Series) -> float | None:
    """두 집단 평균차를 합동 표준편차로 나눈다. 단위가 지워져 변수끼리 견줄 수 있다."""
    a = train.dropna().astype(float)
    b = holdout.dropna().astype(float)
    if len(a) < 30 or len(b) < 30:
        return None
    pooled = np.sqrt((a.var(ddof=1) + b.var(ddof=1)) / 2)
    if not np.isfinite(pooled) or pooled == 0:
        return None
    return round(float((b.mean() - a.mean()) / pooled), 4)


def label_prevalence(data: pd.DataFrame, cycles: list[str]) -> list[dict[str, Any]]:
    """주기별 라벨 유병률. 라벨이 흔들리면 확률 보정이 먼저 깨진다."""
    rows = []
    cycle = data["cycle"].astype(str)
    for key, target in TARGETS.items():
        if target.label not in data.columns:
            continue
        label = data[target.label].astype("boolean")
        entry: dict[str, Any] = {"target": key, "name": target.name, "by_cycle": {}}
        for name in cycles:
            mask = cycle.eq(name)
            labelled = label[mask]
            n = int(labelled.notna().sum())
            entry["by_cycle"][name] = {
                "labelled": n,
                "prevalence": round(float(labelled.sum(skipna=True) / n), 4) if n else None,
            }
        seen = [v["prevalence"] for v in entry["by_cycle"].values() if v["prevalence"] is not None]
        if seen:
            entry["spread"] = round(max(seen) - min(seen), 4)
        rows.append(entry)
    return sorted(rows, key=lambda r: r.get("spread") or 0, reverse=True)


def coverage_by_cycle(data: pd.DataFrame, columns: list[str], cycles: list[str], holdout: str) -> list[dict[str, Any]]:
    """주기별 결측 아닌 비율. 홀드아웃에서 0 이 되는 변수를 따로 표시한다."""
    rows = []
    cycle = data["cycle"].astype(str)
    for column in columns:
        if column not in data.columns:
            continue
        by_cycle = {}
        for name in cycles:
            mask = cycle.eq(name)
            n = int(mask.sum())
            by_cycle[name] = round(float(data.loc[mask, column].notna().sum() / n), 4) if n else None
        train_values = [v for name, v in by_cycle.items() if name != holdout and v is not None]
        entry = {
            "column": column,
            "by_cycle": by_cycle,
            "train_mean": round(float(np.mean(train_values)), 4) if train_values else None,
            "holdout": by_cycle.get(holdout),
        }
        # **홀드아웃에 없는 변수.** 학습에는 있는데 평가 주기에 없으면 기여도가
        # 0 으로 측정된다 — 쓸모없어서가 아니라 잴 수가 없어서다.
        entry["unmeasurable_on_holdout"] = bool(
            entry["holdout"] is not None and entry["holdout"] < 0.01 and (entry["train_mean"] or 0) > 0.5
        )
        rows.append(entry)
    return sorted(
        rows, key=lambda r: (not r["unmeasurable_on_holdout"], r["holdout"] if r["holdout"] is not None else 1)
    )


def value_shift(data: pd.DataFrame, columns: list[str], holdout: str) -> list[dict[str, Any]]:
    """학습 ↔ 홀드아웃 표준화 평균차. 커버리지가 아니라 **값**의 이동을 본다."""
    rows = []
    cycle = data["cycle"].astype(str)
    is_holdout = cycle.eq(holdout)
    for column in columns:
        if column not in data.columns or column in CATEGORICAL:
            continue
        series = pd.to_numeric(data[column], errors="coerce")
        smd = standardised_difference(series[~is_holdout], series[is_holdout])
        if smd is None:
            continue
        rows.append(
            {
                "column": column,
                "train_mean": round(float(series[~is_holdout].mean()), 3),
                "holdout_mean": round(float(series[is_holdout].mean()), 3),
                "smd": smd,
                "shifted": abs(smd) >= SMD_FLAG,
            }
        )
    return sorted(rows, key=lambda r: abs(r["smd"]), reverse=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--holdout", default="2021_2023")
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "eda_drift.json")
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    cycles = sorted(data["cycle"].astype(str).unique())
    if args.holdout not in cycles:
        print(f"홀드아웃 주기 {args.holdout} 이 데이터에 없다. 있는 것: {cycles}")
        return 1

    columns = sorted(set(BASIC_FEATURES) | set(LAB_FEATURES))
    prevalence = label_prevalence(data, cycles)
    coverage = coverage_by_cycle(data, columns, cycles, args.holdout)
    shift = value_shift(data, columns, args.holdout)

    print(f"data: {args.data.name}  rows={len(data):,}  주기 {len(cycles)}개  홀드아웃 {args.holdout}\n")

    print("=" * 96)
    print("홀드아웃에서 잴 수 없는 특징 — 학습에는 있는데 평가 주기에 없다")
    print("=" * 96)
    blind = [r for r in coverage if r["unmeasurable_on_holdout"]]
    if blind:
        print(f"  {'특징':<28}{'학습 커버리지':>14}{'홀드아웃':>10}")
        for row in blind:
            print(f"  {row['column']:<28}{row['train_mean']:>14.3f}{row['holdout']:>10.3f}")
        print("\n  이 변수들의 '기여 없음' 은 측정할 수 없었다는 뜻이지 쓸모없다는 뜻이 아니다.")
    else:
        print("  없음.")
    print()

    print("=" * 96)
    print(f"값이 옮겨간 특징 — 학습 ↔ 홀드아웃 표준화 평균차 |SMD| ≥ {SMD_FLAG}")
    print("=" * 96)
    print(f"  {'특징':<28}{'학습 평균':>12}{'홀드아웃':>12}{'SMD':>9}")
    for row in [r for r in shift if r["shifted"]][:20]:
        print(f"  {row['column']:<28}{row['train_mean']:>12.3f}{row['holdout_mean']:>12.3f}{row['smd']:>+9.3f}")
    print()

    print("=" * 96)
    print("주기별 라벨 유병률 — 폭이 큰 순")
    print("=" * 96)
    head = "  " + f"{'질환':<20}" + "".join(f"{c[2:4] + '-' + c[7:9]:>9}" for c in cycles) + f"{'폭':>8}"
    print(head)
    for row in prevalence[:10]:
        cells = "".join(
            f"{(row['by_cycle'][c]['prevalence'] or 0):>9.3f}"
            if row["by_cycle"][c]["prevalence"] is not None
            else f"{'-':>9}"
            for c in cycles
        )
        print(f"  {row['name']:<20}{cells}{row.get('spread', 0):>8.3f}")
    print()

    payload = {
        "data": str(args.data),
        "rows": int(len(data)),
        "cycles": cycles,
        "holdout": args.holdout,
        "smd_flag": SMD_FLAG,
        "unmeasurable_on_holdout": [r["column"] for r in blind],
        "coverage": coverage,
        "value_shift": shift,
        "label_prevalence": prevalence,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
