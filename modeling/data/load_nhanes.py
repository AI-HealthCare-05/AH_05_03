"""Pool NHANES cycles into the canonical table.

Run ``download_nhanes.py`` first. Four cycles are stacked: 2013-2014, 2015-2016,
2017-2018 and 2021-2023.

The cycles are not interchangeable, and the differences matter enough that this
loader detects them per cycle instead of assuming one layout:

* blood pressure moved from auscultatory (``BPX``, up to four readings) to
  oscillometric (``BPXO``, three readings) in 2021-2023
* the hypertension medication item was ``BPQ040A`` and became ``BPQ150``
* physical activity used the long GPAQ-style block through 2018 and a short
  leisure-time block from 2021
* family history (``MCQ300A``/``MCQ300C``) was dropped after 2018

Rows carry a ``cycle`` tag so any cycle can be held out for validation.

    python modeling/data/load_nhanes.py --adults-only --out processed/nhanes_pooled.csv
"""

from __future__ import annotations

import argparse
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from labels import add_extended_labels, add_prevalence_labels, label_summary
from schema import conform

RAW = Path(__file__).resolve().parent / "raw" / "nhanes"

CYCLE_START_YEAR = {
    "2005_2006": 2005,
    "2007_2008": 2007,
    "2009_2010": 2009,
    "2011_2012": 2011,
    "2013_2014": 2013,
    "2015_2016": 2015,
    "2017_2018": 2017,
    "2021_2023": 2021,
}

# NHANES 는 모든 파일 이름 끝에 주기 문자를 붙인다.
CYCLE_SUFFIX = {
    "2005_2006": "D",
    "2007_2008": "E",
    "2009_2010": "F",
    "2011_2012": "G",
    "2013_2014": "H",
    "2015_2016": "I",
    "2017_2018": "J",
    "2021_2023": "L",
}

YES_NO_SENTINELS = {7, 9}
WIDE_SENTINELS = {7777, 9999}
DAYS_SENTINELS = {77, 99}
ALQ130_SENTINELS = {777, 999}

# ALQ121: drinking frequency in the past 12 months -> approximate days per year.
ALQ121_TO_DAYS = {
    0: 0,  # never in the last year
    1: 365,  # every day
    2: 300,  # nearly every day
    3: 182,  # 3-4 times a week
    4: 104,  # 2 times a week
    5: 52,  # once a week
    6: 30,  # 2-3 times a month
    7: 12,  # once a month
    8: 9,  # 7-11 times in the last year
    9: 4.5,  # 3-6 times in the last year
    10: 1.5,  # 1-2 times in the last year
}

# PAD790U / PAD810U frequency units -> occurrences per week (short form only).
UNIT_TO_WEEKLY = {"D": 7.0, "W": 1.0, "M": 12.0 / 52.0, "Y": 1.0 / 52.0}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _read(directory: Path, stem: str, suffix: str) -> pd.DataFrame | None:
    path = directory / f"{stem}_{suffix}.xpt"
    if not path.exists():
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        frame = pd.read_sas(path, format="xport")
    return frame.set_index(pd.Index(frame["SEQN"].astype("int64"), name="SEQN"))


def _blank(series: pd.Series, sentinels: set[int]) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    # XPORT stores some zeros as a denormalised float (~5.4e-79). Left as-is they
    # never match a code table and a valid "0 times" reads as missing.
    numeric = numeric.mask(numeric.abs() < 1e-10, 0.0)
    return numeric.mask(numeric.isin(sentinels))


def _codes(series: pd.Series, sentinels: set[int]) -> pd.Series:
    """Integer code column, ready for .map against a code table."""
    return _blank(series, sentinels).round().astype("Int64")


def _yes_no(series: pd.Series) -> pd.Series:
    """1=Yes / 2=No -> boolean, refusals -> NA."""
    return _codes(series, YES_NO_SENTINELS).map({1: True, 2: False}).astype("boolean")


def _decode(series: pd.Series) -> pd.Series:
    """read_sas returns character columns as bytes."""
    return series.map(lambda v: v.decode().strip() if isinstance(v, bytes) else v)


def _missing(index: pd.Index) -> pd.Series:
    return pd.Series(pd.NA, index=index, dtype="object")


def _egfr(creatinine: pd.Series, age: pd.Series, sex: pd.Series) -> pd.Series:
    """CKD-EPI 2021 creatinine equation (race-free)."""
    female = sex.eq("F")
    kappa = np.where(female, 0.7, 0.9)
    alpha = np.where(female, -0.241, -0.302)
    ratio = creatinine / kappa
    value = (
        142.0
        * np.minimum(ratio, 1.0) ** alpha
        * np.maximum(ratio, 1.0) ** -1.200
        * 0.9938**age
        * np.where(female, 1.012, 1.0)
    )
    return pd.Series(value, index=creatinine.index).where(creatinine.notna() & age.notna())


