"""Load 한국의료패널 (KHP) 2019-2023 and build incident-disease labels.

This is the only dataset in 1안 that tracks the same person across years, so it
is the only one that can answer "이 사람이 아직 진단받지 않았는데 앞으로 진단받는가".
Everything else in the pipeline can only describe the present.

The KHP release ships several files per wave (가구·개인·만성질환·의료이용…) and the
variable names carry a wave prefix that changes each year, so this module is
deliberately inspection-first: point it at the extracted folder, run
``--inspect``, then fill in ``WAVE_FILES`` / ``VARIABLES`` below with what you
actually see. The label logic underneath does not change.

    python modeling/data/load_khp.py --inspect
    python modeling/data/load_khp.py --out processed/khp.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
from labels import add_incidence_labels, label_summary
from schema import conform

RAW = Path(__file__).resolve().parent / "raw" / "khp"

# ---------------------------------------------------------------------------
# Fill these in after running --inspect. Left empty on purpose: guessing the
# names would produce a loader that silently reads the wrong column.
# ---------------------------------------------------------------------------

# wave (year) -> the person-level file for that wave
WAVE_FILES: dict[int, str] = {
    # 2019: "t19_ind.csv",
    # 2020: "t20_ind.csv",
}

# canonical name -> source column, per wave if the prefix changes
VARIABLES: dict[str, str] = {
    # "subject_id": "PIDWON",
    # "age": "age",
    # "sex": "sex",
    # "dx_hypertension": "...",   # 의사 진단 고혈압 여부
    # "dx_diabetes": "...",       # 의사 진단 당뇨병 여부
}


def read_any(path: Path) -> pd.DataFrame:
    """KHP ships .csv, .sav and .sas7bdat depending on the release."""
    suffix = path.suffix.lower()
    if suffix == ".csv":
        for encoding in ("cp949", "utf-8-sig", "utf-8"):
            try:
                return pd.read_csv(path, encoding=encoding, low_memory=False)
            except UnicodeDecodeError:
                continue
        raise UnicodeDecodeError("cp949/utf-8", b"", 0, 1, str(path))
    if suffix == ".sas7bdat":
        return pd.read_sas(path, encoding="cp949")
    if suffix == ".sav":
        # pyreadstat is not in the ds group; install it only if the release is SPSS.
        import pyreadstat  # type: ignore[import-not-found]

        frame, _ = pyreadstat.read_sav(str(path))
        return frame
    raise ValueError(f"지원하지 않는 형식입니다: {path.name}")


def inspect(directory: Path) -> int:
    files = sorted(p for p in directory.rglob("*") if p.suffix.lower() in {".csv", ".sav", ".sas7bdat"})
    if not files:
        print(f"{directory} 에 데이터 파일이 없습니다. README.md 3단계를 먼저 수행하세요.")
        return 1

    print(f"{len(files)}개 파일\n")
    for path in files:
        try:
            frame = read_any(path)
        except Exception as exc:  # noqa: BLE001 - 탐색 단계라 어떤 실패든 계속 진행한다
            print(f"  {path.name}: 읽기 실패 ({exc})")
            continue
        print(f"  {path.relative_to(directory)}  rows={len(frame)} cols={len(frame.columns)}")
        interesting = [
            c
            for c in frame.columns
            if any(key in str(c).lower() for key in ("hyper", "diab", "고혈압", "당뇨", "만성", "chronic"))
        ]
        if interesting:
            print(f"      만성질환 후보 컬럼: {interesting[:12]}")
        print(f"      앞 20개: {list(frame.columns)[:20]}")
    return 0


def build(directory: Path) -> pd.DataFrame:
    if not WAVE_FILES or not VARIABLES:
        raise RuntimeError("WAVE_FILES / VARIABLES 가 비어 있습니다. --inspect 결과를 보고 채운 뒤 다시 실행하세요.")

    waves = []
    for year, filename in sorted(WAVE_FILES.items()):
        frame = read_any(directory / filename)
        selected = pd.DataFrame(index=frame.index)
        for canonical, column in VARIABLES.items():
            if column in frame.columns:
                selected[canonical] = frame[column]
            else:
                print(f"  note: {filename} 에 {column} 없음 -> {canonical} 결측 처리")
                selected[canonical] = pd.NA
        selected["survey_year"] = year
        waves.append(selected)

    panel = pd.concat(waves, ignore_index=True)
    panel = add_incidence_labels(panel)
    return conform(panel, "khp")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=RAW)
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    if args.inspect:
        return inspect(args.dir)

    frame = build(args.dir)
    print(f"rows={len(frame)} subjects={frame['subject_id'].nunique()}")
    print(label_summary(frame).to_string(index=False))

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        frame.to_csv(args.out, index=False)
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
