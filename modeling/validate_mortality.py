"""위험도가 실제로 뭔가를 뜻하는가 — 사망연계로 검증한다.

이 저장소의 모든 성능 수치는 **같은 시점의 라벨**을 맞히는 능력이다. 공복혈당이
126 을 넘는가를 혈당 없이 맞히는 일이고, 그게 잘 되면 AUROC 가 올라간다.
그런데 제품이 사용자에게 하는 약속은 그게 아니다 — "이 수치를 관리하면 나중이
달라진다"는 쪽에 가깝다. 그 약속은 한 번도 검증된 적이 없다.

`data/load_mortality.py` 가 받아 온 NCHS 사망연계로 처음 잰다. 물음은 하나다.
**모델이 위험하다고 한 사람들이 이후에 실제로 더 많이 죽었는가.**

설계에서 조심할 것이 셋이다.

* **추적 기간이 주기마다 다르다.** 2005-2006 은 19 년을 따라갔고 2017-2018 은 2 년이다.
  사망자 수를 그냥 세면 오래된 주기가 무조건 나쁘게 나온다. 그래서 **1,000
  인년당 사망률**로 센다.
* **홀드아웃을 쓸 수 없다.** 2021-2023 은 연계본이 아직 없다. 그래서 학습을
  2005-2010 으로 앞당기고 2011-2018 을 채점 대상으로 둔다. 시간 순서는 지켜진다.
* **나이가 전부를 설명할 수 있다.** 사망의 가장 강한 예측인자는 나이이고 모델도
  나이를 쓴다. 그래서 연령대 안에서도 갈리는지를 따로 본다.

    ../.venv/Scripts/python.exe validate_mortality.py
    ../.venv/Scripts/python.exe validate_mortality.py --target dm ckd
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

from sklearn.metrics import roc_auc_score
from targets import CATEGORICAL, DERIVED, TARGETS
from train_multi import DATA, build_frame, lab_present, make_pipeline, monotone_vector

ROOT = Path(__file__).resolve().parent
MORTALITY = ROOT / "data" / "processed" / "mortality.csv"
ARTIFACTS = ROOT / "artifacts"

TRAIN_CYCLES = ("2005_2006", "2007_2008", "2009_2010")
SCORE_CYCLES = ("2011_2012", "2013_2014", "2015_2016", "2017_2018")

# 사인별 검증. 타깃과 임상적으로 이어지는 사인만 짝짓는다 — 아무 사인이나
# 붙이면 "나이를 잘 맞힌다"는 사실을 열 번 다시 확인하게 된다.
CAUSE_FOR_TARGET: dict[str, tuple[str, ...]] = {
    "dm": ("당뇨병",),
    "htn": ("심장질환", "뇌혈관질환"),
    "ckd": ("신장염·신증후군",),
    "dlp": ("심장질환", "뇌혈관질환"),
    "mets": ("심장질환", "뇌혈관질환", "당뇨병"),
}

AGE_EDGES = [19, 50, 65, 200]
AGE_LABELS = ["19-50", "50-65", "65+"]


def rate_per_1000_py(deaths: np.ndarray, years: np.ndarray) -> float:
    total = float(years.sum())
    return float(deaths.sum()) / total * 1000.0 if total > 0 else float("nan")


def decile_table(probability: np.ndarray, deaths: np.ndarray, years: np.ndarray) -> list[dict[str, Any]]:
    """위험 십분위별 사망률. 사분위가 아니라 십분위인 이유는 상위 구간의
    분리가 제품에서 실제로 쓰이는 부분이기 때문이다."""
    ranks = pd.qcut(pd.Series(probability).rank(method="first"), 10, labels=False)
    rows = []
    for bucket in range(10):
        mask = (ranks == bucket).to_numpy()
        if mask.sum() < 30:
            continue
        rows.append(
            {
                "decile": bucket + 1,
                "n": int(mask.sum()),
                "deaths": int(deaths[mask].sum()),
                "person_years": round(float(years[mask].sum()), 1),
                "rate_per_1000_py": round(rate_per_1000_py(deaths[mask], years[mask]), 2),
                "mean_risk": round(float(probability[mask].mean()), 4),
            }
        )
    return rows


def harrell_c(probability: np.ndarray, deaths: np.ndarray, years: np.ndarray, rounds: int = 200000) -> float:
    """추적 기간을 감안한 순위 일치도.

    비교 가능한 쌍은 (사망한 사람 i, i 보다 오래 추적됐거나 더 늦게 죽은 사람 j) 다.
    전수 비교는 O(n^2) 이라 무작위 표집으로 근사한다 — 표본이 수천이라 이 정도면
    소수 셋째 자리까지 안정적이다.
    """
    rng = np.random.default_rng(20260824)
    n = len(probability)
    if n < 100 or deaths.sum() < 10:
        return float("nan")
    concordant = tie = comparable = 0
    a = rng.integers(0, n, rounds)
    b = rng.integers(0, n, rounds)
    for i, j in zip(a, b):
        if i == j:
            continue
        # i 가 죽었고 j 가 i 보다 오래 살아남았다면 비교 가능
        if deaths[i] and years[i] < years[j]:
            first, second = i, j
        elif deaths[j] and years[j] < years[i]:
            first, second = j, i
        else:
            continue
        comparable += 1
        if probability[first] > probability[second]:
            concordant += 1
        elif probability[first] == probability[second]:
            tie += 1
    if comparable == 0:
        return float("nan")
    return (concordant + 0.5 * tie) / comparable


def run_target(
    data: pd.DataFrame, mortality: pd.DataFrame, key: str, tier: str, model: str
) -> dict[str, Any] | None:
    target = TARGETS[key]
    lab_only = [c for c in target.features("lab") if c not in set(target.features("basic")) and c not in DERIVED]

    label = data[target.label].astype("boolean")
    usable = label.notna()
    if tier == "lab":
        usable = usable & lab_present(data, lab_only)
    subset = data.loc[usable].copy()
    cycle = subset["cycle"].astype(str)

    train_mask = cycle.isin(TRAIN_CYCLES).to_numpy()
    score_mask = cycle.isin(SCORE_CYCLES).to_numpy()
    if train_mask.sum() < 1000 or score_mask.sum() < 1000:
        return None

    columns = target.features(tier)
    frame = build_frame(subset, columns)
    y = label[usable].astype(int)

    numeric = [c for c in columns if c not in CATEGORICAL]
    categorical = [c for c in columns if c in CATEGORICAL]
    monotone = monotone_vector(frame, numeric, categorical) if model == "xgboost" else None
    pipeline = make_pipeline(numeric, categorical, model, monotone)
    pipeline.fit(frame.iloc[train_mask], y.iloc[train_mask])
    probability = pipeline.predict_proba(frame.iloc[score_mask])[:, 1]

    scored = subset.iloc[score_mask][["seqn", "cycle", "age"]].copy()
    scored["probability"] = probability
    merged = scored.merge(mortality, on=["seqn", "cycle"], how="inner")
    merged = merged[merged["deceased"].notna() & merged["followup_years"].gt(0)]
    if len(merged) < 500:
        return None

    deaths = merged["deceased"].astype(bool).to_numpy()
    years = merged["followup_years"].to_numpy(dtype=float)
    risk = merged["probability"].to_numpy(dtype=float)

    entry: dict[str, Any] = {
        "target": key,
        "name": target.name,
        "tier": tier,
        "model": model,
        "n_linked": int(len(merged)),
        "deaths": int(deaths.sum()),
        "person_years": round(float(years.sum()), 1),
        "overall_rate_per_1000_py": round(rate_per_1000_py(deaths, years), 2),
        "harrell_c_all_cause": round(harrell_c(risk, deaths, years), 4),
        "deciles": decile_table(risk, deaths, years),
    }
    top, bottom = entry["deciles"][-1], entry["deciles"][0]
    if bottom["rate_per_1000_py"] > 0:
        entry["top_vs_bottom_rate_ratio"] = round(top["rate_per_1000_py"] / bottom["rate_per_1000_py"], 2)

    # 연령대 안에서도 갈리는가. 나이 하나로 설명되면 여기서 1.0 근처로 무너진다.
    age = pd.to_numeric(merged.get("age", pd.Series(index=merged.index, dtype=float)), errors="coerce")
    if age.notna().any():
        band = pd.cut(age, AGE_EDGES, labels=AGE_LABELS, right=False)
        within = {}
        for name in AGE_LABELS:
            mask = band.eq(name).to_numpy()
            if mask.sum() < 300 or deaths[mask].sum() < 20:
                continue
            within[name] = {
                "n": int(mask.sum()),
                "deaths": int(deaths[mask].sum()),
                "harrell_c": round(harrell_c(risk[mask], deaths[mask], years[mask]), 4),
            }
        entry["within_age_band"] = within

    # 사인별. 그 사인으로 죽은 것만 사건으로 세고 나머지는 중도절단으로 둔다.
    causes = CAUSE_FOR_TARGET.get(key)
    if causes:
        specific = merged["cause"].isin(causes).to_numpy() & deaths
        if specific.sum() >= 15:
            entry["cause_specific"] = {
                "causes": list(causes),
                "events": int(specific.sum()),
                "harrell_c": round(harrell_c(risk, specific, years), 4),
                "auroc_naive": round(float(roc_auc_score(specific.astype(int), risk)), 4),
            }
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--mortality", type=Path, default=MORTALITY)
    parser.add_argument("--target", nargs="*", default=[k for k, t in TARGETS.items() if t.serve])
    parser.add_argument("--tiers", nargs="*", default=["basic", "lab"])
    parser.add_argument("--models", nargs="*", default=["xgboost"])
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "mortality_validation.json")
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    mortality = pd.read_csv(args.mortality, low_memory=False)
    # 학습 테이블의 subject_id 는 "2005_2006_31130" 처럼 주기가 접두사로 붙어 있고
    # 사망연계 파일은 SEQN 원본이다. 마지막 밑줄 뒤가 SEQN 이다.
    data["seqn"] = pd.to_numeric(data["subject_id"].astype(str).str.rsplit("_", n=1).str[-1], errors="coerce")
    mortality["seqn"] = pd.to_numeric(mortality["subject_id"], errors="coerce")
    mortality["deceased"] = mortality["deceased"].map({True: True, False: False, "True": True, "False": False})

    print(f"학습 {'/'.join(TRAIN_CYCLES)} → 채점 {'/'.join(SCORE_CYCLES)}\n")

    results = []
    for key in args.target:
        for tier in args.tiers:
            if tier not in TARGETS[key].tiers:
                continue
            for model in args.models:
                entry = run_target(data, mortality, key, tier, model)
                if entry is None:
                    print(f"{TARGETS[key].name:<16}{tier:<7}건너뜀 (표본 부족)")
                    continue
                results.append(entry)
                within = entry.get("within_age_band", {})
                inner = " ".join(f"{k}={v['harrell_c']:.3f}" for k, v in within.items())
                print(
                    f"{entry['name']:<16}{tier:<7}n={entry['n_linked']:>6,} 사망={entry['deaths']:>4,}  "
                    f"C={entry['harrell_c_all_cause']:.3f}  상하위비={entry.get('top_vs_bottom_rate_ratio', float('nan')):>5.1f}배"
                )
                if inner:
                    print(f"{'':<23}연령대 내부 C: {inner}")
                if "cause_specific" in entry:
                    c = entry["cause_specific"]
                    print(f"{'':<23}사인 {'·'.join(c['causes'])} {c['events']}건 → C={c['harrell_c']:.3f}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(
            {"train_cycles": TRAIN_CYCLES, "score_cycles": SCORE_CYCLES, "results": results},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n→ {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
