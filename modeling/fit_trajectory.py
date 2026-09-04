"""기준 위험표 — 발병 궤적이 읽는 `trajectory.json` 을 만든다.

`app/services/trajectory.py` 는 개인 곡선을 **인구 기준 위험표 × 상대위험** 으로 낸다.
이 스크립트가 그 표를 만든다. 두 재료다.

1. **연령·성별 유병률 곡선** — NHANES 8개 주기 성인의 한 살 간격 유병률.
   `baseline_from_prevalence` 가 다듬고(±3년 이동평균 → 누적최댓값) illness-death
   모형으로 뒤집어 연도별 발병 위험 h(a) 를 만든다.
2. **초과사망률 δ** — 같은 사람이 죽으면 유병률에서 빠진다. 당뇨 환자는 비환자보다
   먼저 죽으므로 70대 유병률이 60대와 비슷해 보여도 발병이 멈춘 게 아니다. NCHS
   사망연계(`data/load_mortality.py`)로 연령대별 **유병자 − 비유병자 사망률** 을 재서
   h(a) 에 p·δ 로 더한다. 음수면(고령 고혈압처럼 비환자 쪽도 다른 이유로 많이 죽는
   구간) 0 으로 접는다.

산출물은 서빙 디렉터리의 `trajectory.json` 하나다. 번들 안에 넣지 않는 이유는 이 표가
**모델이 아니라 인구와 라벨의 성질**이라 재export 와 무관해야 하기 때문이다. 대신
`validate_trajectory.py` 가 써 넣는 `evidence` 는 다시 만들 때 옮겨 담는다
(`bundle_io.carry_over` 와 같은 이유).

**표의 출처를 바꾸는 자리가 여기다.** 진짜 코호트 발생률(HRS·한국의료패널·NHIS
표본코호트)이 들어오면 `baseline` 을 관찰된 h(a) 로 갈아 끼우고 `source` 를 고친다.
서빙 코드는 건드릴 것이 없다.

    ../.venv/Scripts/python.exe fit_trajectory.py
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent / "data"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from targets import TARGETS  # noqa: E402

from app.services.trajectory import (  # noqa: E402
    AGE_CAP,
    AGE_FLOOR,
    METHOD,
    TRAJECTORY_FILE,
    TRAJECTORY_TARGETS,
    baseline_from_prevalence,
)

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "processed" / "nhanes_pooled.csv"
MORTALITY = ROOT / "data" / "processed" / "mortality.csv"
OUT = ROOT / "artifacts" / "models" / TRAJECTORY_FILE

#: δ 를 재는 연령대. `validate_mortality.py` 의 세 구간에 75세를 더 갈랐다 — 당뇨의
#: 초과사망이 65-75 에서 0.013, 75+ 에서 0.018 로 한 구간에 묶기엔 차이가 크다.
AGE_BANDS: tuple[tuple[int, int], ...] = ((19, 50), (50, 65), (65, 75), (75, 200))

#: 연계본이 있는 주기. 2021-2023 은 아직 없다.
LINKED_CYCLES: tuple[str, ...] = (
    "2005_2006",
    "2007_2008",
    "2009_2010",
    "2011_2012",
    "2013_2014",
    "2015_2016",
    "2017_2018",
)

SEXES = ("M", "F")


def to_bool(series: pd.Series) -> pd.Series:
    """CSV 왕복으로 문자열이 된 불리언을 되돌린다. 결측은 결측으로 둔다."""
    return series.map({True: True, False: False, "True": True, "False": False}).astype("boolean")


def link(data: pd.DataFrame, mortality: pd.DataFrame) -> pd.DataFrame:
    """학습 테이블에 사망연계를 붙인다. 연계 대상이고 추적 기간이 양수인 행만 남는다.

    학습 테이블의 subject_id 는 `2005_2006_31130` 처럼 주기가 접두사이고 사망연계는
    SEQN 원본이다. 마지막 밑줄 뒤가 SEQN 이다 — `validate_mortality.py` 와 같은 규칙.
    """
    left = data.copy()
    left["seqn"] = pd.to_numeric(left["subject_id"].astype(str).str.rsplit("_", n=1).str[-1], errors="coerce")
    right = mortality.copy()
    right["seqn"] = pd.to_numeric(right["subject_id"], errors="coerce")
    right["deceased"] = to_bool(right["deceased"])
    merged = left.merge(
        right[["seqn", "cycle", "deceased", "followup_years", "cause", "death_diabetes", "death_hypertension"]],
        on=["seqn", "cycle"],
        how="inner",
    )
    return merged[merged["deceased"].notna() & merged["followup_years"].gt(0)].reset_index(drop=True)


def excess_table(
    frame: pd.DataFrame,
    label: str,
    *,
    bands: tuple[tuple[int, int], ...] = AGE_BANDS,
    age: str = "age",
    deceased: str = "deceased",
    years: str = "followup_years",
) -> list[dict[str, Any]]:
    """연령대별 δ. 유병자·비유병자의 1인년당 사망률과 그 차이를 같이 남긴다.

    차이가 음수면 `per_year` 는 0 이고 `rate_difference` 에 원값이 남는다 — 접었다는
    사실을 숨기지 않는다.
    """
    status = to_bool(frame[label])
    dead = to_bool(frame[deceased]).fillna(False).astype(bool)
    followup = pd.to_numeric(frame[years], errors="coerce").fillna(0.0)
    ages = pd.to_numeric(frame[age], errors="coerce")
    rows: list[dict[str, Any]] = []
    for low, high in bands:
        in_band = ages.ge(low) & ages.lt(high) & status.notna()
        pos = in_band & status.eq(True)
        neg = in_band & status.eq(False)
        py_pos, py_neg = float(followup[pos].sum()), float(followup[neg].sum())
        d_pos, d_neg = int(dead[pos].sum()), int(dead[neg].sum())
        rate_pos = d_pos / py_pos if py_pos > 0 else float("nan")
        rate_neg = d_neg / py_neg if py_neg > 0 else float("nan")
        difference = rate_pos - rate_neg if py_pos > 0 and py_neg > 0 else float("nan")
        rows.append(
            {
                "age_from": low,
                "age_to": high,
                "per_year": round(max(difference, 0.0), 5) if difference == difference else 0.0,
                "rate_difference": round(difference, 5) if difference == difference else None,
                "rate_ratio": round(rate_pos / rate_neg, 3) if rate_neg and rate_neg > 0 else None,
                "n_positive": int(pos.sum()),
                "n_negative": int(neg.sum()),
                "deaths_positive": d_pos,
                "deaths_negative": d_neg,
                "person_years_positive": round(py_pos, 1),
                "person_years_negative": round(py_neg, 1),
            }
        )
    return rows


def prevalence_by_age(
    frame: pd.DataFrame,
    label: str,
    *,
    sex: str | None,
    age_from: int = AGE_FLOOR,
    age_to: int = AGE_CAP,
    age: str = "age",
    sex_column: str = "sex",
    minimum: int = 30,
) -> list[float | None]:
    """한 살 간격 유병률. 표본이 `minimum` 미만인 나이는 None(다듬기에서 건너뛴다)."""
    status = to_bool(frame[label])
    ages = pd.to_numeric(frame[age], errors="coerce").round()
    keep = status.notna() & ages.notna()
    if sex is not None:
        keep &= frame[sex_column].astype(str).eq(sex)
    grouped = status[keep].astype(float).groupby(ages[keep])
    means, counts = grouped.mean(), grouped.count()
    out: list[float | None] = []
    for value in range(age_from, age_to + 1):
        n = int(counts.get(value, 0))
        out.append(float(means[value]) if n >= minimum else None)
    return out


def baseline_table(
    frame: pd.DataFrame, label: str, bands: list[dict[str, Any]], *, sexes: tuple[str, ...] = SEXES
) -> dict[str, Any]:
    """성별 → 다듬은 유병률 + 연도별 기준 발병 위험."""
    return {
        sex: baseline_from_prevalence(prevalence_by_age(frame, label, sex=sex), AGE_FLOOR, bands=bands) for sex in sexes
    }


def carry_over_evidence(path: Path) -> dict[str, dict[str, Any]]:
    """이전 파일의 `evidence` 를 살린다. 검증 스크립트가 쓴 것이라 여기서는 못 만든다."""
    if not path.exists():
        return {}
    try:
        previous = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    targets = previous.get("targets", {}) if isinstance(previous, dict) else {}
    return {
        key: value["evidence"] for key, value in targets.items() if isinstance(value, dict) and value.get("evidence")
    }


def ten_year(curve: dict[str, Any], age: int) -> float:
    """표에서 읽는 동년배 10년 누적 발병 — 출력용."""
    import math

    index = age - int(curve["age_from"])
    return 1.0 - math.exp(-sum(curve["hazard"][index : index + 10]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--mortality", type=Path, default=MORTALITY)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    mortality = pd.read_csv(args.mortality, low_memory=False)
    linked = link(data, mortality)
    linked = linked[linked["cycle"].astype(str).isin(LINKED_CYCLES)]
    print(
        f"유병률 곡선 {len(data):,}행(8개 주기) / 사망연계 {len(linked):,}행 "
        f"사망 {int(to_bool(linked['deceased']).sum()):,} ({LINKED_CYCLES[0]}~{LINKED_CYCLES[-1]})\n"
    )

    evidence = carry_over_evidence(args.out)
    targets: dict[str, dict[str, Any]] = {}
    for key, reason in TRAJECTORY_TARGETS.items():
        target = TARGETS[key]
        bands = excess_table(linked, target.label)
        baseline = baseline_table(data, target.label, bands)
        targets[key] = {
            "name": target.name,
            "label": target.label,
            "why_enabled": reason,
            "excess_mortality": bands,
            "baseline": baseline,
            "evidence": evidence.get(key),
        }
        print(f"{target.name}")
        print(
            "  δ/년   "
            + "  ".join(
                f"{b['age_from']}-{b['age_to'] if b['age_to'] < 200 else '':<3} {b['per_year']:.4f}" for b in bands
            )
        )
        for sex in SEXES:
            curve = baseline[sex]
            print(
                f"  {sex} 10년 누적 발병(동년배 기준)  "
                + "  ".join(f"{age}세 {ten_year(curve, age):.3f}" for age in (30, 40, 50, 60, 70))
                + f"   유병률 30세 {curve['prevalence'][30 - AGE_FLOOR]:.3f} → 70세 {curve['prevalence'][70 - AGE_FLOOR]:.3f}"
            )
        if evidence.get(key):
            print("  (evidence 승계)")

    payload = {
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "method": METHOD,
        "source": "baseline: NHANES 2005-2023 성인 단면 유병률 (illness-death 역산) · δ: NCHS Linked Mortality 2019",
        "baseline_kind": "cross_sectional_derived",
        "age_bands": [list(band) for band in AGE_BANDS],
        "definition": "hazard[k]: 나이 age_from+k 에서 다음 1년의 기준 발병 위험. per_year: max(유병자-비유병자 사망률, 0)",
        "n_prevalence_rows": int(len(data)),
        "n_linked": int(len(linked)),
        "targets": targets,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n→ {args.out}")
    if not evidence:
        print("evidence 가 비어 있다. `validate_trajectory.py` 를 돌려 채워라.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
