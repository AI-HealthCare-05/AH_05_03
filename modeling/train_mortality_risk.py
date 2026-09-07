"""5년 사망 위험 — 이 저장소에서 **시간이 붙은 유일한 라벨**로 학습한다.

왜 이 모델이 따로 있는가
------------------------
번들 20개(`train_multi.py`)는 전부 **단면 라벨**이다. "지금 기준을 넘었는가" 를 맞히고,
발병 시점을 학습한 적이 없다. 2단계 발병 궤적(`app/services/trajectory.py`)도 학습이
아니라 단면 유병률을 illness-death 모형으로 뒤집어 만든 표다.

저장소 안에서 관측된 사건과 그 **시점**이 같이 있는 자료는 NCHS 사망연계 하나뿐이다
(`data/processed/mortality.csv` — `permth_int` 는 조사 시점부터의 개월 수다). 그래서
"5년 안에" 라는 말을 유도가 아니라 관측으로 뒷받침할 수 있는 라벨도 이것 하나다.

**대신 사건이 발병이 아니라 사망이다.** 이 모델이 답하는 것은 "5년 안에 당뇨에
걸릴 확률" 이 아니라 "5년 안에 사망할 확률" 이고, 둘을 같은 화면에서 같은 말로
부르면 안 된다. 질환별 사인(`death_diabetes`·`death_hypertension`)도 같이 재지만
그건 "그 병으로 죽을 확률" 이지 "그 병에 걸릴 확률" 이 아니다.

주기를 왜 다섯 개만 쓰는가
--------------------------
사망연계 추적창이 2019 년쯤 끝난다. 실측(2026-09-04):

    주기        n      사망   추적개월 최대   60개월 도달
    2005_2006   5245   1024   180            93.4%
    2007_2008   6079   1125   160            93.2%
    2009_2010   6367    859   135            94.2%
    2011_2012   5704    626   113            93.8%
    2013_2014   5910    467    85            93.7%
    2015_2016   5836    275     61             2.7%   ← 못 쓴다
    2017_2018   5667    145     37             0.0%   ← 못 쓴다

마지막 두 주기는 **5 년을 채운 사람이 사실상 없다.** 그대로 넣으면 검열된 생존자가
전부 빠지고 사망자만 남아 그 주기의 양성률이 100% 에 가까워진다. 라벨이 오염되므로
주기째 뺀다. NHANES 2021_2023 은 연계 파일 자체가 없다.

이 제약 때문에 **홀드아웃 주기가 번들 20개(2021_2023)와 다르다.** 여기서는
2013_2014 를 뗀다 — 5 년 라벨을 만들 수 있는 주기 중 가장 최근이다.

검열을 어떻게 다루는가
----------------------
이산 시점 하나(60개월)만 보므로 생존 모형 대신 **경계가 분명한 이진 라벨**로 접는다.

* 양성 — 사망했고 `permth_int <= 60`
* 음성 — `permth_int >= 60` (60개월을 넘겨 살아 있었다. 그 뒤 죽었는지는 안 본다)
* 버림 — 살아 있는데 추적이 60개월을 못 채운 행. 5년 안에 죽었는지 **모른다**

버리는 행이 전체의 일부라 표본이 줄지만, 모르는 것을 음성으로 세는 것보다 낫다.
Harrell's C 는 버리지 않은 전체 추적으로 따로 잰다 — 그쪽은 검열을 다룰 수 있다.

    ../.venv/Scripts/python.exe train_mortality_risk.py
    ../.venv/Scripts/python.exe train_mortality_risk.py --model logistic
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "data"))

from metrics import evaluate  # noqa: E402
from splits import SEED  # noqa: E402
from targets import BASIC_FEATURES, CATEGORICAL, LAB_FEATURES  # noqa: E402
from train_multi import build_frame, make_pipeline  # noqa: E402

DATA = ROOT / "data" / "processed"
ARTIFACTS = ROOT / "artifacts"

#: 5년(60개월) 지평. 사용자가 요구한 "최대 5년" 이 그대로 여기 있다.
HORIZON_MONTHS = 60

#: 그 주기 응답자의 몇 %가 60개월을 채웠으면 쓸 만한가. 실측에서 93% 대와 3% 미만으로
#: 뚜렷하게 갈려서 중간값을 고를 필요가 없었다.
MIN_REACHED = 0.50

#: 질환별 사인. 전체 사망과 **따로** 잰다 — 사건 수가 한 자릿수 백 단위라 신뢰구간이
#: 넓고, 같은 표에 나란히 놓으면 같은 무게로 읽힌다.
CAUSE_COLUMNS = ("death_diabetes", "death_hypertension")


def load_linked() -> pd.DataFrame:
    """학습 테이블과 사망연계를 잇는다.

    조인 키가 그냥 `subject_id` 가 아니다. 학습 테이블은 `"2005_2006_31130"` 처럼
    주기를 접두사로 붙여 두었고 연계 파일은 원래 SEQN 을 그대로 들고 있다.
    `validate_mortality.py` 가 쓰는 규칙과 같아야 두 산출물이 같은 사람을 가리킨다.
    """
    frame = pd.read_csv(DATA / "nhanes_pooled.csv", low_memory=False)
    mortality = pd.read_csv(DATA / "mortality.csv", low_memory=False)
    frame["seqn"] = pd.to_numeric(frame["subject_id"].astype(str).str.rsplit("_", n=1).str[-1], errors="coerce")
    mortality["seqn"] = pd.to_numeric(mortality["subject_id"], errors="coerce")
    linked = frame.merge(mortality.drop(columns=["subject_id"]), on=["seqn", "cycle"], how="inner")
    return linked[linked["eligstat"] == 1].copy()


def usable_cycles(linked: pd.DataFrame) -> list[str]:
    """60개월을 채운 비율이 `MIN_REACHED` 이상인 주기만."""
    reached = linked.groupby("cycle")["permth_int"].apply(lambda s: (s >= HORIZON_MONTHS).mean())
    return sorted(reached[reached >= MIN_REACHED].index.astype(str))


def label_five_year(linked: pd.DataFrame) -> pd.DataFrame:
    """5년 사망 이진 라벨. 검열된 행은 버린다(모듈 머리말 참조)."""
    died_within = (linked["mortstat"] == 1) & (linked["permth_int"] <= HORIZON_MONTHS)
    survived_past = linked["permth_int"] >= HORIZON_MONTHS
    out = linked[died_within | survived_past].copy()
    out["label_death_5yr"] = died_within[died_within | survived_past].astype(int)
    for column in CAUSE_COLUMNS:
        out[f"label_{column}_5yr"] = (out[column].eq(1) & out["label_death_5yr"].eq(1)).astype(int)
    return out


def harrell_c(probability: np.ndarray, deaths: np.ndarray, years: np.ndarray, rounds: int = 200_000) -> float:
    """검열을 다루는 순위 지표. 5년 창 밖의 정보까지 쓴다.

    표본쌍을 무작위로 뽑아 재는 이유는 40,000 행에서 완전 쌍 비교가 8 억 번이기
    때문이다. `validate_mortality.py` 와 같은 방식이라 두 숫자를 나란히 놓을 수 있다.
    """
    rng = np.random.default_rng(SEED)
    n = len(deaths)
    i = rng.integers(0, n, rounds)
    j = rng.integers(0, n, rounds)
    # 비교 가능한 쌍: 먼저 죽은 쪽이 실제로 사망 사건이어야 한다.
    earlier_died = deaths[i] & (years[i] < years[j])
    later_died = deaths[j] & (years[j] < years[i])
    usable = earlier_died | later_died
    if usable.sum() == 0:
        return float("nan")
    high_risk_first = np.where(earlier_died, probability[i] > probability[j], probability[j] > probability[i])
    tied = probability[i] == probability[j]
    concordant = high_risk_first[usable].sum() + 0.5 * tied[usable].sum()
    return float(concordant / usable.sum())


def run_tier(labelled: pd.DataFrame, tier: str, holdout_cycle: str, model: str) -> dict[str, Any]:
    # 번들 20개와 **같은 특징 집합**을 쓴다. 파생 비율도 `build_frame` 이 만든다 —
    # 여기서 다시 계산하면 두 모델이 조용히 다른 특징을 보게 된다(AGENTS.md §2-5).
    raw = [*BASIC_FEATURES, *(LAB_FEATURES if tier == "lab" else ())]
    derived = (
        ["tg_hdl_ratio", "non_hdl", "ast_alt_ratio", "waist_height_ratio"] if tier == "lab" else ["waist_height_ratio"]
    )
    numeric = [c for c in [*raw, *derived] if c not in CATEGORICAL]
    categorical = [c for c in CATEGORICAL if c in labelled.columns]

    frame = labelled.dropna(subset=["label_death_5yr"])
    if tier == "lab":
        # 정밀형은 검사값이 실제로 있는 사람만. 전부 중앙값으로 채우면 일반형과
        # 같은 모델이 되고, "검사값을 넣으면 나아진다" 를 못 보여준다.
        present = frame[[c for c in LAB_FEATURES if c in frame.columns]].notna().any(axis=1)
        frame = frame[present]

    is_holdout = frame["cycle"].astype(str).eq(holdout_cycle)
    train, holdout = frame[~is_holdout], frame[is_holdout]

    columns = [*numeric, *categorical]
    pipeline = make_pipeline(numeric, categorical, model=model, seed=SEED)
    pipeline.fit(build_frame(train, columns), train["label_death_5yr"])
    probability = pipeline.predict_proba(build_frame(holdout, columns))[:, 1]

    # **나이만 쓴 기준선.** 사망은 나이가 크게 끄는 사건이라, 이걸 같이 재지 않으면
    # AUROC 0.88 이 "모델이 좋다" 인지 "나이가 좋다" 인지 구별되지 않는다. 나머지
    # 특징이 실제로 더하는 값이 두 수의 차이다.
    age_only = make_pipeline(["age"], [], model=model, seed=SEED)
    age_only.fit(build_frame(train, ["age"]), train["label_death_5yr"])
    age_probability = age_only.predict_proba(build_frame(holdout, ["age"]))[:, 1]
    age_scored = evaluate(holdout["label_death_5yr"].to_numpy(), age_probability) or {}

    result: dict[str, Any] = {
        "tier": tier,
        "model": model,
        "trained_rows": int(len(train)),
        "holdout_rows": int(len(holdout)),
        "holdout_cycle": holdout_cycle,
        "features": {"numeric": numeric, "categorical": categorical},
        "five_year": evaluate(holdout["label_death_5yr"].to_numpy(), probability),
        "base_rate": round(float(holdout["label_death_5yr"].mean()), 4),
        "age_only_baseline": {"auroc": age_scored.get("auroc"), "auprc": age_scored.get("auprc")},
    }

    # 검열까지 쓰는 순위 지표. 5년 창으로 자르지 않은 전체 추적을 본다.
    full = labelled[labelled["cycle"].astype(str).eq(holdout_cycle)]
    full = full[full["followup_years"].notna() & full["followup_years"].gt(0)]
    if tier == "lab":
        present = full[[c for c in LAB_FEATURES if c in full.columns]].notna().any(axis=1)
        full = full[present]
    if len(full) > 500:
        full_probability = pipeline.predict_proba(build_frame(full, columns))[:, 1]
        result["harrell_c_full_followup"] = round(
            harrell_c(
                full_probability,
                full["deceased"].fillna(0).infer_objects(copy=False).astype(bool).to_numpy(),
                full["followup_years"].to_numpy(dtype=float),
            ),
            4,
        )
        result["harrell_c_rows"] = int(len(full))

    causes: dict[str, Any] = {}
    for column in CAUSE_COLUMNS:
        key = f"label_{column}_5yr"
        events = int(holdout[key].sum())
        # 사건이 적으면 AUROC 를 내지 않는다. 스무 명 남짓에서 나온 0.8 은
        # 신뢰구간이 0.6~0.95 라 표에 적을 값이 아니다. `evaluate` 가 그 문턱을
        # 스스로 지키고 못 재면 `None` 을 돌려준다.
        scored = evaluate(holdout[key].to_numpy(), probability, min_positives=25)
        causes[column] = {
            "events_in_holdout": events,
            "auroc": scored.get("auroc") if scored else None,
        }
    result["cause_specific"] = causes
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="xgboost", choices=("xgboost", "logistic"))
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "mortality_risk.json")
    args = parser.parse_args()

    linked = load_linked()
    cycles = usable_cycles(linked)
    dropped = sorted(set(linked["cycle"].astype(str)) - set(cycles))
    linked = linked[linked["cycle"].astype(str).isin(cycles)]
    labelled = label_five_year(linked)
    holdout_cycle = cycles[-1]

    report: dict[str, Any] = {
        "horizon_months": HORIZON_MONTHS,
        "event": "all-cause death within 5 years of the interview",
        "not_an_onset_model": "사건은 사망이다. '그 병에 걸릴 확률' 이 아니다.",
        "usable_cycles": cycles,
        "dropped_cycles": {c: "60개월을 채운 응답자 비율이 절반 미만" for c in dropped},
        "holdout_cycle": holdout_cycle,
        "linked_rows": int(len(linked)),
        "labelled_rows": int(len(labelled)),
        "censored_dropped": int(len(linked) - len(labelled)),
        "positives": int(labelled["label_death_5yr"].sum()),
        "tiers": [run_tier(labelled, tier, holdout_cycle, args.model) for tier in ("basic", "lab")],
    }
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"주기 {cycles} · 홀드아웃 {holdout_cycle} · 버린 주기 {dropped}")
    print(f"라벨 {report['labelled_rows']}행 · 양성 {report['positives']} · 검열로 버림 {report['censored_dropped']}")
    for tier in report["tiers"]:
        five = tier["five_year"] or {}
        print(
            f"  {tier['tier']:6} 학습 {tier['trained_rows']:6d} · 홀드아웃 {tier['holdout_rows']:5d}"
            f" · 양성률 {tier['base_rate']:.4f}"
            f" · AUROC {five.get('auroc')} (나이만 {tier['age_only_baseline']['auroc']})"
            f" · AUPRC {five.get('auprc')}"
            f" · ECE {five.get('ece')} · C(전체추적) {tier.get('harrell_c_full_followup')}"
        )
    print(f"→ {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
