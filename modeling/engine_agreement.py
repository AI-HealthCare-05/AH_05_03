"""규칙 엔진과 ML 모델을 같은 사람 위에 놓고 대조한다.

두 엔진은 서로 다른 질문에 답한다
---------------------------------
**규칙 엔진**은 학회 지침의 임계값과 검사값을 비교한다. 결정론적이고, 검사값이
있어야 하며, 답이 "이 수치는 어느 구간인가"다.

**ML 모델**은 검사값 없이 "지금 검사받으면 그 구간을 넘을 가능성"을 낸다. 자기
라벨을 만든 검사값은 입력으로 받지 않으므로(라벨 누출) 두 엔진은 경쟁 관계가
아니라 순서 관계다 — 검사값이 없으면 ML, 있으면 규칙.

그래서 이 대조의 목적은 일치율이 아니다
--------------------------------------
같은 답을 내는지 보려는 게 아니라 **ML 확률에 뜻을 붙이려는 것**이다.

"고혈압 확률 47%"는 그 자체로 읽을 수 없는 숫자다. 유병률이 41%라 평범한 50대
남성이면 누구나 그 근처에 앉고, 사용자에게는 "반반"으로 읽히지만 실제 뜻은
"동년배 평균"이다. 백분위를 같이 보여줘도 여전히 추상적이다.

여기서 만드는 것은 **앵커 표**다. ML 확률 구간마다, 그 구간에 들어간 사람들을
실제로 검사했을 때 규칙 엔진이 몇 %에게 '주의' 이상을 줬는지를 센다. 그러면
화면에 이렇게 쓸 수 있다.

    확률 47% — 같은 나이·성별 중 상위 36%.
    이 확률대의 사람 100명을 실제로 검사했을 때 62명이
    대한고혈압학회 기준으로 '주의' 이상이었습니다.

앵커는 번들에 실려 서빙에서 그대로 조회된다. 규칙 엔진을 서버에서 돌릴 필요가
없고, vendored 코드를 건드리지도 않는다.

    ../.venv/Scripts/python.exe engine_agreement.py
    ../.venv/Scripts/python.exe engine_agreement.py --domain diabetes
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

from targets import TARGETS  # noqa: E402

from app.services.risk import RiskModelRegistry  # noqa: E402
from chronic_disease_engine import assess_chronic_disease_risk  # noqa: E402

DATA = Path(__file__).resolve().parent / "data" / "processed" / "nhanes_pooled.csv"
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
MODELS = ARTIFACTS / "models"

# ML 타깃 -> 규칙 엔진 영역. obesity 는 ML 모델이 없다 — 키·몸무게를 임계값과
# 비교하는 일이라 예측 대상이 아니고 규칙 엔진이 이미 한다.
PAIRS = {
    "dm": ("diabetes", "대한당뇨병학회"),
    "htn": ("hypertension", "대한고혈압학회"),
    "dlp": ("dyslipidemia", "한국지질·동맥경화학회"),
}

LEVELS = ["NORMAL", "CAUTION", "HIGH", "VERY_HIGH"]
# 이 등급 이상을 "학회 기준을 넘었다"로 센다. CAUTION 은 전단계를 포함하므로
# 재검사·생활습관 관리 권고가 붙는 지점이고, 선별 제품이 잡아야 하는 선이다.
POSITIVE_FROM = "CAUTION"

# 앵커 구간 수. 20개면 5%p 해상도이고, 셀마다 최소 표본을 지키려면 이 정도가 상한이다.
ANCHOR_BINS = 20
MIN_BIN_ROWS = 60


def rule_profile(row: pd.Series) -> dict[str, Any]:
    """NHANES 한 행을 규칙 엔진 입력으로 옮긴다.

    이름이 다른 것뿐 아니라 **없는 것**도 있다. NHANES 는 ASCVD 병력을 한 문항으로
    묻지 않으므로 심근경색·뇌졸중 진단력의 OR 로 근사한다. 근사라는 사실이
    결과에 영향을 주는 곳은 이상지질혈증 LDL 목표치 하나다.
    """

    def value(name: str) -> float | None:
        raw = row.get(name)
        return None if pd.isna(raw) else float(raw)

    def flag(name: str) -> bool | None:
        raw = row.get(name)
        return None if pd.isna(raw) else bool(raw)

    systolic, diastolic = value("sbp"), value("dbp")
    # 엔진이 수축기 <= 이완기 를 거부한다. 측정 오류인 소수 행을 통째로 버리는
    # 대신 혈압만 비운다 — 다른 세 영역의 판정은 살아 있다.
    if systolic is not None and diastolic is not None and systolic <= diastolic:
        systolic = diastolic = None

    ascvd = [flag("dx_heart_disease"), flag("dx_stroke")]
    known = [v for v in ascvd if v is not None]

    return {
        "sex": row.get("sex") if row.get("sex") in ("M", "F") else None,
        "age": int(row["age"]) if not pd.isna(row.get("age")) else None,
        "height_cm": value("height_cm"),
        "weight_kg": value("weight_kg"),
        "waist_cm": value("waist_cm"),
        "systolic_bp": systolic,
        "diastolic_bp": diastolic,
        "fasting_glucose": value("fasting_glucose"),
        "hba1c": value("hba1c"),
        # NHANES 의 GLU 파일은 공복 하위표본에서만 채혈한다.
        "is_fasting": None if value("fasting_glucose") is None else True,
        "total_cholesterol": value("total_chol"),
        "ldl_c": value("ldl"),
        "hdl_c": value("hdl"),
        "triglycerides": value("triglyceride"),
        "smoking": None if pd.isna(row.get("smoking_status")) else row["smoking_status"] == "current",
        "has_diabetes": flag("dx_diabetes"),
        "has_hypertension": flag("dx_hypertension"),
        "has_ascvd_history": any(known) if known else None,
    }


def run_rules(frame: pd.DataFrame) -> pd.DataFrame:
    """행마다 규칙 엔진을 돌려 영역별 등급을 표로 만든다."""
    rows = []
    for _, row in frame.iterrows():
        try:
            assessed = assess_chronic_disease_risk(rule_profile(row))
        except Exception:  # noqa: BLE001 — 검증 실패 행은 판정 불가로 남긴다
            rows.append({domain: "INSUFFICIENT_DATA" for domain, _ in PAIRS.values()})
            continue
        rows.append({domain: assessed[domain]["risk_level"] for domain, _ in PAIRS.values()})
    return pd.DataFrame(rows, index=frame.index)


def anchor_table(probability: np.ndarray, level: pd.Series) -> list[dict[str, Any]]:
    """ML 확률 구간마다 규칙 엔진 판정 분포.

    구간을 확률 균등이 아니라 **분위**로 자른다. 확률 균등으로 자르면 유병률이
    낮은 타깃에서 위쪽 구간이 통째로 비고, 정작 경보가 나가는 곳이 거기다.
    """
    decided = level.isin(LEVELS).to_numpy()
    probability, level = probability[decided], level[decided].to_numpy()
    if len(probability) < MIN_BIN_ROWS * 2:
        return []

    bins = min(ANCHOR_BINS, max(2, len(probability) // MIN_BIN_ROWS))
    edges = np.unique(np.quantile(probability, np.linspace(0, 1, bins + 1)))
    edges[0], edges[-1] = 0.0, 1.0

    table = []
    for lower, upper in zip(edges[:-1], edges[1:], strict=False):
        mask = (probability > lower) & (probability <= upper) if lower > 0 else (probability <= upper)
        if mask.sum() < MIN_BIN_ROWS:
            continue
        picked = level[mask]
        counts = {name: int((picked == name).sum()) for name in LEVELS}
        beyond = sum(counts[name] for name in LEVELS[LEVELS.index(POSITIVE_FROM) :])
        table.append(
            {
                "upper": round(float(upper), 6),
                "n": int(mask.sum()),
                # 이 구간의 사람들을 실제로 검사했을 때 학회 기준 '주의' 이상이었던 비율.
                "rule_positive_rate": round(beyond / int(mask.sum()), 4),
                "levels": {name: round(counts[name] / int(mask.sum()), 4) for name in LEVELS},
            }
        )
    return table


def confusion(band: pd.Series, level: pd.Series) -> dict[str, dict[str, int]]:
    """ML 등급 × 규칙 판정. 일치율이 아니라 불일치 유형을 보려는 표다."""
    usable = level.isin(LEVELS)
    matrix = pd.crosstab(band[usable], level[usable])
    for name in LEVELS:
        if name not in matrix.columns:
            matrix[name] = 0
    return {str(k): {name: int(v[name]) for name in LEVELS} for k, v in matrix[LEVELS].iterrows()}


def disagreement(matrix: dict[str, dict[str, int]]) -> dict[str, float | int]:
    """불일치를 두 종류로 나눈다. 방향이 다르면 대응도 다르다.

    **헛경보** — ML 이 상위 10% 경보를 띄웠는데 규칙 엔진은 정상이라고 한 사람.
    검사를 받으러 갔다가 아무것도 아니었다는 뜻이고, 이게 많으면 사용자가 다음
    경보를 안 믿는다.

    **놓침** — ML 이 낮다고 했는데 규칙 엔진은 HIGH 이상인 사람. 선별 제품에서
    가장 비싼 실수다. 다만 두 엔진이 서로 다른 정보를 보고 있어서 0 이 될 수는
    없다 — 규칙 엔진은 검사값을 보고 ML 은 그 검사값을 입력으로 받지 못한다.
    """
    high, low = matrix.get("high", {}), matrix.get("low", {})
    high_total, low_total = sum(high.values()), sum(low.values())
    missed = low.get("HIGH", 0) + low.get("VERY_HIGH", 0)
    return {
        "ml_high_n": high_total,
        "false_alarm_n": high.get("NORMAL", 0),
        "false_alarm_rate": round(high.get("NORMAL", 0) / high_total, 4) if high_total else 0.0,
        "ml_low_n": low_total,
        "missed_n": missed,
        "missed_rate": round(missed / low_total, 4) if low_total else 0.0,
    }


def describe(table: list[dict[str, Any]]) -> None:
    if not table:
        print("    표본 부족")
        return
    print(f"    {'ML 확률 구간':<18}{'인원':>7}{'학회 기준 초과':>13}   NORMAL / CAUTION / HIGH / VERY_HIGH")
    previous = 0.0
    for entry in table:
        share = entry["levels"]
        print(
            f"    {previous * 100:>5.1f}~{entry['upper'] * 100:<11.1f}{entry['n']:>7}"
            f"{entry['rule_positive_rate']:>13.1%}   "
            f"{share['NORMAL']:.2f} / {share['CAUTION']:.2f} / {share['HIGH']:.2f} / {share['VERY_HIGH']:.2f}"
        )
        previous = entry["upper"]


def run(data: pd.DataFrame, registry: RiskModelRegistry, tier: str) -> list[dict[str, Any]]:
    # 규칙 엔진이 판정하려면 검사값이 있어야 한다. 그 행에서만 대조가 성립한다.
    needed = ["sbp", "dbp", "fasting_glucose", "total_chol", "hdl"]
    usable = data[needed].notna().sum(axis=1) >= 4
    frame = data.loc[usable].copy()
    print(f"규칙 엔진 판정 가능 행 {len(frame):,} / 전체 {len(data):,}\n")

    levels = run_rules(frame)
    results = []

    for target_key, (domain, society) in PAIRS.items():
        model = registry.get(target_key, tier)
        if model is None:
            continue
        target = TARGETS[target_key]

        payloads = frame.to_dict(orient="records")
        probability = np.array(
            [model.probability({k: v for k, v in record.items() if pd.notna(v)}) for record in payloads]
        )
        percentile = [
            model.peer_percentile(p, float(r["age"]), str(r["sex"])) if pd.notna(r.get("age")) else None
            for p, r in zip(probability, payloads, strict=True)
        ]
        band = pd.Series([model.band(p, q) for p, q in zip(probability, percentile, strict=True)], index=frame.index)

        level = levels[domain]
        table = anchor_table(probability, level)
        decided = int(level.isin(LEVELS).sum())

        print("=" * 96)
        print(f"{target.name}  (ML {target_key}/{model.tier}  ↔  규칙 {domain} · {society})")
        print(f"  규칙 판정된 행 {decided:,}  ·  '주의' 이상 {level.isin(LEVELS[1:]).sum() / max(decided, 1):.1%}")
        print("=" * 96)
        describe(table)
        gaps = disagreement(confusion(band, level))
        print(
            f"    불일치 — 헛경보 {gaps['false_alarm_n']:,}/{gaps['ml_high_n']:,} ({gaps['false_alarm_rate']:.1%})"
            f"  ·  놓침 {gaps['missed_n']:,}/{gaps['ml_low_n']:,} ({gaps['missed_rate']:.1%})"
        )
        print()

        results.append(
            {
                "target": target_key,
                "tier": model.tier,
                "name": target.name,
                "rule_domain": domain,
                "society": society,
                "n_assessed": decided,
                "rule_positive_rate_overall": round(float(level.isin(LEVELS[1:]).sum() / max(decided, 1)), 4),
                "positive_from": POSITIVE_FROM,
                "anchor": table,
                "confusion": confusion(band, level),
                "disagreement": disagreement(confusion(band, level)),
            }
        )

    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--models", type=Path, default=MODELS)
    parser.add_argument("--tier", default="basic", help="어느 tier 의 확률에 앵커를 붙일지")
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "engine_agreement.json")
    parser.add_argument("--write-bundles", action="store_true", help="앵커를 번들에 써 넣는다")
    args = parser.parse_args()

    data = pd.read_csv(args.data, low_memory=False)
    registry = RiskModelRegistry(args.models)
    if not registry.available:
        raise SystemExit(f"{args.models} 에 번들이 없습니다. export_multi.py 를 먼저 실행하세요.")

    results = run(data, registry, args.tier)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}")

    if args.write_bundles:
        for entry in results:
            suffix = "" if entry["tier"] == "basic" else f"_{entry['tier']}"
            path = args.models / f"risk_{entry['target']}{suffix}.json"
            bundle = json.loads(path.read_text(encoding="utf-8"))
            bundle["rule_anchor"] = {
                "domain": entry["rule_domain"],
                "society": entry["society"],
                "positive_from": entry["positive_from"],
                "n": entry["n_assessed"],
                # **`overall_rate` 를 빠뜨렸었다.** `risk.py` 의 `interpret()` 과
                # `medical_band()` 는 이 이름으로 읽는데(`anchor.get("overall_rate")`)
                # 여기서는 안 써서, 앵커를 넣어도 `baseline` 과 `lift` 가 조용히 null 이
                # 됐다. 산출물에서의 이름은 `rule_positive_rate_overall` 이다 —
                # 이름이 달라서 눈에 안 띄었다.
                "overall_rate": entry["rule_positive_rate_overall"],
                "bins": entry["anchor"],
            }
            path.write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
            print(f"  앵커 기록 {path.name}  ({len(entry['anchor'])}구간)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