def _blood_pressure(directory: Path, suffix: str, index: pd.Index) -> tuple[pd.Series, pd.Series, str]:
    """Mean systolic / diastolic, from whichever BP file this cycle shipped.

    BPX is preferred when both exist: in 2017-2018 the oscillometric file covers
    only a comparison subsample while BPX covers the full examined sample.
    A diastolic reading of 0 means "not audible", not a measurement of zero.
    """
    auscultatory = _read(directory, "BPX", suffix)
    if auscultatory is not None and "BPXSY1" in auscultatory.columns:
        systolic_columns = [c for c in ("BPXSY1", "BPXSY2", "BPXSY3", "BPXSY4") if c in auscultatory.columns]
        diastolic_columns = [c for c in ("BPXDI1", "BPXDI2", "BPXDI3", "BPXDI4") if c in auscultatory.columns]
        source, style = auscultatory, "BPX"
    else:
        oscillometric = _read(directory, "BPXO", suffix)
        if oscillometric is None:
            return _missing(index), _missing(index), "none"
        systolic_columns = [c for c in ("BPXOSY1", "BPXOSY2", "BPXOSY3") if c in oscillometric.columns]
        diastolic_columns = [c for c in ("BPXODI1", "BPXODI2", "BPXODI3") if c in oscillometric.columns]
        source, style = oscillometric, "BPXO"

    systolic = source[systolic_columns].mean(axis=1, skipna=True)
    diastolic = source[diastolic_columns].replace(0, np.nan).mean(axis=1, skipna=True)
    return systolic.reindex(index), diastolic.reindex(index), style


def _activity(directory: Path, suffix: str, index: pd.Index) -> tuple[pd.Series, pd.Series, pd.Series, str]:
    """Leisure-time moderate / vigorous minutes per week and sedentary minutes.

    Only recreational activity is counted, in both questionnaire styles, so the
    pooled column means the same thing across cycles. Occupational activity is
    available in the long form but has no short-form counterpart.
    """
    paq = _read(directory, "PAQ", suffix)
    if paq is None:
        return _missing(index), _missing(index), _missing(index), "none"

    sedentary = _blank(paq["PAD680"], WIDE_SENTINELS) if "PAD680" in paq.columns else _missing(paq.index)

    if "PAD790Q" in paq.columns:  # short form, 2021-2023

        def weekly(freq: str, unit: str, minutes: str) -> pd.Series:
            count = _blank(paq[freq], WIDE_SENTINELS)
            product = count * _decode(paq[unit]).map(UNIT_TO_WEEKLY) * _blank(paq[minutes], WIDE_SENTINELS)
            # "0 times" skips the duration question; zero frequency is zero minutes.
            return product.mask(count.eq(0), 0.0)

        moderate = weekly("PAD790Q", "PAD790U", "PAD800")
        vigorous = weekly("PAD810Q", "PAD810U", "PAD820")
        style = "short"
    elif "PAQ665" in paq.columns:  # long form, 2013-2018

        def gated(gate: str, days: str, minutes: str) -> pd.Series:
            answered_no = _yes_no(paq[gate]).eq(False).fillna(False)
            product = _blank(paq[days], DAYS_SENTINELS) * _blank(paq[minutes], WIDE_SENTINELS)
            return product.mask(answered_no, 0.0)

        moderate = gated("PAQ665", "PAQ670", "PAD675")
        vigorous = gated("PAQ650", "PAQ655", "PAD660")
        style = "long"
    else:
        return _missing(index), _missing(index), sedentary.reindex(index), "unknown"

    return moderate.reindex(index), vigorous.reindex(index), sedentary.reindex(index), style


