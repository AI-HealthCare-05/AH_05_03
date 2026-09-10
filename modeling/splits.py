"""Train / holdout split by survey cycle, plus stratified CV inside the train part.

A random split would put respondents from the same NHANES cycle on both sides
and flatter the model. Holding out a whole cycle answers the question that
matters: does this generalise to a survey wave it has never seen?

The family-history variants force a different holdout. NHANES dropped the family
history block after 2018, so those rows only exist in 2013-2018 and the usual
2021-2023 holdout would be empty.

패널 자료는 주기로 자르면 안 된다
---------------------------------
위 `make_split` 은 **단면** 자료용이다. NHANES 는 사람이 한 번만 나오므로 주기로
자르면 사람도 같이 갈린다. 파동이 둘 이상인 패널(한국의료패널·KLoSA·CHARLS)에서는
같은 사람이 여러 파동에 나오므로, 주기로 자르면 **같은 사람이 학습과 홀드아웃 양쪽에
앉는다.** 그러면 모델이 그 사람을 외운 것을 일반화로 착각해 성능이 부풀려지는데,
지표만 보면 좋아 보여서 잡히지 않는다 — 라벨 누출과 같은 종류의 사고다.

그래서 패널에는 `make_person_split` 을 쓴다. 사람을 단위로 자르고 그 사람의 모든
파동을 한쪽에 몰아 넣는다.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import pandas as pd
from sklearn.model_selection import StratifiedKFold

SEED = 20260820

DEFAULT_HOLDOUT = "2021_2023"
FAMILY_HISTORY_HOLDOUT = "2017_2018"

#: 패널 홀드아웃에 넣을 사람의 비율. 단면 쪽 주기 홀드아웃(8개 주기 중 1개, 약 12%)과
#: 비슷하게 두어 두 축의 홀드아웃 크기가 크게 다르지 않게 한다.
DEFAULT_PERSON_HOLDOUT_FRACTION = 0.2


@dataclass(frozen=True)
class Split:
    train_index: pd.Index
    holdout_index: pd.Index
    holdout_cycle: str
    train_cycles: list[str]


@dataclass(frozen=True)
class PersonSplit:
    """사람 단위 분할. 한 사람의 모든 파동이 한쪽에만 있다."""

    train_index: pd.Index
    holdout_index: pd.Index
    train_people: int
    holdout_people: int


def choose_holdout(uses_family_history: bool) -> str:
    return FAMILY_HISTORY_HOLDOUT if uses_family_history else DEFAULT_HOLDOUT


def make_split(cycle: pd.Series, holdout_cycle: str) -> Split:
    """``cycle`` is the per-row cycle tag, aligned to the feature matrix index."""
    cycles = sorted(cycle.dropna().unique())
    if holdout_cycle not in cycles:
        raise ValueError(f"홀드아웃 주기 {holdout_cycle} 가 데이터에 없습니다. 있는 주기: {cycles}")

    is_holdout = cycle.eq(holdout_cycle)
    return Split(
        train_index=cycle.index[~is_holdout],
        holdout_index=cycle.index[is_holdout],
        holdout_cycle=holdout_cycle,
        train_cycles=[c for c in cycles if c != holdout_cycle],
    )


def make_person_split(
    subject: pd.Series,
    *,
    holdout_fraction: float = DEFAULT_PERSON_HOLDOUT_FRACTION,
    seed: int = SEED,
) -> PersonSplit:
    """패널 자료를 **사람 단위**로 자른다. ``subject`` 는 행별 사람 id.

    사람 id 를 해시로 정렬해 앞쪽 `holdout_fraction` 을 홀드아웃에 넣는다. 난수
    셔플이 아니라 **해시**를 쓰는 이유는 셋이다.

    1. 같은 사람은 파동이 늘어나도 **늘 같은 쪽**에 간다. 새 파동이 들어와도 홀드아웃
       구성이 안 흔들려서 전후 성능을 견줄 수 있다.
    2. 자료를 이어 붙이는 순서에 답이 안 달린다. 행 순서가 바뀌어도 같은 분할이다.
    3. 파일을 나눠 처리해도 같은 결정이 나온다.

    `seed` 는 해시에 섞는다. 바꾸면 분할이 통째로 달라지므로 성능을 견줄 때는 고정한다.
    """
    if not 0.0 < holdout_fraction < 1.0:
        raise ValueError(f"holdout_fraction 은 0 과 1 사이여야 합니다: {holdout_fraction}")

    people = subject.dropna().astype(str).unique()
    if len(people) < 2:
        raise ValueError(f"사람이 {len(people)}명이라 사람 단위로 자를 수 없습니다.")

    def bucket(person: str) -> float:
        digest = hashlib.sha256(f"{seed}:{person}".encode()).digest()
        # 앞 8바이트를 [0, 1) 로. 사람 id 의 모양(연속 정수·문자열)에 답이 안 달린다.
        return int.from_bytes(digest[:8], "big") / 2**64

    holdout_people = {person for person in people if bucket(person) < holdout_fraction}
    # 비율이 아주 작거나 사람이 적으면 한쪽이 빌 수 있다. 빈 홀드아웃은 조용히
    # "전부 학습" 이 되므로 여기서 막는다.
    if not holdout_people or len(holdout_people) == len(people):
        raise ValueError(f"사람 {len(people)}명을 {holdout_fraction} 로 자르니 한쪽이 비었습니다. 비율을 조정하세요.")

    is_holdout = subject.astype(str).isin(holdout_people)
    return PersonSplit(
        train_index=subject.index[~is_holdout],
        holdout_index=subject.index[is_holdout],
        train_people=len(people) - len(holdout_people),
        holdout_people=len(holdout_people),
    )


def cv_folds(y: pd.Series, n_splits: int = 5) -> StratifiedKFold:
    return StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=SEED)
