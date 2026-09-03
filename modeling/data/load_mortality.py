"""NHANES 사망연계 파일(Linked Mortality File) — 단면 자료를 전향 코호트로 바꾼다.

이 저장소의 라벨은 전부 **유병**이다. 지금 그 병이 있는가를 맞히지, 앞으로 생길지를
맞히지 않는다. `21_modeling_overview.md` §7.4 가 "발병 예측을 하려면 종단 자료가
필요한데 전부 신청이 걸려 있다"고 적어 뒀는데, **NCHS 가 NHANES 응답자를 국가
사망지수에 연계한 공개 파일을 무료로 배포한다.** 신청도 심의도 없다.

주는 것은 발병이 아니라 **사망**이다. 그래서 제품 화면에 새 카드를 다는 용도가 아니라
**기존 위험도가 실제로 뭔가를 뜻하는지 검증하는** 용도다 — "이 모델이 높다고 한
사람들이 이후 10년에 실제로 더 많이 죽었는가".

파일은 고정폭 ASCII 다. 레이아웃은 NCHS 가 배포하는 SAS 입력문과 같다.

    publicid  1-14   SEQN 을 왼쪽 정렬하고 나머지는 공백
    eligstat  15     1=연계 대상, 2=18세 미만, 3=대상 아님
    mortstat  16     0=생존 추정, 1=사망 추정. 대상이 아니면 결측
    ucod_lead 17-19  주요 사인 10분류. 001=심장병 … 007=당뇨 … 009=신장염
    diabetes  20     당뇨가 사망에 기여했는가
    hyperten  21     고혈압이 기여했는가
    permth_int 43-45 면접 시점부터의 추적 개월
    permth_exm 46-48 검진 시점부터의 추적 개월

2021-2023 주기는 아직 연계본이 없다. 모든 타깃의 홀드아웃이 그 주기이므로
**이 자료는 홀드아웃 평가에 쓸 수 없고 학습 주기 검증에만 쓴다.**

    ../../.venv/Scripts/python.exe load_mortality.py --out processed/mortality.csv
"""

from __future__ import annotations

import argparse
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd

BASE_URL = "https://ftp.cdc.gov/pub/HEALTH_STATISTICS/NCHS/datalinkage/linked_mortality"
USER_AGENT = "Mozilla/5.0 (compatible; ieobom-research/0.1)"

# 연계본이 나온 주기. 2021-2023 은 아직 없다.
CYCLES: tuple[tuple[str, str], ...] = (
    ("1999_2000", "NHANES_1999_2000_MORT_2019_PUBLIC.dat"),
    ("2001_2002", "NHANES_2001_2002_MORT_2019_PUBLIC.dat"),
    ("2003_2004", "NHANES_2003_2004_MORT_2019_PUBLIC.dat"),
    ("2005_2006", "NHANES_2005_2006_MORT_2019_PUBLIC.dat"),
    ("2007_2008", "NHANES_2007_2008_MORT_2019_PUBLIC.dat"),
    ("2009_2010", "NHANES_2009_2010_MORT_2019_PUBLIC.dat"),
    ("2011_2012", "NHANES_2011_2012_MORT_2019_PUBLIC.dat"),
    ("2013_2014", "NHANES_2013_2014_MORT_2019_PUBLIC.dat"),
    ("2015_2016", "NHANES_2015_2016_MORT_2019_PUBLIC.dat"),
    ("2017_2018", "NHANES_2017_2018_MORT_2019_PUBLIC.dat"),
)

# 1-based 시작·끝을 0-based 슬라이스로.
FIELDS: dict[str, tuple[int, int]] = {
    "subject_id": (0, 14),
    "eligstat": (14, 15),
    "mortstat": (15, 16),
    "ucod_leading": (16, 19),
    "death_diabetes": (19, 20),
    "death_hypertension": (20, 21),
    "permth_int": (42, 45),
    "permth_exm": (45, 48),
}

# ucod_leading 코드표. NCHS 가 정한 10 분류다.
CAUSE_LABELS: dict[str, str] = {
    "001": "심장질환",
    "002": "악성신생물",
    "003": "만성하기도질환",
    "004": "사고",
    "005": "뇌혈관질환",
    "006": "알츠하이머병",
    "007": "당뇨병",
    "008": "인플루엔자·폐렴",
    "009": "신장염·신증후군",
    "010": "그 외 전체",
}


def fetch(name: str, destination: Path, *, force: bool) -> str:
    target = destination / name
    if target.exists() and not force:
        return "skip"
    request = urllib.request.Request(f"{BASE_URL}/{name}", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        return f"HTTP {error.code}"
    except (urllib.error.URLError, TimeoutError) as error:
        return f"실패 {error}"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    return "ok"


def parse(text: str, cycle: str) -> pd.DataFrame:
    """고정폭 한 줄씩. 결측은 마침표로 온다."""
    rows = []
    for line in text.splitlines():
        if not line.strip():
            continue
        record: dict[str, object] = {"cycle": cycle}
        for name, (start, end) in FIELDS.items():
            value = line[start:end].strip()
            record[name] = value if value and value != "." else None
        rows.append(record)
    frame = pd.DataFrame(rows)
    for column in ("subject_id", "eligstat", "mortstat", "permth_int", "permth_exm"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    for column in ("death_diabetes", "death_hypertension"):
        frame[column] = (
            pd.to_numeric(frame[column], errors="coerce").eq(1).astype("boolean").where(frame[column].notna())
        )
    frame["cause"] = frame["ucod_leading"].map(CAUSE_LABELS)
    # 연계 대상이 아닌 사람은 생존·사망 어느 쪽으로도 세면 안 된다.
    frame["deceased"] = frame["mortstat"].eq(1).astype("boolean").where(frame["eligstat"].eq(1))
    # 검진 시점 기준 추적 연수. 검진을 안 받은 사람은 면접 기준으로 대신한다.
    months = frame["permth_exm"].fillna(frame["permth_int"])
    frame["followup_years"] = (months / 12.0).round(3)
    return frame


def main() -> int:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, default=here / "raw" / "mortality")
    parser.add_argument("--out", type=Path, default=here / "processed" / "mortality.csv")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    frames = []
    for cycle, name in CYCLES:
        status = fetch(name, args.raw, force=args.force)
        path = args.raw / name
        if not path.exists():
            print(f"  {cycle}  {status}  — 건너뜀")
            continue
        frame = parse(path.read_text(encoding="ascii"), cycle)
        eligible = int(frame["deceased"].notna().sum())
        deaths = int(frame["deceased"].sum(skipna=True))
        median = frame.loc[frame["deceased"].notna(), "followup_years"].median()
        print(
            f"  {cycle}  {status:<5} {len(frame):>6,}행  연계대상 {eligible:>6,}  "
            f"사망 {deaths:>5,} ({deaths / max(eligible, 1):.1%})  추적중앙 {median:.1f}년"
        )
        frames.append(frame)

    if not frames:
        print("받은 파일이 없다.")
        return 1

    pooled = pd.concat(frames, ignore_index=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    pooled.to_csv(args.out, index=False)

    eligible = pooled["deceased"].notna()
    print(
        f"\n합계 {len(pooled):,}행 / 연계대상 {int(eligible.sum()):,} / 사망 {int(pooled['deceased'].sum(skipna=True)):,}"
    )
    causes = pooled.loc[pooled["deceased"].eq(True), "cause"].value_counts()
    print("주요 사인")
    for name, count in causes.items():
        print(f"  {name:<16}{count:>6,}")
    print(f"\n→ {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