def _alcohol_days(directory: Path, suffix: str, index: pd.Index) -> tuple[pd.Series, str]:
    """Drinking days per year, from whichever alcohol block this cycle used.

    2017 onward asks ALQ121 as a frequency category. Earlier cycles ask a count
    (ALQ120Q) plus a unit (ALQ120U). Respondents who report fewer than 12 drinks
    in the past year skip the block; that is treated as zero rather than unknown.
    """
    alq = _read(directory, "ALQ", suffix)
    if alq is None:
        return _missing(index), "none"

    def gate(column: str) -> pd.Series:
        """True where the respondent answered No and therefore skipped the block."""
        if column not in alq.columns:
            return pd.Series(False, index=alq.index)
        return _yes_no(alq[column]).eq(False).fillna(False).astype(bool)

    if "ALQ121" in alq.columns:
        days = _codes(alq["ALQ121"], DAYS_SENTINELS).map(ALQ121_TO_DAYS)
        return days.mask(gate("ALQ111"), 0.0).reindex(index), "ALQ121"

    if "ALQ120Q" in alq.columns:
        per_year = {1: 52.0, 2: 12.0, 3: 1.0}  # 1=week, 2=month, 3=year
        count = _blank(alq["ALQ120Q"], {777, 999})
        days = count * _codes(alq["ALQ120U"], DAYS_SENTINELS).map(per_year)
        days = days.mask(count.eq(0), 0.0).mask(gate("ALQ101"), 0.0)
        return days.reindex(index), "ALQ120Q"

    return _missing(index), "unknown"


# ---------------------------------------------------------------------------
# per-cycle build
# ---------------------------------------------------------------------------


