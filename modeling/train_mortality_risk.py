"""1·3·5년 사망 위험 — 이 저장소에서 **시간이 붙은 유일한 라벨**로 학습한다.

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

지평이 왜 셋인가
----------------
2026-09-10 에 60개월 하나에서 **12·36·60개월 셋**으로 늘렸다. 화면의 발병 궤적이
1·3·5년을 적는데(`app/services/trajectory.py` 의 `HORIZONS`) 사망 쪽은 5년 하나뿐이라
두 곡선의 지평이 달랐다. 사망연계는 개월 수를 그대로 들고 있어서 창을 자르는 것
말고는 할 일이 없다 — **셋 다 유도가 아니라 관측이다.**

주기를 왜 지평마다 다르게 쓰는가
--------------------------------
사망연계 추적창이 2019 년쯤 끝난다. 실측(2026-09-04):

    주기        n      사망   추적개월 최대   60개월 도달
    2005_2006   5245   1024   180            93.4%
    2007_2008   6079   1125   160            93.2%
    2009_2010   6367    859   135            94.2%
    2011_2012   5704    626   113            93.8%
    2013_2014   5910    467    85            93.7%
    2015_2016   5836    275     61             2.7%   ← 60개월엔 못 쓴다
    2017_2018   5667    145     37             0.0%   ← 60개월엔 못 쓴다

마지막 두 주기는 **5 년을 채운 사람이 사실상 없다.** 그대로 넣으면 검열된 생존자가
전부 빠지고 사망자만 남아 그 주기의 양성률이 100% 에 가까워진다. 라벨이 오염되므로
주기째 뺀다. NHANES 2021_2023 은 연계 파일 자체가 없다.

**그런데 그 두 주기는 12·36개월 창에서는 살아난다.** 2017_2018 은 추적이 37개월까지
있어서 1년 라벨을 만들 수 있다. 짧은 지평이 데이터를 더 여는 것이고, 그래서 이
스크립트는 두 가지를 **따로** 낸다.

* `horizons` — 세 지평이 **같은 주기·같은 홀드아웃**을 쓴다. 세 숫자를 한 표에
  나란히 놓으려면 같은 사람들 위에서 재야 한다. 주기 집합은 가장 빡빡한 지평
  (60개월)이 정하므로 5년 행은 예전 단일 지평 실행과 같은 숫자다.
* `extended_cycles` — 지평마다 **쓸 수 있는 주기를 다 쓴다.** 표본이 늘어 값이
  달라지지만 코호트가 달라서 위 표와 **비교할 수 없다.** 짧은 지평이 데이터를
  얼마나 더 여는지를 보는 자리다.

이 제약 때문에 **홀드아웃 주기가 번들 20개(2021_2023)와 다르다.** 공통 표에서는
2013_2014 를 뗀다 — 5 년 라벨을 만들 수 있는 주기 중 가장 최근이다.

검열을 어떻게 다루는가
----------------------
지평마다 **이산 시점 하나**만 보므로 생존 모형 대신 **경계가 분명한 이진 라벨**로
접는다. 지평 `H` 개월에 대해,

* 양성 — 사망했고 `permth_int <= H`
* 음성 — `permth_int >= H` (H 개월을 넘겨 살아 있었다. 그 뒤 죽었는지는 안 본다)
* 버림 — 살아 있는데 추적이 H 개월을 못 채운 행. H 안에 죽었는지 **모른다**

버리는 행이 전체의 일부라 표본이 줄지만, 모르는 것을 음성으로 세는 것보다 낫다.
**지평을 짧게 하면 버리는 행이 줄고 양성도 같이 준다** — 앞의 것은 이득이고 뒤의
것은 손해라서, 1년 지평의 AUPRC 는 5년보다 낮게 나오는 것이 정상이다. 양성률이
다른 두 수의 AUPRC 를 직접 비교하면 안 된다(AUROC 는 비교할 수 있다).

지평마다 라벨을 따로 만들되 **모델도 지평마다 따로 학습한다.** 한 모델의 확률을
지평 셋에 나눠 쓰면 순위는 같고 수준만 다른 세 숫자가 되는데, 그건 관측이 아니라
비례 가정이다 — 그 가정을 쓰는 것이 2단계 발병 궤적이고 여기는 그럴 이유가 없다.

세 지평의 확률이 **단조가 아닐 수 있다.** 따로 학습한 세 모델이라 어떤 사람에게
F(1년) > F(3년) 이 나오는 조합이 원리적으로 가능하고, 실측에서 **실제로 흔하다**
(2026-09-10 홀드아웃: 일반형 11.1% · 정밀형 7.5%). 사망은 흡수 상태라 그 역전은
임상이 아니라 인공물이므로, 리포트의 `monotonic_and_folded` 가 역전 비율과 **왼쪽부터
누적 최댓값으로 접은 뒤의 성능**을 같이 낸다. 화면에 세 숫자를 올리려면 접고 올린다.

Harrell's C 는 버리지 않은 전체 추적으로 따로 잰다 — 그쪽은 검열을 다룰 수 있다.
**지평마다 다시 잰다.** 사건(사망)의 순서는 지평과 무관하지만 순위를 내는 모델이
지평마다 다르므로, 한 번만 재면 어느 모델의 순위인지가 흐려진다.

    ../.venv/Scripts/python.exe train_mortality_risk.py
    ../.venv/Scripts/python.exe train_mortality_risk.py --model logistic
    ../.venv/Scripts/python.exe train_mortality_risk.py --skip-extended
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

#: 지평 셋. **화면의 발병 궤적과 같은 해를 쓴다** — `app/services/trajectory.py` 의
#: `HORIZONS` 가 앞면에 1·3·5년을 적으므로 사망 쪽도 같은 세 해여야 두 곡선을 나란히
#: 놓을 수 있다. 값은 개월인데, 사망연계의 `permth_int` 가 개월이라 환산을 한 곳에서만
#: 한다 — 년으로 들고 있으면 비교할 때마다 12 를 곱하게 되고 그중 하나가 언젠가 빠진다.
HORIZONS_MONTHS: tuple[int, ...] = (12, 36, 60)

#: 그 주기 응답자의 몇 %가 지평을 채웠으면 쓸 만한가. 60개월 실측에서 93% 대와
#: 3% 미만으로 뚜렷하게 갈려서 중간값을 고를 필요가 없었다.
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


def label_column(months: int) -> str:
    """지평 라벨 칸 이름. **한 곳에서만 만든다** — 학습·평가·리포트가 같은 문자열을
    보게 하려는 것이다. 예전에는 `label_death_5yr` 하나라 이름을 박아도 됐다."""
    return f"label_death_{months}mo"


def usable_cycles(linked: pd.DataFrame, months: int) -> list[str]:
    """그 지평을 채운 비율이 `MIN_REACHED` 이상인 주기만.

    **지평마다 다르다.** 2017_2018 은 추적이 37개월까지라 60개월에는 못 쓰지만
    12개월에는 쓴다. 이 함수가 지평을 인자로 받는 것이 그 사실을 코드에 남긴다.
    """
    reached = linked.groupby("cycle")["permth_int"].apply(lambda s: (s >= months).mean())
    return sorted(reached[reached >= MIN_REACHED].index.astype(str))


def label_horizon(linked: pd.DataFrame, months: int) -> pd.DataFrame:
    """지평 `months` 개월의 사망 이진 라벨. 검열된 행은 버린다(모듈 머리말 참조).

    **지평마다 버리는 행이 다르므로 한 프레임에 세 라벨을 같이 담을 수 없다.**
    담으면 위험군(at risk)이 다른 세 라벨이 한 행에 앉고, 그중 둘은 그 사람이
    애초에 답할 수 없는 질문이 된다. 그래서 지평마다 프레임을 따로 만든다.
    """
    died_within = (linked["mortstat"] == 1) & (linked["permth_int"] <= months)
    survived_past = linked["permth_int"] >= months
    keep = died_within | survived_past
    out = linked[keep].copy()
    label = label_column(months)
    out[label] = died_within[keep].astype(int)
    for column in CAUSE_COLUMNS:
        out[f"label_{column}_{months}mo"] = (out[column].eq(1) & out[label].eq(1)).astype(int)
    return out


def restrict_to_tier(frame: pd.DataFrame, tier: str) -> pd.DataFrame:
    """정밀형은 검사값이 **실제로 있는** 사람만 남긴다.

    전부 중앙값으로 채우면 일반형과 같은 모델이 되고 "검사값을 넣으면 나아진다" 를
    못 보여준다. **판단을 한 곳에만 둔다** — 학습 프레임과 단조성 프레임이 다른
    규칙으로 걸러지면 세 지평을 견주는 비교 자체가 어긋난다(AGENTS.md §2-5).
    """
    if tier != "lab":
        return frame
    present = frame[[c for c in LAB_FEATURES if c in frame.columns]].notna().any(axis=1)
    return frame[present]


def monotonic_violation_rate(curves: list[pd.Series]) -> dict[str, Any]:
    """지평 순서대로 받은 확률들이 **감소하는 사람의 비율**.

    따로 학습한 세 모델이라 F(1년) > F(3년) 이 원리적으로 가능하다. 화면에 세 숫자를
    나란히 적는 순간 그 역전은 바로 보이므로, 올리기 전에 얼마나 흔한지 알아야 한다.
    """
    if len(curves) < 2:
        return {"rows": 0, "violations": 0, "rate": None}
    joined = pd.concat(curves, axis=1).dropna()
    if joined.empty:
        return {"rows": 0, "violations": 0, "rate": None}
    values = joined.to_numpy(dtype=float)
    decreasing = (np.diff(values, axis=1) < 0).any(axis=1)
    return {
        "rows": int(len(joined)),
        "violations": int(decreasing.sum()),
        "rate": round(float(decreasing.mean()), 4),
        "worst_drop": round(float(np.min(np.diff(values, axis=1))), 5),
    }


def fold_monotonic(curves: list[pd.Series]) -> list[pd.Series]:
    """지평 순서대로 받은 확률을 **비감소로 접는다**(왼쪽부터 누적 최댓값).

    **왜 접는 것이 정당한가.** 사망은 흡수 상태다 — 1년 안에 죽은 사람은 3년 안에도
    죽어 있다. 그러니 F(1) <= F(3) <= F(5) 는 취향이 아니라 사건의 정의다. 따로 학습한
    세 모델이 그걸 어기는 것은 임상이 아니라 인공물이고, 그래서 접는다.
    `trajectory.prevalence_curve` 가 비가역 질환에서 같은 이유로 같은 연산을 한다.

    **왼쪽부터 접는 것은 선택이다.** 오른쪽부터 최솟값으로 접으면 짧은 지평을 내리게
    되고, 등온 회귀(pool adjacent violators)는 둘을 평균한다. 셋 중 어느 것이 맞다는
    근거가 없어서 저장소가 이미 쓰는 방식(누적 최댓값)에 맞췄다. 접기 전 역전 비율은
    리포트의 `monotonic_violations` 에 남고, 접은 값의 성능은 `folded` 에 남는다 —
    **접는 쪽이 손해면 그 표에서 보인다.**
    """
    folded: list[pd.Series] = []
    running: pd.Series | None = None
    for curve in curves:
        running = curve if running is None else running.combine(curve, max)
        folded.append(running.copy())
    return folded


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


def run_tier(
    labelled: pd.DataFrame,
    tier: str,
    holdout_cycle: str,
    model: str,
    months: int,
    *,
    score_also: pd.DataFrame | None = None,
) -> tuple[dict[str, Any], pd.Series | None]:
    """지평 하나·tier 하나를 학습하고 평가한다.

    `score_also` 는 지평 사이의 단조성을 보려고 **검열 필터와 무관한 같은 행 집합**을
    한 번 더 채점하는 자리다. 지평마다 버리는 행이 달라서 홀드아웃 행 집합이 서로
    다르므로, 세 확률을 견주려면 공통 프레임이 따로 있어야 한다. 돌려주는 것은
    그 프레임의 인덱스를 그대로 단 확률이고, 필요 없으면 `None` 이다.
    """
    # 번들 20개와 **같은 특징 집합**을 쓴다. 파생 비율도 `build_frame` 이 만든다 —
    # 여기서 다시 계산하면 두 모델이 조용히 다른 특징을 보게 된다(AGENTS.md §2-5).
    raw = [*BASIC_FEATURES, *(LAB_FEATURES if tier == "lab" else ())]
    derived = (
        ["tg_hdl_ratio", "non_hdl", "ast_alt_ratio", "waist_height_ratio"] if tier == "lab" else ["waist_height_ratio"]
    )
    numeric = [c for c in [*raw, *derived] if c not in CATEGORICAL]
    categorical = [c for c in CATEGORICAL if c in labelled.columns]

    label = label_column(months)
    frame = restrict_to_tier(labelled.dropna(subset=[label]), tier)

    is_holdout = frame["cycle"].astype(str).eq(holdout_cycle)
    train, holdout = frame[~is_holdout], frame[is_holdout]

    columns = [*numeric, *categorical]
    pipeline = make_pipeline(numeric, categorical, model=model, seed=SEED)
    pipeline.fit(build_frame(train, columns), train[label])
    probability = pipeline.predict_proba(build_frame(holdout, columns))[:, 1]

    # **나이만 쓴 기준선.** 사망은 나이가 크게 끄는 사건이라, 이걸 같이 재지 않으면
    # AUROC 0.88 이 "모델이 좋다" 인지 "나이가 좋다" 인지 구별되지 않는다. 나머지
    # 특징이 실제로 더하는 값이 두 수의 차이다.
    age_only = make_pipeline(["age"], [], model=model, seed=SEED)
    age_only.fit(build_frame(train, ["age"]), train[label])
    age_probability = age_only.predict_proba(build_frame(holdout, ["age"]))[:, 1]
    age_scored = evaluate(holdout[label].to_numpy(), age_probability) or {}

    result: dict[str, Any] = {
        "horizon_months": months,
        "horizon_years": round(months / 12, 1),
        "tier": tier,
        "model": model,
        "trained_rows": int(len(train)),
        "holdout_rows": int(len(holdout)),
        "holdout_cycle": holdout_cycle,
        "features": {"numeric": numeric, "categorical": categorical},
        # 예전 이름은 `five_year` 였다. 지평이 셋이 되면서 그 이름이 거짓이 되므로
        # `scored` 로 바꿨고, 어느 지평인지는 위 `horizon_months` 가 말한다.
        "scored": evaluate(holdout[label].to_numpy(), probability),
        "base_rate": round(float(holdout[label].mean()), 4),
        "age_only_baseline": {"auroc": age_scored.get("auroc"), "auprc": age_scored.get("auprc")},
    }

    # 검열까지 쓰는 순위 지표. 지평 창으로 자르지 않은 전체 추적을 본다.
    full = labelled[labelled["cycle"].astype(str).eq(holdout_cycle)]
    full = restrict_to_tier(full[full["followup_years"].notna() & full["followup_years"].gt(0)], tier)
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
        key = f"label_{column}_{months}mo"
        events = int(holdout[key].sum())
        # 사건이 적으면 AUROC 를 내지 않는다. 스무 명 남짓에서 나온 0.8 은
        # 신뢰구간이 0.6~0.95 라 표에 적을 값이 아니다. `evaluate` 가 그 문턱을
        # 스스로 지키고 못 재면 `None` 을 돌려준다.
        #
        # **짧은 지평에서는 대부분 `None` 이 나온다.** 1년 창의 질환별 사인은
        # 홀드아웃에서 열 명 안쪽이다. 비어 있는 것이 결함이 아니라 그 문턱이
        # 일한 결과다.
        scored = evaluate(holdout[key].to_numpy(), probability, min_positives=25)
        causes[column] = {
            "events_in_holdout": events,
            "auroc": scored.get("auroc") if scored else None,
        }
    result["cause_specific"] = causes

    # 지평 사이 단조성을 보려고 공통 프레임을 한 번 더 채점한다(위 독스트링).
    scored_also: pd.Series | None = None
    if score_also is not None and len(score_also) > 0:
        scored_also = pd.Series(
            pipeline.predict_proba(build_frame(score_also, columns))[:, 1],
            index=score_also.index,
        )
    return result, scored_also


def horizon_block(
    linked: pd.DataFrame,
    cycles: list[str],
    months: int,
    model: str,
    *,
    mono_frames: dict[str, pd.DataFrame] | None = None,
) -> dict[str, Any]:
    """지평 하나를 주기 집합 `cycles` 위에서 두 tier 다 학습한다."""
    scoped = linked[linked["cycle"].astype(str).isin(cycles)]
    labelled = label_horizon(scoped, months)
    holdout_cycle = cycles[-1]
    label = label_column(months)

    tiers: list[dict[str, Any]] = []
    curves: dict[str, pd.Series] = {}
    truths: dict[str, pd.Series] = {}
    holdout_rows = labelled[labelled["cycle"].astype(str).eq(holdout_cycle)]
    for tier in ("basic", "lab"):
        mono = None if mono_frames is None else mono_frames.get(tier)
        result, scored_also = run_tier(labelled, tier, holdout_cycle, model, months, score_also=mono)
        tiers.append(result)
        if scored_also is not None:
            curves[tier] = scored_also
            # 접은 확률을 다시 평가하려면 **같은 인덱스의 라벨**이 필요하다. 지평마다
            # 검열로 버리는 행이 달라서 `_curves` 의 인덱스 중 일부는 이 지평의 라벨이
            # 없다 — 그 교집합을 main 이 잡을 수 있게 라벨을 같이 돌려준다.
            truths[tier] = restrict_to_tier(holdout_rows, tier)[label]

    return {
        "horizon_months": months,
        "horizon_years": round(months / 12, 1),
        "cycles": cycles,
        "holdout_cycle": holdout_cycle,
        "linked_rows": int(len(scoped)),
        "labelled_rows": int(len(labelled)),
        "censored_dropped": int(len(scoped) - len(labelled)),
        "positives": int(labelled[label].sum()),
        "tiers": tiers,
        "_curves": curves,
        "_truths": truths,
    }


def scored_folded(probability: pd.Series, truth: pd.Series | None) -> dict[str, Any] | None:
    """접은 확률을 그 지평의 라벨로 다시 평가한다.

    확률은 검열 필터를 걸지 않은 공통 프레임에서 왔고 라벨은 걸린 프레임에서 왔으므로
    **인덱스 교집합만** 쓴다. 그래서 여기 행 수는 위 홀드아웃 행 수보다 작을 수 있다.
    """
    if truth is None or truth.empty:
        return None
    common = probability.index.intersection(truth.index)
    if len(common) == 0:
        return None
    scored = evaluate(truth.loc[common].to_numpy(), probability.loc[common].to_numpy())
    if not scored:
        return None
    return {
        "rows": int(len(common)),
        "auroc": scored.get("auroc"),
        "auprc": scored.get("auprc"),
        "ece": scored.get("ece"),
    }


def folded_report(horizons: list[dict[str, Any]], tier: str) -> dict[str, Any]:
    """이 tier 의 지평 곡선을 모아 **역전 비율**과 **접은 뒤 성능**을 같이 낸다.

    둘을 한 곳에서 내는 이유는 하나만 보면 판단이 안 되기 때문이다. 역전이 11% 라도
    접은 뒤 AUROC 가 그대로면 접고 쓰면 되고, 접으면서 AUROC 가 떨어지면 세 모델을
    따로 학습하는 설계 자체를 다시 봐야 한다(이산시간 해저드 한 모델).
    """
    blocks = [block for block in horizons if tier in block["_curves"]]
    curves = [block["_curves"][tier] for block in blocks]
    by_horizon: list[dict[str, Any]] = []
    for block, folded in zip(blocks, fold_monotonic(curves), strict=True):
        result = next(item for item in block["tiers"] if item["tier"] == tier)
        by_horizon.append(
            {
                "horizon_months": block["horizon_months"],
                "raw_auroc": (result["scored"] or {}).get("auroc"),
                "folded": scored_folded(folded, block["_truths"].get(tier)),
            }
        )
    return {"violations": monotonic_violation_rate(curves), "by_horizon": by_horizon}


def show_blocks(blocks: list[dict[str, Any]], title: str) -> None:
    """터미널 요약. **AUROC 와 ECE 를 같은 줄에 적는다** — 둘 중 하나만 보면
    "잘 가른다" 와 "확률이 맞다" 를 헷갈린다(AGENTS.md §3)."""
    print(f"\n{title}")
    for block in blocks:
        print(
            f" {block['horizon_years']:>3}년 · 주기 {len(block['cycles'])}개"
            f" · 홀드아웃 {block['holdout_cycle']}"
            f" · 라벨 {block['labelled_rows']}행 · 양성 {block['positives']}"
            f" · 검열로 버림 {block['censored_dropped']}"
        )
        for tier in block["tiers"]:
            scored = tier["scored"] or {}
            print(
                f"   {tier['tier']:6} 학습 {tier['trained_rows']:6d} · 홀드아웃 {tier['holdout_rows']:5d}"
                f" · 양성률 {tier['base_rate']:.4f}"
                f" · AUROC {scored.get('auroc')} (나이만 {tier['age_only_baseline']['auroc']})"
                f" · AUPRC {scored.get('auprc')}"
                f" · ECE {scored.get('ece')} · C(전체추적) {tier.get('harrell_c_full_followup')}"
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="xgboost", choices=("xgboost", "logistic"))
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "mortality_risk.json")
    parser.add_argument(
        "--skip-extended",
        action="store_true",
        help="지평마다 쓸 수 있는 주기를 다 쓰는 두 번째 실행을 건너뛴다(빠른 확인용).",
    )
    args = parser.parse_args()

    linked = load_linked()
    all_cycles = sorted(set(linked["cycle"].astype(str)))

    # 지평마다 쓸 수 있는 주기가 다르다. 짧은 창이 더 많은 주기를 연다.
    per_horizon = {months: usable_cycles(linked, months) for months in HORIZONS_MONTHS}

    # **공통 주기 집합.** 세 지평을 한 표에 나란히 놓으려면 같은 사람들 위에서 재야
    # 하므로 교집합을 쓴다 — 실질적으로 가장 긴 지평(60개월)이 정한다.
    shared_cycles = sorted(set.intersection(*(set(c) for c in per_horizon.values())))
    if not shared_cycles:
        print("공통으로 쓸 수 있는 주기가 없다. 지평을 좁혀야 한다.", file=sys.stderr)
        return 1
    shared_holdout = shared_cycles[-1]

    # 단조성 비교용 공통 프레임. **검열 필터를 걸지 않는다** — 지평마다 버리는 행이
    # 달라서, 걸면 세 확률의 행 집합이 어긋난다. 여기서는 라벨을 안 쓰고 채점만 한다.
    mono_base = linked[linked["cycle"].astype(str).isin(shared_cycles)]
    mono_base = mono_base[mono_base["cycle"].astype(str).eq(shared_holdout)]
    mono_frames = {tier: restrict_to_tier(mono_base, tier) for tier in ("basic", "lab")}

    horizons = [
        horizon_block(linked, shared_cycles, months, args.model, mono_frames=mono_frames) for months in HORIZONS_MONTHS
    ]

    monotonic = {tier: folded_report(horizons, tier) for tier in ("basic", "lab")}

    report: dict[str, Any] = {
        "horizons_months": list(HORIZONS_MONTHS),
        "event": "all-cause death within the horizon, measured from the interview",
        "not_an_onset_model": "사건은 사망이다. '그 병에 걸릴 확률' 이 아니다.",
        "all_linked_cycles": all_cycles,
        "usable_cycles_by_horizon": {str(k): v for k, v in per_horizon.items()},
        "shared_cycles": shared_cycles,
        "shared_holdout_cycle": shared_holdout,
        "comparability": (
            "`horizons` 는 같은 주기·같은 홀드아웃이라 세 지평을 견줄 수 있다. "
            "`extended_cycles` 는 지평마다 코호트가 달라 견줄 수 없다."
        ),
        "auprc_note": "양성률이 지평마다 달라 AUPRC 는 지평 사이에 비교하지 않는다. AUROC 는 비교한다.",
        "monotonic_and_folded": monotonic,
        "monotonic_note": (
            "사망은 흡수 상태라 F(1)<=F(3)<=F(5) 는 사건의 정의다. 따로 학습한 세 모델이 "
            "이를 어기는 비율이 `violations` 이고, 왼쪽부터 누적 최댓값으로 접은 뒤의 "
            "성능이 `by_horizon[].folded` 다. 화면에 세 숫자를 올리려면 접고 올려야 한다."
        ),
        "horizons": horizons,
    }

    if not args.skip_extended:
        # 짧은 지평이 데이터를 얼마나 더 여는지. 코호트가 달라 위 표와 비교 불가.
        report["extended_cycles"] = [
            horizon_block(linked, per_horizon[months], months, args.model)
            for months in HORIZONS_MONTHS
            if per_horizon[months] != shared_cycles
        ]

    # 내부용 Series 는 JSON 으로 나가지 않는다. `_` 접두사가 그 표시다.
    for block in [*report["horizons"], *report.get("extended_cycles", [])]:
        block.pop("_curves", None)
        block.pop("_truths", None)

    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"지평별 쓸 수 있는 주기: { {k: len(v) for k, v in per_horizon.items()} }")
    print(f"공통 주기 {shared_cycles} · 홀드아웃 {shared_holdout}")
    show_blocks(report["horizons"], "■ 공통 주기 — 세 지평 비교 가능")
    for tier, stat in monotonic.items():
        hit = stat["violations"]
        print(f"   단조 역전 {tier:6} {hit['violations']}/{hit['rows']} ({hit['rate']}) 최악 {hit.get('worst_drop')}")
        for row in stat["by_horizon"]:
            folded = row["folded"] or {}
            print(
                f"     {row['horizon_months']:>3}개월 AUROC 원본 {row['raw_auroc']}"
                f" → 접은 뒤 {folded.get('auroc')} (행 {folded.get('rows')})"
            )
    if report.get("extended_cycles"):
        show_blocks(report["extended_cycles"], "■ 지평별 전체 주기 — 코호트가 달라 위 표와 비교 불가")
    print(f"\n→ {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
