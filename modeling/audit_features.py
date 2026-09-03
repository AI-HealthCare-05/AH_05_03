"""피처·표본 실측 감사 — 무엇을 쓰고 있고, 무엇이 남아 있고, 표본이 충분한가.

`train_multi.py` 는 성능을 재고 이 스크립트는 **재료**를 잰다. 셋을 답한다.

1. 학습 테이블에 어떤 컬럼이 실제로 채워져 있는가 (스키마가 아니라 결측률)
2. 질환마다 쓰는 피처가 몇 개고, 그 피처가 그 질환의 학습 표본에서 얼마나 비는가
3. 표본이 충분한가 — 양성 사건 수를 변수 수로 나눈 EPV 로 판정한다

3번이 이 파일의 존재 이유다. "표본을 늘려도 AUROC 가 안 움직였다"(21번 §4.7)는
전체 표본에 대한 말이고, 질환별로는 사정이 다르다. 지방간은 CAP 이 두 주기에만
있고 고중성지방혈증은 공복 채혈 하위표본만 잰다. 그 둘은 표본이 천장일 수 있다.

    python modeling/audit_features.py
    python modeling/audit_features.py --data modeling/data/processed/unified.csv
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd

from data import schema
from splits import make_split
from targets import BASIC_FEATURES, CATEGORICAL, DERIVED, LAB_FEATURES, TARGETS

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "processed" / "nhanes_pooled.csv"
ARTIFACTS = ROOT / "artifacts"

# 회귀 계수 하나를 안정적으로 추정하는 데 필요한 양성 사건 수. Peduzzi 1996 의
# 10 이 오랜 관행이고, van Smeden 2019 는 더 낮아도 된다고 본다. 판정이 아니라
# 신호로 쓴다 — 10 미만이면 그 질환은 "모델을 더 손보기 전에 표본"이 답이다.
EPV_FLOOR = 10.0
LAB_PRESENT_RATIO = 0.6  # train_multi.lab_present 와 같은 규칙


def lab_present(frame: pd.DataFrame, lab_columns: list[str]) -> pd.Series:
    if not lab_columns:
        return pd.Series(True, index=frame.index)
    return frame[lab_columns].notna().mean(axis=1) >= LAB_PRESENT_RATIO


def design_width(frame: pd.DataFrame, columns: list[str]) -> int:
    """원-핫 전개 후의 실제 변수 수. 범주형은 (수준-1) 개를 차지한다."""
    width = 0
    for column in columns:
        if column in CATEGORICAL and column in frame.columns:
            width += max(int(frame[column].nunique(dropna=True)) - 1, 1)
        else:
            width += 1
    return width


def coverage_table(frame: pd.DataFrame, columns: list[str]) -> dict[str, float]:
    return {c: round(float(frame[c].notna().mean()), 4) if c in frame.columns else 0.0 for c in columns}


def audit_target(data: pd.DataFrame, key: str) -> list[dict[str, Any]]:
    target = TARGETS[key]
    label = data[target.label].astype("boolean")
    basic_columns = set(target.features("basic"))
    lab_only = [c for c in target.features("lab") if c not in basic_columns and c not in DERIVED]

    rows: list[dict[str, Any]] = []
    for tier in target.tiers:
        usable = label.notna()
        if tier == "lab":
            usable = usable & lab_present(data, lab_only)
        subset = data.loc[usable]
        y = label[usable]
        positives = int(y.sum(skipna=True))

        columns = [c for c in target.features(tier) if c not in DERIVED]
        entry: dict[str, Any] = {
            "target": key,
            "name": target.name,
            "tier": tier,
            "serve": target.serve,
            "labelled_rows": int(len(subset)),
            "positives": positives,
            "prevalence": round(positives / len(subset), 4) if len(subset) else 0.0,
            "n_features": len(target.features(tier)),
            "blocked": sorted(target.blocked),
            "feature_coverage": coverage_table(subset, columns),
        }

        if len(subset):
            cycle = subset["cycle"].astype(str)
            try:
                split = make_split(cycle, target.holdout_cycle)
                train_positives = int(y.loc[split.train_index].sum(skipna=True))
                width = design_width(subset, columns)
                entry.update(
                    {
                        "train_rows": int(len(split.train_index)),
                        "holdout_rows": int(len(split.holdout_index)),
                        "holdout_positives": int(y.loc[split.holdout_index].sum(skipna=True)),
                        "train_positives": train_positives,
                        "design_width": width,
                        "epv": round(train_positives / width, 2) if width else 0.0,
                    }
                )
            except (ValueError, KeyError) as error:
                entry["split_error"] = str(error)

        # 완결 사례 — 피처가 하나도 안 비는 행. 결측 대치가 얼마나 무거운 일인지.
        if columns:
            present = subset[[c for c in columns if c in subset.columns]]
            entry["complete_case_ratio"] = round(float(present.notna().all(axis=1).mean()), 4) if len(present) else 0.0
        rows.append(entry)
    return rows


def unused_columns(data: pd.DataFrame) -> list[dict[str, Any]]:
    """스키마에는 있는데 어느 모델도 안 쓰는 컬럼. 정밀화의 후보 목록이다."""
    used = set(BASIC_FEATURES) | set(LAB_FEATURES)
    candidates = [c for c in schema.FEATURE_COLUMNS + schema.LAB_COLUMNS if c not in used]
    rows = []
    for column in candidates:
        coverage = float(data[column].notna().mean()) if column in data.columns else 0.0
        group = "lab" if column in schema.LAB_COLUMNS else "basic"
        rows.append({"column": column, "group": group, "coverage": round(coverage, 4)})
    return sorted(rows, key=lambda r: -r["coverage"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "feature_audit.json")
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    print(f"data: {args.data.name}  rows={len(data):,}  columns={len(data.columns)}")
    if "cycle" in data.columns:
        counts = data["cycle"].astype(str).value_counts().sort_index()
        print("cycles: " + ", ".join(f"{k}={v:,}" for k, v in counts.items()))
    print()

    audits: list[dict[str, Any]] = []
    for key in TARGETS:
        audits.extend(audit_target(data, key))

    header = f"{'질환':<14}{'tier':<7}{'라벨행':>8}{'양성':>7}{'유병률':>8}{'변수':>5}{'학습양성':>8}{'EPV':>7}{'완결':>7}"
    print(header)
    print("-" * 78)
    for entry in audits:
        flag = "" if entry.get("epv", 0) >= EPV_FLOOR else "  ← 표본 부족"
        print(
            f"{entry['name']:<14}{entry['tier']:<7}{entry['labelled_rows']:>8,}{entry['positives']:>7,}"
            f"{entry['prevalence']:>8.3f}{entry['n_features']:>5}{entry.get('train_positives', 0):>8,}"
            f"{entry.get('epv', 0):>7.1f}{entry.get('complete_case_ratio', 0):>7.2f}{flag}"
        )

    unused = unused_columns(data)
    print("\n미사용 컬럼 (스키마에 있으나 어느 tier 도 안 쓴다)")
    for row in unused:
        print(f"  {row['column']:<28}{row['group']:<7}커버리지 {row['coverage']:.3f}")

    payload = {
        "data": str(args.data),
        "rows": int(len(data)),
        "targets": audits,
        "unused_columns": unused,
        "basic_features": list(BASIC_FEATURES),
        "lab_features": list(LAB_FEATURES),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n→ {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