def build_cycle(cycle: str) -> pd.DataFrame:
    directory = RAW / cycle
    suffix = CYCLE_SUFFIX[cycle]

    demo = _read(directory, "DEMO", suffix)
    if demo is None:
        raise FileNotFoundError(f"{directory} 에 DEMO 파일이 없습니다. download_nhanes.py 를 먼저 실행하세요.")

    index = demo.index
    frame = pd.DataFrame(index=index)
    frame["subject_id"] = index.astype("int64")
    frame["cycle"] = cycle
    frame["survey_year"] = CYCLE_START_YEAR[cycle]
    frame["weight_survey"] = demo.get("WTMEC2YR")
    frame["psu"] = demo.get("SDMVPSU")
    frame["stratum"] = demo.get("SDMVSTRA")
    frame["age"] = _blank(demo["RIDAGEYR"], set())
    frame["sex"] = demo["RIAGENDR"].map({1: "M", 2: "F"})
    # DMDEDUC2: 1=<9학년 ... 5=대졸 이상. UCI Education 과 같은 1~5 서열로 맞춘다.
    frame["education_level"] = _codes(demo.get("DMDEDUC2", pd.Series(dtype=float)), YES_NO_SENTINELS)
    # INDFMPIR 은 빈곤소득비(0~5). 데이터셋마다 소득 척도가 달라 내부 백분위로 맞춘다.
    poverty_ratio = pd.to_numeric(demo.get("INDFMPIR", pd.Series(dtype=float)), errors="coerce")
    frame["income_rank"] = poverty_ratio.rank(pct=True)
    # RIDEXPRG: 1=임신, 2=아님, 3=판정 불가. 빈혈 기준이 임신 중에는 달라지므로
    # (WHO 11.0 g/dL) 그 행은 라벨에서 뺀다. conform() 이 나중에 떨궈 준다.
    pregnancy = _codes(demo.get("RIDEXPRG", pd.Series(dtype=float)), set())
    frame["pregnant"] = pregnancy.eq(1).astype("boolean").where(pregnancy.isin([1, 2]))

    def take(stem: str, columns: dict[str | tuple[str, ...], str]) -> None:
        """Copy columns across, accepting per-cycle name variants."""
        source = _read(directory, stem, suffix)
        for candidates, target in columns.items():
            options = (candidates,) if isinstance(candidates, str) else candidates
            frame[target] = pd.NA
            if source is None:
                continue
            for option in options:
                if option in source.columns:
                    frame[target] = source[option].reindex(index)
                    break

    take("BMX", {"BMXHT": "height_cm", "BMXWT": "weight_kg", "BMXBMI": "bmi", "BMXWAIST": "waist_cm"})
    take("GLU", {"LBXGLU": "fasting_glucose"})
    take("GHB", {"LBXGH": "hba1c"})
    take("TCHOL", {"LBXTC": "total_chol"})
    take("HDL", {"LBDHDD": "hdl"})
    take("TRIGLY", {("LBXTLG", "LBXTR"): "triglyceride", "LBDLDL": "ldl"})
    take(
        "BIOPRO",
        {
            "LBXSCR": "creatinine",
            "LBXSATSI": "ast",
            "LBXSASSI": "alt",
            "LBXSGTSI": "ggt",
            "LBXSUA": "uric_acid",
            "LBXSAL": "albumin",
        },
    )
    take("CBC", {"LBXHGB": "hemoglobin"})
    take("ALB_CR", {"URXUMA": "urine_albumin", "URXUCR": "urine_creatinine"})
    take("LUX", {"LUXCAPM": "cap_raw", "LUAXSTAT": "lux_status"})
    take("DIQ", {"DIQ010": "diq010", "DIQ050": "diq050", "DIQ070": "diq070"})
    take(
        "BPQ",
        {
            "BPQ020": "bpq020",
            "BPQ150": "bpq150",
            "BPQ040A": "bpq040a",
            "BPQ080": "bpq080",
            "BPQ090D": "bpq090d",
            "BPQ100D": "bpq100d",
            "BPQ101D": "bpq101d",
        },
    )
    take("SMQ", {"SMQ020": "smq020", "SMQ040": "smq040"})
    take("ALQ", {"ALQ130": "alq130"})
    take("SLQ", {"SLD012": "sleep_hours", "SLD010H": "sleep_hours_legacy"})
    take(
        "MCQ",
        {
            "MCQ300C": "mcq300c",
            "MCQ300A": "mcq300a",
            "MCQ160E": "mcq160e",
            "MCQ160F": "mcq160f",
            "MCQ160L": "mcq160l",
        },
    )
    take("HUQ", {"HUQ010": "huq010"})
    take("PFQ", {"PFQ061B": "pfq061b"})

    frame["sbp"], frame["dbp"], bp_style = _blood_pressure(directory, suffix, index)
    moderate, vigorous, sedentary, activity_style = _activity(directory, suffix, index)
    frame["moderate_min_per_week"] = moderate
    frame["vigorous_min_per_week"] = vigorous
    frame["sedentary_min_per_day"] = sedentary

    # SLQ used SLD010H (hours) through 2015-2016 and SLD012 from 2017-2018.
    legacy = pd.to_numeric(frame["sleep_hours_legacy"], errors="coerce")
    frame["sleep_hours"] = pd.to_numeric(frame["sleep_hours"], errors="coerce").fillna(legacy)
    frame = frame.drop(columns=["sleep_hours_legacy"])

    told_dm = _codes(frame["diq010"], YES_NO_SENTINELS)
    frame["dx_diabetes"] = told_dm.map({1: True, 2: False, 3: False}).astype("boolean")
    frame["dx_prediabetes_told"] = told_dm.eq(3).astype("boolean").where(told_dm.notna())
    frame["med_diabetes"] = (
        (_yes_no(frame["diq070"]).fillna(False) | _yes_no(frame["diq050"]).fillna(False))
        .astype("boolean")
        .where(frame["diq070"].notna() | frame["diq050"].notna())
    )

    frame["dx_hypertension"] = _yes_no(frame["bpq020"])
    # BPQ150 (2021-2023) and BPQ040A (2013-2018) ask the same thing.
    medication = _yes_no(frame["bpq150"])
    frame["med_hypertension"] = medication.fillna(_yes_no(frame["bpq040a"]))

    # Lipid-lowering medication. 2021-2023 asks BPQ101D straight out; earlier
    # cycles gate BPQ100D ("now taking") behind BPQ090D ("told to take"), so a
    # respondent who answered No to the gate never sees BPQ100D and would read
    # as unknown instead of as not taking anything.
    #
    # The outer gate moved too. Through 2009-2010 BPQ090D was asked only of
    # respondents who answered Yes to BPQ080 ("ever told your cholesterol was
    # high"); from 2011-2012 it is asked of everyone who had a cholesterol test.
    # Without folding BPQ080=No back in as False, the medication rate reads 51%
    # in 2005-2006 and 26% in 2011-2012 purely because the denominators differ.
    told_high = _yes_no(frame["bpq080"])
    told_to_take = _yes_no(frame["bpq090d"])
    now_taking = _yes_no(frame["bpq101d"]).fillna(_yes_no(frame["bpq100d"]))
    frame["med_lipid"] = (
        now_taking.mask(told_to_take.eq(False).fillna(False), False)
        .mask(told_high.eq(False).fillna(False), False)
        .astype("boolean")
    )
    frame["dx_liver"] = _yes_no(frame["mcq160l"])

    ever = _yes_no(frame["smq020"])
    now = _codes(frame["smq040"], YES_NO_SENTINELS)
    smoking_status = pd.Series(pd.NA, index=index, dtype="object")
    smoking_status = smoking_status.mask(now.eq(3).fillna(False), "former")
    smoking_status = smoking_status.mask(now.isin([1, 2]).fillna(False), "current")
    # "never smoked" wins last: the gate question overrides a stale SMQ040.
    smoking_status = smoking_status.mask(ever.eq(False).fillna(False), "never")
    frame["smoking_status"] = smoking_status

    frame["alcohol_days_per_year"], alcohol_style = _alcohol_days(directory, suffix, index)
    frame["alcohol_drinks_per_occasion"] = _blank(frame["alq130"], ALQ130_SENTINELS)

    frame["fh_diabetes"] = _yes_no(frame["mcq300c"])
    frame["fh_cvd"] = _yes_no(frame["mcq300a"])
    # NHANES never asked about a family history of hypertension.
    frame["fh_hypertension"] = pd.NA
    # No usable fruit/vegetable frequency item across all four cycles.
    frame["veg_fruit_servings_per_day"] = pd.NA

    # HUQ010: 1=매우 좋음 ... 5=나쁨. UCI GenHlth 와 척도가 같다.
    frame["self_rated_health"] = _codes(frame["huq010"], YES_NO_SENTINELS).where(
        _codes(frame["huq010"], YES_NO_SENTINELS).between(1, 5)
    )
    # PFQ061B: 1=어려움 없음, 2~4=어려움 있음, 9=해당 활동 안 함
    walking = _codes(frame["pfq061b"], {9})
    frame["difficulty_walking"] = walking.ge(2).astype("boolean").where(walking.between(1, 4))
    frame["dx_high_cholesterol"] = _yes_no(frame["bpq080"])
    frame["dx_heart_disease"] = _yes_no(frame["mcq160e"])
    frame["dx_stroke"] = _yes_no(frame["mcq160f"])

    creatinine = pd.to_numeric(frame["creatinine"], errors="coerce")
    frame["egfr"] = _egfr(creatinine, pd.to_numeric(frame["age"], errors="coerce"), frame["sex"])

    # ACR in mg/g. URXUMA is ug/mL (= mg/L) and URXUCR is mg/dL, so the unit
    # conversion is x100. The later cycles ship URDACT already derived; deriving
    # it here instead keeps all eight cycles on one formula.
    urine_albumin = pd.to_numeric(frame["urine_albumin"], errors="coerce")
    urine_creatinine = pd.to_numeric(frame["urine_creatinine"], errors="coerce")
    frame["urine_acr"] = (urine_albumin * 100.0 / urine_creatinine).where(urine_creatinine.gt(0))
    frame = frame.drop(columns=["urine_albumin", "urine_creatinine"])

    # LUAXSTAT 1 = complete exam. Partial and ineligible exams still carry a CAP
    # median that the survey documentation says not to use.
    cap = pd.to_numeric(frame["cap_raw"], errors="coerce")
    complete = _codes(frame["lux_status"], set()).eq(1)
    frame["cap_db_m"] = cap.where(complete.fillna(False))
    frame = frame.drop(columns=["cap_raw", "lux_status"])

    print(
        f"  {cycle}: n={len(frame)}  bp={bp_style}  activity={activity_style}  "
        f"alcohol={alcohol_style}  family_history={bool(frame['fh_diabetes'].notna().any())}"
    )
    return frame


