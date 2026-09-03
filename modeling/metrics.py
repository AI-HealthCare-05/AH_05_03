"""선별 모델 평가 지표 묶음.

AUROC 하나로 모델을 고르면 안 되는 이유가 이 저장소 안에 이미 두 건 있다.

**하나. AUROC 는 순위만 본다.** 화면에 뜨는 것은 확률이다. 확률을 전부 2배로
부풀려도 순위는 그대로라 AUROC 는 소수점 넷째 자리까지 같고, 사용자는 위험을
두 배로 잘못 안다. `EXPERIMENTS_REPORT.md` 2장이 고혈압 보정 기울기 0.74 를
잡아낸 것이 정확히 이 구멍이다.

**둘. AUROC 는 기저율에 둔감하다.** 이상지질혈증 유병률이 49%, 미진단 당뇨가
3.5% 다. 같은 AUROC 0.80 이라도 두 화면이 실제로 잡아내는 사람 수는 자릿수가
다르다. 그 차이는 AUPRC 를 기저율로 나눈 리프트에서만 보인다.

그래서 지표를 네 층으로 나눈다.

======  ====================================================================
순위     auroc, auprc, auprc_lift
확률     brier, brier_skill, ece, mce, 보정 기울기·절편, 신뢰도 곡선
판정     운영점마다 민감도·특이도·PPV·NPV·F1·MCC·균형정확도·리프트
결정     순편익(net benefit). "이 모델을 쓰는 게 전원 검사보다 나은가"
======  ====================================================================

마지막 층이 제품 질문에 가장 가깝다. 판별력이 좋아도 임계값을 잘못 잡으면
전원에게 "검사받으세요"라고 말하는 것보다 못할 수 있고, 순편익은 그 비교를
같은 단위로 해 준다.
"""

from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

# 알림 예산. 상위 몇 %에게 "검사받으세요"를 띄울 것인가.
ALERT_BUDGETS = (0.05, 0.10, 0.20)
# 순편익을 재는 임계 확률. "이 확률 이상이면 검사받을 만하다"고 보는 지점이고,
# 곧 사용자가 감수할 위양성 대 위음성 교환비다. 1/19 은 "검사 19번 헛걸음까지는
# 진짜 한 명을 찾을 값어치가 있다"는 뜻.
NET_BENEFIT_THRESHOLDS = (0.05, 0.10, 0.20, 0.30, 0.50)

RELIABILITY_BINS = 10


# ---------------------------------------------------------------------------
# 확률 정확도
# ---------------------------------------------------------------------------


def expected_calibration_error(y: np.ndarray, p: np.ndarray, bins: int = RELIABILITY_BINS) -> tuple[float, float]:
    """(ECE, MCE). 분위 구간이라 확률이 몰려 있어도 빈 구간이 안 생긴다.

    ECE 는 평균 어긋남, MCE 는 최악 구간의 어긋남이다. 둘을 같이 봐야 하는 이유는
    ECE 가 작아도 상위 구간 하나만 크게 틀릴 수 있고, 경보가 나가는 곳이 바로
    그 상위 구간이기 때문이다.
    """
    edges = np.quantile(p, np.linspace(0, 1, bins + 1))
    edges[0], edges[-1] = -np.inf, np.inf
    weighted, worst = 0.0, 0.0
    for lower, upper in zip(edges[:-1], edges[1:], strict=False):
        mask = (p > lower) & (p <= upper)
        if not mask.any():
            continue
        gap = abs(y[mask].mean() - p[mask].mean())
        weighted += mask.sum() * gap
        worst = max(worst, gap)
    return float(weighted / len(y)), float(worst)


def calibration_line(y: np.ndarray, p: np.ndarray) -> tuple[float, float]:
    """로짓에 다시 로지스틱을 적합한 기울기·절편.

    기울기 1·절편 0 이 완벽. 기울기가 1보다 작으면 예측이 과하게 극단적이고,
    크면 지나치게 몸을 사린다. 절편은 전체적으로 높게/낮게 부르는 편향이다.
    """
    clipped = np.clip(p, 1e-6, 1 - 1e-6)
    logit = np.log(clipped / (1 - clipped)).reshape(-1, 1)
    fitted = LogisticRegression(max_iter=1000).fit(logit, y)
    return float(fitted.coef_[0][0]), float(fitted.intercept_[0])


def reliability_curve(y: np.ndarray, p: np.ndarray, bins: int = RELIABILITY_BINS) -> list[dict[str, float]]:
    """구간별 (예측 평균, 실제 비율, 인원). 신뢰도 곡선을 그대로 그릴 수 있다."""
    edges = np.quantile(p, np.linspace(0, 1, bins + 1))
    edges[0], edges[-1] = -np.inf, np.inf
    rows = []
    for lower, upper in zip(edges[:-1], edges[1:], strict=False):
        mask = (p > lower) & (p <= upper)
        if not mask.any():
            continue
        rows.append(
            {
                "n": int(mask.sum()),
                "predicted": round(float(p[mask].mean()), 4),
                "observed": round(float(y[mask].mean()), 4),
            }
        )
    return rows


