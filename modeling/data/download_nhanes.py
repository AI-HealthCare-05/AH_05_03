"""Download NHANES public data files for several survey cycles.

NHANES is fully public: no registration, no application, no IRB. Files land in
``modeling/data/raw/nhanes/<cycle>/`` and are consumed by ``load_nhanes.py``.

Four cycles are pooled. 2019-2020 has no standalone release (CDC published a
combined 2017-March 2020 file instead), so using it alongside 2017-2018 would
double-count respondents. It is left out on purpose.

Standard library only, so this runs before ``uv sync --group ds``.

    python modeling/data/download_nhanes.py
    python modeling/data/download_nhanes.py --cycles 2021_2023
    python modeling/data/download_nhanes.py --force
"""

from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

BASE_URL = "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public"


@dataclass(frozen=True)
class Cycle:
    key: str
    suffix: str  # NHANES appends this to every file stem
    path: str  # directory segment on the CDC host
    start_year: int


# 2005-2006 이전 주기는 넣지 않는다. GLU·GHB·SLQ 가 없거나 다른 이름을 쓴다
# (혈당은 L10AM_B 처럼 실험실 파일에 흩어져 있고 수면 문항은 2005년에 처음 들어왔다).
# 라벨을 만들 수 없는 주기를 넣으면 표본만 늘고 학습에는 쓰이지 않는다.
CYCLES: tuple[Cycle, ...] = (
    Cycle("2005_2006", "D", "2005", 2005),
    Cycle("2007_2008", "E", "2007", 2007),
    Cycle("2009_2010", "F", "2009", 2009),
    Cycle("2011_2012", "G", "2011", 2011),
    Cycle("2013_2014", "H", "2013", 2013),
    Cycle("2015_2016", "I", "2015", 2015),
    Cycle("2017_2018", "J", "2017", 2017),
    Cycle("2021_2023", "L", "2021", 2021),
)

# (stem, why we need it). Not every stem exists in every cycle; misses are
# reported rather than treated as failures — the loader detects what is present.
STEMS: list[tuple[str, str]] = [
    ("DEMO", "age, sex, income ratio, survey weights, PSU/stratum"),
    ("BMX", "height, weight, BMI, waist circumference"),
    ("BPX", "blood pressure, auscultatory (2013-2018)"),
    ("BPXO", "blood pressure, oscillometric (2021-2023)"),
    ("GLU", "fasting plasma glucose"),
    ("GHB", "HbA1c"),
    ("TCHOL", "total cholesterol"),
    ("HDL", "HDL cholesterol"),
    ("TRIGLY", "triglycerides, LDL"),
    ("BIOPRO", "creatinine for eGFR, liver enzymes, GGT, uric acid"),
    ("CBC", "haemoglobin for the anaemia label"),
    ("ALB_CR", "urine albumin-to-creatinine ratio, the second KDIGO criterion"),
    ("LUX", "liver elastography CAP, measured hepatic steatosis (2017-2018 and 2021-2023 only)"),
    ("DIQ", "self-reported diabetes diagnosis and medication"),
    ("BPQ", "self-reported hypertension diagnosis and medication"),
    ("MCQ", "family history of diabetes and heart attack (2013-2018 only)"),
    ("SMQ", "smoking status"),
    ("ALQ", "alcohol intake"),
    ("PAQ", "physical activity"),
    ("SLQ", "sleep duration"),
    ("HUQ", "self-rated general health"),
    ("PFQ", "functional limitation, walking difficulty (2013-2018 only)"),
    ("INQ", "household income"),
    ("DR1TOT", "day-1 dietary recall totals (optional, for the meal feature)"),
]

DEFAULT_DEST = Path(__file__).resolve().parent / "raw" / "nhanes"
# CDC rejects the default urllib agent.
USER_AGENT = "Mozilla/5.0 (compatible; ieobom-research/0.1)"


def download(url: str, target: Path, *, force: bool) -> tuple[str, int]:
    """Fetch one file. Returns (status, bytes)."""
    if target.exists() and not force:
        return "skip", target.stat().st_size

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        return ("absent" if exc.code == 404 else f"http {exc.code}"), 0
    except (urllib.error.URLError, TimeoutError) as exc:
        return f"fail ({exc})", 0

    # Write via a temp file so an interrupted run never leaves a truncated .xpt.
    temporary = target.with_suffix(".xpt.part")
    temporary.write_bytes(payload)
    temporary.replace(target)
    return "ok", len(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    parser.add_argument("--cycles", nargs="*", default=[c.key for c in CYCLES])
    parser.add_argument("--force", action="store_true", help="re-download files that already exist")
    args = parser.parse_args()

    selected = [c for c in CYCLES if c.key in args.cycles]
    if not selected:
        print(f"알 수 없는 주기입니다. 사용 가능: {[c.key for c in CYCLES]}", file=sys.stderr)
        return 1

    total = 0
    failures: list[str] = []
    for cycle in selected:
        directory = args.dest / cycle.key
        directory.mkdir(parents=True, exist_ok=True)
        print(f"\n[{cycle.key}] -> {directory}")
        for stem, purpose in STEMS:
            name = f"{stem}_{cycle.suffix}"
            status, size = download(
                f"{BASE_URL}/{cycle.path}/DataFiles/{name}.xpt",
                directory / f"{name}.xpt",
                force=args.force,
            )
            total += size
            if status.startswith(("fail", "http")):
                failures.append(f"{cycle.key}/{name}: {status}")
            if status != "absent":
                print(f"  {name:<12} {status:<6} {size / 1_048_576:7.2f} MB  {purpose}")

    print(f"\n{total / 1_048_576:.1f} MB total")
    for failure in failures:
        print(f"  FAILED {failure}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