def build(cycles: list[str]) -> pd.DataFrame:
    print("cycles:")
    frames = [build_cycle(cycle) for cycle in cycles]
    # Drop all-NA columns per frame before concat so pandas keeps the dtypes
    # of the cycles that actually carry the variable.
    pooled = pd.concat([f.dropna(axis=1, how="all") for f in frames], ignore_index=True)
    # Subject ids repeat across cycles; make them unique before any panel logic.
    pooled["subject_id"] = pooled["cycle"].astype(str) + "_" + pooled["subject_id"].astype(str)
    pooled = add_prevalence_labels(pooled)
    pooled = add_extended_labels(pooled)
    result = conform(pooled, "nhanes_pooled")
    result["cycle"] = pooled["cycle"].to_numpy()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cycles", nargs="*", default=list(CYCLE_START_YEAR))
    parser.add_argument("--adults-only", action="store_true", help="keep age >= 19")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    frame = build(args.cycles)
    if args.adults_only:
        frame = frame[pd.to_numeric(frame["age"], errors="coerce") >= 19]

    print(f"\nrows={len(frame)}  columns={len(frame.columns)}")
    print("\nrows per cycle:")
    print(frame["cycle"].value_counts().sort_index().to_string())

    coverage = frame.notna().mean().sort_values()
    print("\ncoverage (lowest 10):")
    for name, value in coverage.head(10).items():
        print(f"  {name:<28} {value:6.1%}")

    print("\nlabels:")
    print(label_summary(frame).to_string(index=False))

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        frame.to_csv(args.out, index=False)
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
