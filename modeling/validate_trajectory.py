"""발병 궤적 검증 — 순위는 사망연계로, 절대 수준은 Framingham 으로.

`app/services/trajectory.py` 는 "지금 없다면 t년 안에 생길 확률" 을 인구 기준 위험표 ×
개인 상대위험으로 낸다. 종단 자료 없이 만든 숫자라 두 가지를 따로 물어야 한다.

A. **순위가 맞는가** — NHANES 사망연계 (같은 인구, 전향).
   학습 2005-2010 → 채점 2011-2018 의 **기저 음성**(그 주기에 그 질환이 없던 사람)
   에게 10년 누적 발병 확률 F(10) 을 매기고, 이후 그 질환 관련 사망을 얼마나 가르는지
   Harrell's C 로 잰다. 발병 자체는 못 보지만, 기저에 없던 사람이 그 병으로 죽으려면
   그 사이에 생겼어야 하므로 발병의 대리다. 1단계 확률 P(now) 의 C 와 나란히 놓는다 —
   궤적이 순위를 망가뜨리지 않았는지. 기준 위험표도 학습 주기에서만 만든다.

B. **절대 수준이 맞는가** — Framingham 3회 검진 코호트 (다른 인구, 전향).
   `raw/framingham/frmgham2.csv` 는 4,434명을 1차 검진부터 24년 추적한 교육용
   추출본이고 고혈압 발생 시점(`TIMEHYP`) 과 검진마다의 당뇨 상태를 준다. **1차 검진
   단면만으로** 유병 모델과 기준 위험표를 만들고 같은 식으로 F(t) 를 낸 뒤, 실제로
   관찰된 누적 발생(Kaplan-Meier) 과 대조한다. 단면→발병 유도가 진짜 코호트에서
   얼마나 맞는지를 재는 유일한 자리다. 인구가 1950년대 미국이라 우리 사용자와
   멀지만 묻는 것은 **방법**이지 인구가 아니다.

두 갈래 다 `project` 와 `baseline_from_prevalence` 를 그대로 쓴다 — 서빙과 같은 함수다.

    PYTHONIOENCODING=utf-8 ../.venv/Scripts/python.exe validate_trajectory.py
    ../.venv/Scripts/python.exe validate_trajectory.py --skip-framingham
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
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fit_trajectory import (  # noqa: E402
    AGE_BANDS,
    LINKED_CYCLES,
    baseline_table,
    excess_table,
    link,
    prevalence_by_age,
    to_bool,
)
from sklearn.metrics import roc_auc_score  # noqa: E402
from targets import CATEGORICAL, DERIVED, TARGETS  # noqa: E402
from train_multi import (  # noqa: E402
    DATA,
    apply_calibrator,
    build_frame,
    fit_calibrator,
    lab_present,
    make_pipeline,
    monotone_for,
)
from validate_mortality import SCORE_CYCLES, TRAIN_CYCLES, harrell_c  # noqa: E402

from app.services.trajectory import (  # noqa: E402
    HORIZONS,
    TRAJECTORY_FILE,
    TRAJECTORY_TARGETS,
    baseline_from_prevalence,
    project,
)

ROOT = Path(__file__).resolve().parent
MORTALITY = ROOT / "data" / "processed" / "mortality.csv"
FRAMINGHAM = ROOT / "data" / "raw" / "framingham" / "frmgham2.csv"
ARTIFACTS = ROOT / "artifacts"
OUT = ARTIFACTS / "trajectory_validation.json"
TRAJECTORY = ARTIFACTS / "models" / TRAJECTORY_FILE

#: 타깃과 임상적으로 이어지는 사망. 주요 사인(ucod) 또는 기여 사인 플래그.
EVENT_FOR_TARGET: dict[str, dict[str, Any]] = {
    "dm": {"causes": ("당뇨병",), "contributing": "death_diabetes", "label": "당뇨 관련 사망(주요+기여 사인)"},
    "htn": {
        "causes": ("심장질환", "뇌혈관질환"),
        "contributing": "death_hypertension",
        "label": "심뇌혈관 사망 또는 고혈압 기여 사망",
    },
    "ckd": {"causes": ("신장염·신증후군",), "contributing": None, "label": "신장염·신증후군 사망(주요 사인)"},
}

VALIDATION_AGE_BANDS = [19, 40, 50, 60, 70, 81]
VALIDATION_AGE_LABELS = ["19-40", "40-50", "50-60", "60-70", "70-80"]


# ---------------------------------------------------------------------------
# 공통
# ---------------------------------------------------------------------------


def horizon_table(
    p_now: np.ndarray,
    ages: np.ndarray,
    sexes: np.ndarray,
    baseline: dict[str, Any],
    horizons: tuple[int, ...],
) -> pd.DataFrame:
    """행마다 `project` 를 불러 지평별 F(t) 를 표로 만든다. 못 낸 지평은 NaN."""
    columns = {f"f{h}": np.full(len(ages), np.nan) for h in horizons}
    ratio = np.full(len(ages), np.nan)
    for i in range(len(ages)):
        curve = project(float(p_now[i]), float(ages[i]), str(sexes[i]), baseline, horizons=horizons)
        if curve is None:
            continue
        ratio[i] = curve["relative_hazard"]
        for h, value in zip(curve["horizons_years"], curve["onset_probability"], strict=True):
            columns[f"f{h}"][i] = value
    table = pd.DataFrame(columns)
    table["relative_hazard"] = ratio
    return table


def kaplan_meier(times: np.ndarray, events: np.ndarray, at: float) -> float:
    """t=`at` 까지의 누적 발생 1 - S(t). 동률 시각은 한 번에 처리한다."""
    order = np.argsort(times, kind="stable")
    t, e = times[order], events[order].astype(bool)
    survival = 1.0
    i, n = 0, len(t)
    while i < n and t[i] <= at:
        j = i
        while j < n and t[j] == t[i]:
            j += 1
        deaths = int(e[i:j].sum())
        at_risk = n - i
        if at_risk > 0 and deaths > 0:
            survival *= 1.0 - deaths / at_risk
        i = j
    return 1.0 - survival


# ---------------------------------------------------------------------------
# A. NHANES 사망연계 — 순위
# ---------------------------------------------------------------------------


def _temporal_fit(data: pd.DataFrame, mortality: pd.DataFrame, key: str, tier: str) -> dict[str, Any] | None:
    """학습 주기로 적합·보정하고 채점 주기의 기저 음성만 남긴다. 기준 위험표·δ 도 학습 주기에서."""
    target = TARGETS[key]
    columns = target.features(tier)
    basic = set(target.features("basic"))
    lab_only = [c for c in target.features("lab") if c not in basic and c not in DERIVED]

    label = data[target.label].astype("boolean")
    usable = label.notna()
    if tier == "lab":
        usable = usable & lab_present(data, lab_only)
    subset = data.loc[usable].reset_index(drop=True)
    y = label[usable].astype(int).reset_index(drop=True)
    cycle = subset["cycle"].astype(str)
    train_mask = cycle.isin(TRAIN_CYCLES).to_numpy()
    score_mask = cycle.isin(SCORE_CYCLES).to_numpy() & y.eq(0).to_numpy()
    if train_mask.sum() < 1000 or score_mask.sum() < 1000:
        return None

    frame = build_frame(subset, columns)
    numeric = [c for c in columns if c not in CATEGORICAL]
    categorical = [c for c in columns if c in CATEGORICAL]
    monotone = monotone_for("xgboost", frame, numeric, categorical, key)
    pipeline = make_pipeline(numeric, categorical, "xgboost", monotone)
    pipeline.fit(frame.iloc[train_mask], y.iloc[train_mask])
    calibrator = fit_calibrator(frame.iloc[train_mask], y.iloc[train_mask], numeric, categorical, "xgboost", monotone)

    # 기준 위험표와 δ 를 학습 주기에서만 만든다. 채점 주기의 유병률·사망으로 표를
    # 만들고 같은 사망을 맞히면 순환이다.
    train_rows = subset.iloc[train_mask]
    bands = excess_table(link(train_rows, mortality), target.label, bands=AGE_BANDS)
    baseline = baseline_table(train_rows, target.label, bands)
    scored = subset.loc[score_mask].reset_index(drop=True)
    p_now = apply_calibrator(pipeline.predict_proba(frame.loc[score_mask])[:, 1], calibrator)
    return {"scored": scored, "p_now": p_now, "bands": bands, "baseline": baseline}


def _horizon_metrics(linked: pd.DataFrame, dead: np.ndarray, specific: np.ndarray, years: np.ndarray) -> dict[str, Any]:
    """지평별 순위 — 10년을 못 내는 고령(70세+) 은 그 지평에서 빠진다. n 을 같이 적는다."""
    out: dict[str, Any] = {}
    for h in HORIZONS:
        have = linked[f"f{h}"].notna().to_numpy()
        if have.sum() < 500:
            continue
        f = linked.loc[have, f"f{h}"].to_numpy(dtype=float)
        p = linked.loc[have, "p_now"].to_numpy(dtype=float)
        block: dict[str, Any] = {
            "n": int(have.sum()),
            "events": int(specific[have].sum()),
            "mean_predicted": round(float(f.mean()), 4),
            "harrell_c_all_cause": round(harrell_c(f, dead[have], years[have]), 4),
            "harrell_c_all_cause_p_now": round(harrell_c(p, dead[have], years[have]), 4),
        }
        if specific[have].sum() >= 10:
            block["harrell_c_event"] = round(harrell_c(f, specific[have], years[have]), 4)
            block["harrell_c_event_p_now"] = round(harrell_c(p, specific[have], years[have]), 4)
            block["auroc_event_naive"] = round(float(roc_auc_score(specific[have].astype(int), f)), 4)
        out[str(h)] = block
    return out


def _decile_table(
    linked: pd.DataFrame, dead: np.ndarray, specific: np.ndarray, years: np.ndarray
) -> list[dict[str, Any]] | None:
    """F(10) 십분위 — 상위 십분위의 관련 사망률이 하위보다 실제로 높은가."""
    have = linked["f10"].notna().to_numpy()
    if have.sum() < 1000:
        return None
    f10 = linked.loc[have, "f10"].to_numpy(dtype=float)
    ranks = pd.qcut(pd.Series(f10).rank(method="first"), 10, labels=False).to_numpy()
    rows = []
    for bucket in range(10):
        mask = ranks == bucket
        py = float(years[have][mask].sum())
        rows.append(
            {
                "decile": bucket + 1,
                "n": int(mask.sum()),
                "mean_f10": round(float(f10[mask].mean()), 4),
                "events": int(specific[have][mask].sum()),
                "deaths": int(dead[have][mask].sum()),
                "event_rate_per_1000_py": round(float(specific[have][mask].sum()) / py * 1000.0, 3) if py else None,
            }
        )
    return rows


#: 연령대 안에서 다시 잰다. 사망은 나이에 가장 강하게 걸리고 F(10) 은 기준 위험표가
#: 고령에서 평평해져 나이와 덜 묶인다. 전체 C 로 둘을 견주면 "나이를 얼마나 따르는가"
#: 를 재게 되므로, 같은 연령대 안에서 순위가 같은지를 따로 본다.
WITHIN_AGE_EDGES = [19, 45, 55, 65, 71]
WITHIN_AGE_LABELS = ["19-45", "45-55", "55-65", "65-70"]


def _within_age_band(linked: pd.DataFrame, dead: np.ndarray, specific: np.ndarray, years: np.ndarray) -> dict[str, Any]:
    """연령대 내부 C — F(10) 과 P(now) 를 같은 사람들 위에서."""
    have = linked["f10"].notna().to_numpy()
    band = pd.cut(
        pd.to_numeric(linked["age"], errors="coerce"), WITHIN_AGE_EDGES, labels=WITHIN_AGE_LABELS, right=False
    )
    out: dict[str, Any] = {}
    for name in WITHIN_AGE_LABELS:
        mask = band.eq(name).to_numpy() & have
        if mask.sum() < 300 or dead[mask].sum() < 20:
            continue
        f = linked.loc[mask, "f10"].to_numpy(dtype=float)
        p = linked.loc[mask, "p_now"].to_numpy(dtype=float)
        block: dict[str, Any] = {
            "n": int(mask.sum()),
            "deaths": int(dead[mask].sum()),
            "events": int(specific[mask].sum()),
            "harrell_c_all_cause": round(harrell_c(f, dead[mask], years[mask]), 4),
            "harrell_c_all_cause_p_now": round(harrell_c(p, dead[mask], years[mask]), 4),
        }
        if specific[mask].sum() >= 10:
            block["harrell_c_event"] = round(harrell_c(f, specific[mask], years[mask]), 4)
            block["harrell_c_event_p_now"] = round(harrell_c(p, specific[mask], years[mask]), 4)
        out[name] = block
    return out


def _age_band_means(linked: pd.DataFrame) -> dict[str, Any]:
    """연령대별 평균 예측 — 문헌의 발생률과 나란히 놓을 숫자."""
    band = pd.cut(
        pd.to_numeric(linked["age"], errors="coerce"), VALIDATION_AGE_BANDS, labels=VALIDATION_AGE_LABELS, right=False
    )
    out: dict[str, Any] = {}
    for name in VALIDATION_AGE_LABELS:
        mask = band.eq(name).to_numpy()
        if mask.sum() < 100:
            continue
        block: dict[str, Any] = {"n": int(mask.sum())}
        for h in HORIZONS:
            values = linked.loc[mask, f"f{h}"].dropna()
            if len(values) >= 100:
                block[f"mean_f{h}"] = round(float(values.mean()), 4)
        block["mean_p_now"] = round(float(linked.loc[mask, "p_now"].mean()), 4)
        out[name] = block
    return out


def nhanes_prospective(data: pd.DataFrame, mortality: pd.DataFrame, key: str, tier: str) -> dict[str, Any] | None:
    target = TARGETS[key]
    fitted = _temporal_fit(data, mortality, key, tier)
    if fitted is None:
        return None
    scored = fitted["scored"]
    ages = pd.to_numeric(scored["age"], errors="coerce").to_numpy(dtype=float)
    sexes = scored["sex"].astype(str).to_numpy()
    table = horizon_table(fitted["p_now"], ages, sexes, fitted["baseline"], HORIZONS)
    merged = pd.concat([scored[["subject_id", "cycle", "age", "sex"]], table], axis=1)
    merged["p_now"] = fitted["p_now"]
    linked = link(merged, mortality)
    if len(linked) < 500:
        return None

    spec = EVENT_FOR_TARGET[key]
    dead = to_bool(linked["deceased"]).fillna(False).to_numpy(dtype=bool)
    specific = linked["cause"].isin(spec["causes"]).to_numpy() & dead
    if spec["contributing"]:
        specific |= to_bool(linked[spec["contributing"]]).fillna(False).to_numpy(dtype=bool) & dead
    years = pd.to_numeric(linked["followup_years"], errors="coerce").to_numpy(dtype=float)

    entry: dict[str, Any] = {
        "target": key,
        "name": target.name,
        "tier": tier,
        "train_cycles": list(TRAIN_CYCLES),
        "score_cycles": list(SCORE_CYCLES),
        "baseline_negative_linked": int(len(linked)),
        "deaths_all_cause": int(dead.sum()),
        "event_definition": spec["label"],
        "events": int(specific.sum()),
        "excess_mortality_from_train_cycles": fitted["bands"],
        "horizons": _horizon_metrics(linked, dead, specific, years),
        "within_age_band_10yr": _within_age_band(linked, dead, specific, years),
        "predicted_by_age_band": _age_band_means(linked),
    }
    deciles = _decile_table(linked, dead, specific, years)
    if deciles:
        entry["deciles_f10"] = deciles
    return entry


# ---------------------------------------------------------------------------
# B. Framingham — 절대 수준
# ---------------------------------------------------------------------------

#: 1차 검진 단면 모델의 입력. 라벨을 정의하는 값은 뺀다 — 고혈압은 혈압·강압제,
#: 당뇨는 혈당. 저장소의 라벨 누출 차단과 같은 규칙이다.
FRAMINGHAM_FEATURES: dict[str, list[str]] = {
    "htn": ["AGE", "SEX", "BMI", "TOTCHOL", "CURSMOKE", "CIGPDAY", "HEARTRTE", "educ", "GLUCOSE", "DIABETES"],
    "dm": ["AGE", "SEX", "BMI", "TOTCHOL", "CURSMOKE", "CIGPDAY", "HEARTRTE", "educ", "SYSBP", "DIABP", "PREVHYP"],
}
#: 유병률 2.7% 인 당뇨는 XGBoost(min_child_weight 50) 가 잎을 못 만든다. 로지스틱으로.
FRAMINGHAM_MODEL: dict[str, str] = {"htn": "xgboost", "dm": "logistic"}
FRAMINGHAM_HORIZONS: tuple[int, ...] = (2, 4, 6, 8, 10, 12)
FRAMINGHAM_AGE_BANDS: tuple[tuple[int, int], ...] = ((30, 45), (45, 55), (55, 65), (65, 200))
DAYS_PER_YEAR = 365.25
SEX_CODE = {1: "M", 2: "F"}


def _framingham_setup(raw: pd.DataFrame, key: str, label: str) -> dict[str, Any]:
    """1차 검진 단면 모델 + 기준 위험표 + 기저 음성의 P(now)·F(t)."""
    period1 = raw[raw["PERIOD"].eq(1)].reset_index(drop=True)
    age_from, age_to = int(period1["AGE"].min()), int(period1["AGE"].max())
    features = FRAMINGHAM_FEATURES[key]

    frame = period1[features].apply(pd.to_numeric, errors="coerce").rename(columns={"AGE": "age"})
    y = period1[label].astype(int)
    numeric = list(frame.columns)
    pipeline = make_pipeline(numeric, [], FRAMINGHAM_MODEL[key], None).fit(frame, y)
    calibrator = fit_calibrator(frame, y, numeric, [], FRAMINGHAM_MODEL[key], None)

    # 초과사망 δ — Framingham 자체의 사망(DEATH·TIMEDTH) 으로 잰다.
    death_frame = pd.DataFrame(
        {
            "age": period1["AGE"],
            "sex": period1["SEX"].map(SEX_CODE),
            label: period1[label].astype("boolean"),
            "deceased": period1["DEATH"].astype("boolean"),
            "followup_years": period1["TIMEDTH"] / DAYS_PER_YEAR,
        }
    )
    bands = excess_table(death_frame, label, bands=FRAMINGHAM_AGE_BANDS)
    baseline = {
        sex: baseline_from_prevalence(
            prevalence_by_age(death_frame, label, sex=sex, age_from=age_from, age_to=age_to, minimum=20),
            age_from,
            bands=bands,
        )
        for sex in ("M", "F")
    }

    free_mask = period1[label].eq(0).to_numpy()
    free = period1[free_mask].reset_index(drop=True)
    p_now = apply_calibrator(pipeline.predict_proba(frame[free_mask])[:, 1], calibrator)
    ages = free["AGE"].to_numpy(dtype=float)
    sexes = free["SEX"].map(SEX_CODE).astype(str).to_numpy()
    table = horizon_table(p_now, ages, sexes, baseline, FRAMINGHAM_HORIZONS)
    return {
        "period1": period1,
        "free": free,
        "p_now": p_now,
        "table": table,
        "bands": bands,
        "baseline": baseline,
        "age_range": [age_from, age_to],
    }


def framingham_hypertension(raw: pd.DataFrame) -> dict[str, Any]:
    setup = _framingham_setup(raw, "htn", "PREVHYP")
    period1, free, p_now, table = setup["period1"], setup["free"], setup["p_now"], setup["table"]
    times = (free["TIMEHYP"] / DAYS_PER_YEAR).to_numpy(dtype=float)
    events = free["HYPERTEN"].to_numpy(dtype=int)

    entry: dict[str, Any] = {
        "outcome": "고혈압 발생 (HYPERTEN·TIMEHYP)",
        "model": FRAMINGHAM_MODEL["htn"],
        "n_period1": int(len(period1)),
        "prevalence_period1": round(float(period1["PREVHYP"].mean()), 4),
        "n_free_at_baseline": int(len(free)),
        "events_observed": int(events.sum()),
        "age_range": setup["age_range"],
        "excess_mortality": setup["bands"],
        "by_horizon": {},
        "by_tertile_10yr": [],
    }
    for h in FRAMINGHAM_HORIZONS:
        column = f"f{h}"
        have = table[column].notna().to_numpy()
        if have.sum() < 200:
            continue
        entry["by_horizon"][str(h)] = {
            "n": int(have.sum()),
            "observed_km": round(kaplan_meier(times[have], events[have], float(h)), 4),
            "predicted_mean": round(float(table.loc[have, column].mean()), 4),
            "p_now_mean": round(float(p_now[have].mean()), 4),
        }
    have10 = table["f10"].notna().to_numpy()
    if have10.sum() >= 300:
        f10 = table.loc[have10, "f10"].to_numpy(dtype=float)
        tertile = pd.qcut(pd.Series(f10).rank(method="first"), 3, labels=False).to_numpy()
        for bucket in range(3):
            mask = tertile == bucket
            entry["by_tertile_10yr"].append(
                {
                    "tertile": bucket + 1,
                    "n": int(mask.sum()),
                    "predicted_mean": round(float(f10[mask].mean()), 4),
                    "observed_km": round(kaplan_meier(times[have10][mask], events[have10][mask], 10.0), 4),
                }
            )
        entry["harrell_c_10yr"] = round(harrell_c(f10, events[have10].astype(bool), times[have10]), 4)
        entry["harrell_c_p_now"] = round(harrell_c(p_now[have10], events[have10].astype(bool), times[have10]), 4)
    return entry


def framingham_diabetes(raw: pd.DataFrame) -> dict[str, Any]:
    setup = _framingham_setup(raw, "dm", "DIABETES")
    period1, free, p_now, table = setup["period1"], setup["free"], setup["p_now"], setup["table"]
    entry: dict[str, Any] = {
        "outcome": "당뇨 상태 (검진마다의 DIABETES — 2차 ≈ 6년, 3차 ≈ 12년)",
        "model": FRAMINGHAM_MODEL["dm"],
        "n_period1": int(len(period1)),
        "prevalence_period1": round(float(period1["DIABETES"].mean()), 4),
        "n_free_at_baseline": int(len(free)),
        "age_range": setup["age_range"],
        "excess_mortality": setup["bands"],
        "by_exam": {},
    }
    later = raw[raw["PERIOD"].isin([2, 3])][["RANDID", "PERIOD", "DIABETES", "TIME"]]
    for period, horizon in ((2, 6), (3, 12)):
        follow = later[later["PERIOD"].eq(period)].set_index("RANDID")
        column = f"f{horizon}"
        joined = free[["RANDID"]].join(follow, on="RANDID", how="left")
        seen = joined["DIABETES"].notna().to_numpy() & table[column].notna().to_numpy()
        if seen.sum() < 200:
            continue
        observed = joined.loc[seen, "DIABETES"].astype(int).to_numpy()
        predicted = table.loc[seen, column].to_numpy(dtype=float)
        block: dict[str, Any] = {
            "n_followed": int(seen.sum()),
            "median_years_to_exam": round(float(joined.loc[seen, "TIME"].median() / DAYS_PER_YEAR), 1),
            "observed_rate": round(float(observed.mean()), 4),
            "predicted_mean": round(float(predicted.mean()), 4),
            "p_now_mean": round(float(p_now[seen].mean()), 4),
        }
        if observed.sum() >= 10:
            block["auroc_predicted"] = round(float(roc_auc_score(observed, predicted)), 4)
            block["auroc_p_now"] = round(float(roc_auc_score(observed, p_now[seen])), 4)
        entry["by_exam"][f"period_{period}"] = block
    return entry


# ---------------------------------------------------------------------------
# evidence 를 서빙 파일에 써 넣는다
# ---------------------------------------------------------------------------


def evidence_for(key: str, nhanes: list[dict[str, Any]], framingham: dict[str, Any]) -> dict[str, Any]:
    """카드에 실릴 만큼만 접는다. 전체는 `trajectory_validation.json` 에 있다."""
    summary: dict[str, Any] = {}
    rows = [r for r in nhanes if r["target"] == key and "10" in r["horizons"]]
    if rows:
        best = max(
            rows, key=lambda r: r["horizons"]["10"].get("harrell_c_event", r["horizons"]["10"]["harrell_c_all_cause"])
        )
        block = best["horizons"]["10"]
        summary["nhanes_mortality_linkage"] = {
            "tier": best["tier"],
            "event": best["event_definition"],
            "n_baseline_negative": block["n"],
            "events": block["events"],
            "harrell_c_10yr": block.get("harrell_c_event"),
            "harrell_c_p_now": block.get("harrell_c_event_p_now"),
            "harrell_c_all_cause_10yr": block["harrell_c_all_cause"],
        }
    fram = framingham.get(key)
    if fram and fram.get("by_horizon", {}).get("10"):
        ten = fram["by_horizon"]["10"]
        summary["framingham_cohort"] = {
            "n": ten["n"],
            "observed_10yr": ten["observed_km"],
            "predicted_10yr": ten["predicted_mean"],
            "observed_to_predicted": round(ten["observed_km"] / ten["predicted_mean"], 2)
            if ten["predicted_mean"]
            else None,
            "harrell_c_10yr": fram.get("harrell_c_10yr"),
        }
    elif fram and fram.get("by_exam", {}).get("period_3"):
        exam = fram["by_exam"]["period_3"]
        summary["framingham_cohort"] = {
            "n": exam["n_followed"],
            "observed_12yr": exam["observed_rate"],
            "predicted_12yr": exam["predicted_mean"],
            "observed_to_predicted": round(exam["observed_rate"] / exam["predicted_mean"], 2)
            if exam["predicted_mean"]
            else None,
            "auroc": exam.get("auroc_predicted"),
        }
    return summary


def write_evidence(path: Path, evidence: dict[str, dict[str, Any]]) -> None:
    if not path.exists():
        print(f"{path} 가 없다. fit_trajectory.py 를 먼저 돌려라 — evidence 를 못 넣었다.")
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    for key, block in evidence.items():
        if key in payload.get("targets", {}):
            payload["targets"][key]["evidence"] = block or None
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"→ evidence 를 {path} 에 써 넣었다")


def _print_nhanes(entry: dict[str, Any]) -> None:
    ten = entry["horizons"].get("10", {})
    nan = float("nan")
    print(
        f"{entry['name']:<10}{entry['tier']:<6} 기저음성 n={entry['baseline_negative_linked']:>6,} "
        f"사건={entry['events']:>4} | F10 n={ten.get('n', 0):>6,} 평균={ten.get('mean_predicted', nan):.3f} "
        f"C(사건)={ten.get('harrell_c_event', nan):.3f} vs P(now) {ten.get('harrell_c_event_p_now', nan):.3f} "
        f"| C(전체사망)={ten.get('harrell_c_all_cause', nan):.3f} vs {ten.get('harrell_c_all_cause_p_now', nan):.3f}"
    )
    bands = " ".join(f"{k}:{v.get('mean_f10', nan):.3f}" for k, v in entry["predicted_by_age_band"].items())
    print(f"{'':<17}연령대별 평균 F10  {bands}")
    inner = " ".join(
        f"{k}: {v['harrell_c_all_cause']:.3f}/{v['harrell_c_all_cause_p_now']:.3f}"
        + (f" (사건 {v['harrell_c_event']:.3f}/{v['harrell_c_event_p_now']:.3f})" if "harrell_c_event" in v else "")
        for k, v in entry["within_age_band_10yr"].items()
    )
    print(f"{'':<17}연령대 내부 C(전체사망) F10/P(now)  {inner}")


def _print_framingham(framingham: dict[str, Any]) -> None:
    nan = float("nan")
    htn = framingham["htn"]
    for h, block in htn["by_horizon"].items():
        print(
            f"고혈압 {h:>2}년  n={block['n']:>5}  관찰(KM)={block['observed_km']:.3f}  "
            f"예측={block['predicted_mean']:.3f}  P(now) 평균={block['p_now_mean']:.3f}"
        )
    for row in htn["by_tertile_10yr"]:
        print(
            f"    10년 삼분위 {row['tertile']}  예측={row['predicted_mean']:.3f}  관찰={row['observed_km']:.3f}  n={row['n']}"
        )
    print(f"    C(10년)={htn.get('harrell_c_10yr', nan):.3f}  P(now) C={htn.get('harrell_c_p_now', nan):.3f}")
    for exam, block in framingham["dm"]["by_exam"].items():
        print(
            f"당뇨 {exam}  n={block['n_followed']:>5}  중앙 {block['median_years_to_exam']}년  "
            f"관찰={block['observed_rate']:.3f}  예측={block['predicted_mean']:.3f}  "
            f"P(now)={block['p_now_mean']:.3f}  AUROC={block.get('auroc_predicted', nan):.3f} "
            f"(P(now) {block.get('auroc_p_now', nan):.3f})"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--mortality", type=Path, default=MORTALITY)
    parser.add_argument("--framingham", type=Path, default=FRAMINGHAM)
    parser.add_argument("--target", nargs="*", default=list(TRAJECTORY_TARGETS))
    parser.add_argument("--tiers", nargs="*", default=["basic", "lab"])
    parser.add_argument("--skip-framingham", action="store_true")
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--trajectory", type=Path, default=TRAJECTORY)
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    data = data[data["cycle"].astype(str).isin(LINKED_CYCLES)].reset_index(drop=True)
    mortality = pd.read_csv(args.mortality, low_memory=False)

    print(f"A. NHANES 사망연계 — 학습 {'/'.join(TRAIN_CYCLES)} → 기저 음성 채점 {'/'.join(SCORE_CYCLES)}\n")
    nhanes: list[dict[str, Any]] = []
    for key in args.target:
        for tier in args.tiers:
            if tier not in TARGETS[key].tiers:
                continue
            entry = nhanes_prospective(data, mortality, key, tier)
            if entry is None:
                print(f"{TARGETS[key].name:<10}{tier:<6} 건너뜀 (표본 부족)")
                continue
            nhanes.append(entry)
            _print_nhanes(entry)

    framingham: dict[str, Any] = {}
    if not args.skip_framingham:
        if not args.framingham.exists():
            print(f"\n{args.framingham} 없음. Framingham 대조를 건너뛴다.")
        else:
            raw = pd.read_csv(args.framingham)
            print("\nB. Framingham 1차 검진 단면 → 관찰된 발생과 대조\n")
            framingham["htn"] = framingham_hypertension(raw)
            framingham["dm"] = framingham_diabetes(raw)
            _print_framingham(framingham)

    payload = {"nhanes": nhanes, "framingham": framingham}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n→ {args.out}")

    write_evidence(args.trajectory, {key: evidence_for(key, nhanes, framingham) for key in TRAJECTORY_TARGETS})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
