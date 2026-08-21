"""Train / holdout split by survey cycle, plus stratified CV inside the train part.

A random split would put respondents from the same NHANES cycle on both sides
and flatter the model. Holding out a whole cycle answers the question that
matters: does this generalise to a survey wave it has never seen?

The family-history variants force a different holdout. NHANES dropped the family
history block after 2018, so those rows only exist in 2013-2018 and the usual
2021-2023 holdout would be empty.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from sklearn.model_selection import StratifiedKFold

SEED = 20260820

DEFAULT_HOLDOUT = "2021_2023"
FAMILY_HISTORY_HOLDOUT = "2017_2018"


@dataclass(frozen=True)
class Split:
    train_index: pd.Index
    holdout_index: pd.Index
    holdout_cycle: str
    train_cycles: list[str]


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


def cv_folds(y: pd.Series, n_splits: int = 5) -> StratifiedKFold:
    return StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=SEED)
