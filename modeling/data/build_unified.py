"""Stack every processed dataset into one table.

Three rules govern the merge.

1. **IDs never collide.** Each row gets ``<source>:<original id>``. NHANES ids
   repeat across survey cycles and both other datasets start counting from zero,
   so raw ids would silently overwrite each other.
2. **Missing means missing.** A column a dataset never collected stays null. It
   is not filled with a zero, a mean, or a sentinel — imputation is a modelling
   decision and belongs downstream, where the choice can be recorded.
3. **Provenance travels with the row.** ``source``, ``cycle``, and the flags
   below let any consumer filter back down to a comparable subset.

The flags matter more than they look. ``labels_measured`` separates rows whose
diabetes/hypertension label came from a measured value (NHANES, Framingham) from
rows where it is a self-reported diagnosis (BRFSS). Training one model across
both without noticing means fitting two different targets at once.

    python modeling/data/build_unified.py
    python modeling/data/build_unified.py --out processed/unified.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
from schema import CANONICAL_COLUMNS, REGISTRY

PROCESSED = Path(__file__).resolve().parent / "processed"

SOURCES = {
    "nhanes_pooled": "nhanes_pooled.csv",
    "brfss_health_indicators": "brfss_indicators.csv",
    "framingham": "framingham.csv",
}

# Rows whose label came from a measurement rather than a self-reported diagnosis.
MEASURED_LABEL_SOURCES = {"nhanes_pooled", "framingham"}
# Rows that carry any blood work at all.
LAB_SOURCES = {"nhanes_pooled"}


def load_source(name: str, filename: str) -> pd.DataFrame:
    path = PROCESSED / filename
    if not path.exists():
        raise FileNotFoundError(f"{path} 없음. 해당 load_*.py 를 먼저 실행하세요.")

    frame = pd.read_csv(path, low_memory=False)
    frame["source"] = name
    if "cycle" not in frame.columns:
        frame["cycle"] = pd.NA

    # Globally unique id. NHANES ids repeat per cycle, and the other two start at 0.
    frame["subject_id"] = name + ":" + frame["subject_id"].astype(str)

    frame["labels_measured"] = name in MEASURED_LABEL_SOURCES
    frame["has_labs"] = name in LAB_SOURCES
    return frame


def build() -> pd.DataFrame:
    frames = []
    for name, filename in SOURCES.items():
        frame = load_source(name, filename)
        print(f"  {name:<26} rows={len(frame):>7}  columns={len(frame.columns)}")
        frames.append(frame)

    columns = [*CANONICAL_COLUMNS, "labels_measured", "has_labs"]
    aligned = []
    for frame in frames:
        for column in columns:
            if column not in frame.columns:
                frame[column] = pd.NA
        aligned.append(frame[columns])

    unified = pd.concat(aligned, ignore_index=True)

    duplicates = int(unified["subject_id"].duplicated().sum())
    if duplicates:
        raise AssertionError(f"subject_id 중복 {duplicates}건. 병합 규칙을 확인하세요.")

    return unified


def coverage_table(unified: pd.DataFrame) -> pd.DataFrame:
    """Per-source non-null share for every canonical column."""
    rows = []
    for column in unified.columns:
        if column in {"source", "subject_id"}:
            continue
        entry: dict[str, object] = {"column": column}
        for source, group in unified.groupby("source"):
            entry[str(source)] = round(float(group[column].notna().mean()), 3)
        entry["전체"] = round(float(unified[column].notna().mean()), 3)
        rows.append(entry)
    return pd.DataFrame(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=PROCESSED / "unified.csv")
    parser.add_argument("--coverage", type=Path, default=PROCESSED / "unified_coverage.csv")
    args = parser.parse_args()

    print("sources:")
    unified = build()

    print(f"\nunified rows={len(unified)}  columns={len(unified.columns)}")
    print(f"고유 subject_id {unified['subject_id'].nunique()}건 — 중복 없음")

    print("\n출처별 구성:")
    summary = unified.groupby("source").agg(
        rows=("subject_id", "size"),
        measured_label=("labels_measured", "first"),
        has_labs=("has_labs", "first"),
        dm_rate=("label_dm_prevalent", "mean"),
        htn_rate=("label_htn_prevalent", "mean"),
        age_min=("age", "min"),
        age_max=("age", "max"),
    )
    print(summary.round(3).to_string())

    coverage = coverage_table(unified)
    filled = coverage[coverage["전체"] > 0]
    print(f"\n값이 하나라도 있는 컬럼 {len(filled)}/{len(coverage)}개")
    print("\n세 출처 모두 값이 있는 컬럼:")
    shared = coverage[
        (coverage.get("nhanes_pooled", 0) > 0)
        & (coverage.get("brfss_health_indicators", 0) > 0)
        & (coverage.get("framingham", 0) > 0)
    ]
    print("  " + ", ".join(shared["column"].tolist()))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    unified.to_csv(args.out, index=False)
    coverage.to_csv(args.coverage, index=False)
    print(f"\nwrote {args.out}")
    print(f"wrote {args.coverage}")

    unknown = set(unified["source"]) - set(REGISTRY) - {"nhanes_pooled"}
    if unknown:
        print(f"note: schema.REGISTRY 에 없는 출처 {sorted(unknown)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
