"""Load 국민건강보험공단 건강검진정보 into the canonical schema.

The file is not downloadable by script — data.go.kr blocks non-browser clients —
so a person has to fetch it once and drop the CSV into
``modeling/data/raw/nhis_checkup/``. See README.md step 1.

Two properties of this dataset shape everything downstream.

* 연도별로 새로 무작위 추출하므로 개인을 연도 간 연계할 수 없다. Cross-sectional only:
  this dataset can carry prevalence labels, never incidence.
* 신장·체중·연령이 구간값(5cm / 5kg / 5세)이다. BMI is reconstructed from band
  midpoints, so treat it as coarser than a measured BMI.

Column names have drifted slightly across release years, so every field is
matched against a candidate list rather than a single literal. Run with
``--inspect`` first to print the actual header and the unmapped columns.

    python modeling/data/load_nhis_checkup.py --inspect
    python modeling/data/load_nhis_checkup.py --out processed/nhis_checkup.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from labels import add_prevalence_labels, label_summary
from schema import conform

RAW = Path(__file__).resolve().parent / "raw" / "nhis_checkup"

# canonical name -> candidate source headers, first match wins
COLUMN_CANDIDATES: dict[str, tuple[str, ...]] = {
    "subject_id": ("가입자일련번호", "가입자 일련번호", "일련번호"),
    "survey_year": ("기준년도", "기준 년도"),
    "region_code": ("시도코드", "시도 코드"),
    "sex_code": ("성별코드", "성별 코드"),
    "age_band": ("연령대코드(5세단위)", "연령대코드", "연령대 코드(5세단위)"),
    "height_band": ("신장(5Cm단위)", "신장(5cm단위)", "신장"),
    "weight_band": ("체중(5Kg단위)", "체중(5kg단위)", "체중"),
    "waist_cm": ("허리둘레",),
    "sbp": ("수축기혈압", "수축기 혈압"),
    "dbp": ("이완기혈압", "이완기 혈압"),
    "fasting_glucose": ("식전혈당(공복혈당)", "식전혈당", "공복혈당"),
    "total_chol": ("총콜레스테롤", "총 콜레스테롤"),
    "triglyceride": ("트리글리세라이드", "중성지방"),
    "hdl": ("HDL콜레스테롤", "HDL 콜레스테롤"),
    "ldl": ("LDL콜레스테롤", "LDL 콜레스테롤"),
    "hemoglobin": ("혈색소",),
    "urine_protein": ("요단백",),
    "creatinine": ("혈청크레아티닌", "혈청 크레아티닌"),
    "ast": ("(혈청지오티)AST", "혈청지오티AST", "AST"),
    "alt": ("(혈청지피티)ALT", "혈청지피티ALT", "ALT"),
    "ggt": ("감마지티피", "감마 지티피"),
    "smoking_code": ("흡연상태", "흡연 상태"),
    "drinking_code": ("음주여부", "음주 여부"),
}

# 흡연상태 1=피우지 않는다 / 2=과거에 피웠으나 끊었다 / 3=현재도 피운다
SMOKING_MAP = {1: "never", 2: "former", 3: "current"}

# 연령대코드(5세단위). 공표 자료는 20세 이상만 담고 있어 코드 5(20~24세)부터 시작하며
# 마지막 구간 18은 85세 이상이다. 구간 중앙값으로 근사한다.
# ★ 배포 전 "건강검진정보 사용자 매뉴얼"의 코드표와 한 번 대조할 것.
AGE_BAND_LAST = 18
AGE_BAND_LAST_MIDPOINT = 87.0


def find_file(directory: Path) -> Path:
    candidates = sorted([*directory.glob("*.csv"), *directory.glob("*.CSV")])
    if not candidates:
        raise FileNotFoundError(f"{directory} 에 CSV가 없습니다. README.md 1단계를 먼저 수행하세요.")
    return candidates[0]


def read_raw(path: Path) -> pd.DataFrame:
    """공공데이터포털 파일은 대개 CP949다. UTF-8(BOM 포함)도 함께 시도한다."""
    for encoding in ("cp949", "utf-8-sig", "utf-8"):
        try:
            return pd.read_csv(path, encoding=encoding, low_memory=False)
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("cp949/utf-8", b"", 0, 1, f"{path} 인코딩을 판별하지 못했습니다")


def resolve(frame: pd.DataFrame) -> tuple[dict[str, str], list[str]]:
    """Map canonical names to whatever headers this release actually uses."""
    normalised = {column.replace(" ", ""): column for column in frame.columns}
    mapping: dict[str, str] = {}
    for canonical, candidates in COLUMN_CANDIDATES.items():
        for candidate in candidates:
            actual = normalised.get(candidate.replace(" ", ""))
            if actual is not None:
                mapping[canonical] = actual
                break
    unmapped = [c for c in frame.columns if c not in mapping.values()]
    return mapping, unmapped


def _column(frame: pd.DataFrame, name: str) -> pd.Series:
    """Column if present, otherwise an all-NA column of the same length."""
    if name in frame.columns:
        return frame[name]
    return pd.Series(pd.NA, index=frame.index, dtype="object")


def _age_from_band(band: pd.Series) -> pd.Series:
    code = pd.to_numeric(band, errors="coerce")
    midpoint = code * 5 - 2.5  # code 5 -> 22.5 (20~24세)
    return midpoint.mask(code >= AGE_BAND_LAST, AGE_BAND_LAST_MIDPOINT)


def build(path: Path) -> pd.DataFrame:
    raw = read_raw(path)
    mapping, unmapped = resolve(raw)
    missing = sorted(set(COLUMN_CANDIDATES) - set(mapping))
    if missing:
        print(f"  note: 매핑하지 못한 항목 {missing}")
    if unmapped:
        print(f"  note: 사용하지 않은 원본 컬럼 {len(unmapped)}개 (예: {unmapped[:6]})")

    frame = pd.DataFrame(index=raw.index)
    for canonical, actual in mapping.items():
        frame[canonical] = raw[actual]

    frame["age"] = _age_from_band(_column(frame, "age_band"))
    frame["sex"] = pd.to_numeric(_column(frame, "sex_code"), errors="coerce").map({1: "M", 2: "F"})
    # 구간 코드가 아니라 이미 cm/kg로 들어오는 릴리스도 있어 크기로 구분한다.
    height = pd.to_numeric(_column(frame, "height_band"), errors="coerce")
    weight = pd.to_numeric(_column(frame, "weight_band"), errors="coerce")
    frame["height_cm"] = height
    frame["weight_kg"] = weight
    with np.errstate(divide="ignore", invalid="ignore"):
        frame["bmi"] = weight / (height / 100.0) ** 2

    frame["smoking_status"] = pd.to_numeric(_column(frame, "smoking_code"), errors="coerce").map(SMOKING_MAP)
    drinking = pd.to_numeric(_column(frame, "drinking_code"), errors="coerce")
    # 음주여부는 이분값이라 빈도로 환산할 수 없다. 마신다=주 1회로 보수적으로 둔다.
    frame["alcohol_days_per_year"] = drinking.map({0: 0.0, 1: 52.0})

    # 이 자료에는 진단 이력·투약 정보가 없다. 라벨은 실측 수치만으로 만든다.
    for column in ("dx_diabetes", "dx_hypertension", "med_diabetes", "med_hypertension"):
        frame[column] = pd.NA

    frame["egfr"] = pd.NA  # 크레아티닌은 있으나 CKD-EPI에 필요한 정확한 연령이 구간값이라 보류

    frame = add_prevalence_labels(frame)
    return conform(frame, "nhis_checkup")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=None)
    parser.add_argument("--inspect", action="store_true", help="헤더만 확인하고 종료")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    try:
        path = args.path or find_file(RAW)
    except FileNotFoundError as exc:
        print(exc)
        return 1
    print(f"source: {path}")

    if args.inspect:
        raw = read_raw(path)
        mapping, unmapped = resolve(raw)
        print(f"rows={len(raw)} columns={len(raw.columns)}")
        print("\n매핑됨:")
        for canonical, actual in mapping.items():
            print(f"  {canonical:<20} <- {actual}")
        print(f"\n매핑 안 됨 ({len(unmapped)}): {unmapped}")
        if "age_band" in mapping:
            print("\n연령대코드 분포 (매뉴얼 코드표와 대조하세요):")
            print(raw[mapping["age_band"]].value_counts().sort_index().to_string())
        return 0

    frame = build(path)
    print(f"\nrows={len(frame)} columns={len(frame.columns)}")
    print("\nlabels:")
    print(label_summary(frame).to_string(index=False))

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        frame.to_csv(args.out, index=False)
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