def brier_skill(y: np.ndarray, p: np.ndarray) -> tuple[float, float]:
    """(Brier, Brier skill score).

    Brier 만 보면 기저율이 낮은 타깃이 무조건 좋아 보인다 — 미진단 당뇨는 전부
    3.5% 라고 답하기만 해도 0.034 가 나온다. skill score 는 그 상수 예측을 0 으로
    두고 재므로 "모델이 실제로 더한 값"만 남는다. 음수면 상수보다 못하다는 뜻이다.
    """
    brier = float(brier_score_loss(y, p))
    baseline = float(np.mean((y - y.mean()) ** 2))
    skill = 1.0 - brier / baseline if baseline > 0 else 0.0
    return brier, float(skill)


# ---------------------------------------------------------------------------
# 판정
# ---------------------------------------------------------------------------


def confusion_at(y: np.ndarray, p: np.ndarray, threshold: float) -> dict[str, float]:
    """한 임계값에서의 판정 지표 전부."""
    flagged = p >= threshold
    tp = float((flagged & (y == 1)).sum())
    fp = float((flagged & (y == 0)).sum())
    fn = float((~flagged & (y == 1)).sum())
    tn = float((~flagged & (y == 0)).sum())
    total = tp + fp + fn + tn

    sensitivity = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    precision = tp / (tp + fp) if tp + fp else 0.0
    npv = tn / (tn + fn) if tn + fn else 0.0
    prevalence = (tp + fn) / total if total else 0.0

    denominator = np.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    # MCC 는 네 칸을 모두 쓰는 유일한 단일 지표라 불균형에 F1 보다 정직하다.
    mcc = ((tp * tn) - (fp * fn)) / denominator if denominator > 0 else 0.0

    return {
        "threshold": round(float(threshold), 6),
        "flag_rate": round(float(flagged.mean()), 4),
        "sensitivity": round(sensitivity, 4),
        "specificity": round(specificity, 4),
        "ppv": round(precision, 4),
        "npv": round(npv, 4),
        "f1": round(2 * precision * sensitivity / (precision + sensitivity), 4) if precision + sensitivity else 0.0,
        "mcc": round(float(mcc), 4),
        "balanced_accuracy": round((sensitivity + specificity) / 2, 4),
        "accuracy": round((tp + tn) / total, 4) if total else 0.0,
        "lift": round(precision / prevalence, 2) if prevalence > 0 else 0.0,
    }


def best_threshold(y: np.ndarray, p: np.ndarray, criterion: str = "mcc") -> dict[str, float]:
    """지정한 지표를 최대로 만드는 임계값.

    Youden J 를 기본값으로 쓰지 않는다. J 는 민감도와 특이도에 같은 무게를 주는데,
    유병률 3.5% 인 타깃에서 그 지점은 PPV 가 한 자릿수로 내려앉는다. 알림을
    받는 사람 대부분이 헛걸음하는 임계값을 "최적"이라 부를 수는 없다.
    """
    candidates = np.unique(np.quantile(p, np.linspace(0.5, 0.999, 120)))
    scored = [confusion_at(y, p, threshold) for threshold in candidates]
    best = max(scored, key=lambda row: row[criterion])
    return {"criterion": criterion, **best}


def threshold_for_ppv(y: np.ndarray, p: np.ndarray, target_ppv: float) -> dict[str, float] | None:
    """목표 PPV 를 만족하는 가장 낮은 임계값. 없으면 None.

    임계값을 올리면 PPV 는 오르고 민감도는 떨어진다. 목표 PPV 를 채우는 가장
    낮은 지점이 곧 "그 정밀도를 유지하면서 최대한 많이 찾는" 운영점이다.
    """
    candidates = np.unique(np.quantile(p, np.linspace(0.5, 0.9995, 200)))
    reached = [row for row in (confusion_at(y, p, t) for t in candidates) if row["ppv"] >= target_ppv]
    if not reached:
        return None
    return {"target_ppv": target_ppv, **min(reached, key=lambda row: row["threshold"])}


# ---------------------------------------------------------------------------
# 결정
# ---------------------------------------------------------------------------


def net_benefit(y: np.ndarray, p: np.ndarray, thresholds=NET_BENEFIT_THRESHOLDS) -> list[dict[str, float]]:
    """결정곡선 분석. 모델 · 전원 검사 · 아무도 검사 안 함을 같은 단위로 비교한다.

    순편익 = (진양성 − 위양성 × w) / n,  w = pt/(1−pt)

    ``pt`` 는 사용자가 "이 확률이면 검사받겠다"고 하는 지점이고, ``w`` 는 그
    선택이 함축하는 교환비다. pt=0.1 이면 진짜 한 명을 찾기 위해 헛걸음 9번까지
    감수한다는 뜻이 된다. 모델의 순편익이 전원 검사보다 낮으면, 판별력이 아무리
    좋아도 그 임계값에서는 모델을 쓸 이유가 없다.
    """
    prevalence = float(y.mean())
    rows = []
    for pt in thresholds:
        weight = pt / (1 - pt)
        flagged = p >= pt
        tp = float((flagged & (y == 1)).sum())
        fp = float((flagged & (y == 0)).sum())
        model = (tp - fp * weight) / len(y)
        treat_all = prevalence - (1 - prevalence) * weight
        rows.append(
            {
                "threshold_probability": pt,
                "net_benefit_model": round(model, 5),
                "net_benefit_treat_all": round(treat_all, 5),
                # 전원 검사 대비 이득을 "헛걸음 몇 건을 아꼈나"로 환산한 값.
                "avoided_tests_per_1000": round((model - treat_all) / weight * 1000, 1) if weight > 0 else 0.0,
                "beats_treat_all": bool(model > treat_all and model > 0),
            }
        )
    return rows


# ---------------------------------------------------------------------------
# 묶음
# ---------------------------------------------------------------------------


def evaluate(y: np.ndarray, p: np.ndarray, *, min_rows: int = 150, min_positives: int = 15) -> dict | None:
    """네 층 전부. 표본이 모자라면 None — 숫자를 내면 반드시 인용되기 때문이다."""
    y = np.asarray(y).astype(int)
    p = np.asarray(p, dtype=float)
    if len(y) < min_rows or int(y.sum()) < min_positives or int((1 - y).sum()) < min_positives:
        return None

    prevalence = float(y.mean())
    auprc = float(average_precision_score(y, p))
    brier, skill = brier_skill(y, p)
    ece, mce = expected_calibration_error(y, p)
    slope, intercept = calibration_line(y, p)

    operating = {
        f"top_{int(budget * 100)}pct": confusion_at(y, p, float(np.quantile(p, 1 - budget))) for budget in ALERT_BUDGETS
    }
    operating["max_mcc"] = best_threshold(y, p, "mcc")
    operating["max_f1"] = best_threshold(y, p, "f1")
    for goal in (0.30, 0.50):
        found = threshold_for_ppv(y, p, goal)
        if found:
            operating[f"ppv_{int(goal * 100)}"] = found

    return {
        "n": int(len(y)),
        "positives": int(y.sum()),
        "prevalence": round(prevalence, 4),
        # --- 순위
        "auroc": round(float(roc_auc_score(y, p)), 4),
        "auprc": round(auprc, 4),
        "auprc_lift": round(auprc / prevalence, 2) if prevalence > 0 else 0.0,
        # --- 확률
        "brier": round(brier, 4),
        "brier_skill": round(skill, 4),
        "ece": round(ece, 4),
        "mce": round(mce, 4),
        "calibration_slope": round(slope, 3),
        "calibration_intercept": round(intercept, 3),
        "reliability": reliability_curve(y, p),
        # --- 판정
        "operating_points": operating,
        # --- 결정
        "net_benefit": net_benefit(y, p),
    }


# ---------------------------------------------------------------------------
# 모델 선택
# ---------------------------------------------------------------------------

# 보정이 이 선을 넘으면 후보에서 뺀다. 판별력이 좋아도 확률이 틀리면 화면에
# 쓸 수 없고, 이 제품은 확률에서 백분위·등급·경보가 전부 파생된다.
MAX_ECE = 0.05
CALIBRATION_SLOPE_RANGE = (0.8, 1.25)


def selection_score(evaluation: dict) -> dict[str, object]:
    """지표 묶음을 하나의 선택 기준으로 접는다.

    순서가 중요하다. **먼저 보정 게이트를 통과해야 하고**, 그 다음에야 판별력으로
    순위를 매긴다. 반대로 하면 "AUROC 가 제일 높은데 확률이 1.5배 부풀려진 모델"이
    항상 이긴다. 판별력 지표로 AUROC 가 아니라 AUPRC 리프트를 쓰는 이유는 유병률이
    3.5%(미진단 당뇨)부터 49%(이상지질혈증)까지 걸쳐 있기 때문이다.
    """
    slope = evaluation["calibration_slope"]
    low, high = CALIBRATION_SLOPE_RANGE
    reasons = []
    if evaluation["ece"] > MAX_ECE:
        reasons.append(f"ECE {evaluation['ece']:.3f} > {MAX_ECE}")
    if not low <= slope <= high:
        reasons.append(f"보정 기울기 {slope:.2f} 가 [{low}, {high}] 밖")
    if evaluation["brier_skill"] <= 0:
        reasons.append("Brier skill 이 0 이하 — 기저율 상수 예측보다 못하다")

    return {
        "calibration_ok": not reasons,
        "rejected_for": reasons,
        # 통과한 것들끼리는 리프트로, 같으면 AUROC 로 가른다.
        "rank_key": (not reasons, evaluation["auprc_lift"], evaluation["auroc"]),
    }
