"""발병 궤적 — "지금 이 질환이 없다면, 앞으로 t년 안에 생길 확률".

## 무엇을 더하는가

기존 카드 열 장은 전부 **유병** 선별이다 — "지금 기준을 넘을 가능성". 이 모듈은 그 뒤에
두 번째 단계를 붙인다. 1단계가 어떤 질환을 의심한다고 판단하면(`gate`), 그 질환에
대해 **앞으로 1·2·3·5·10년 안에 실제로 생길 누적 확률**을 낸다(`project`). 응답에는
`ConditionRisk.trajectory` 로 실린다.

## 구조 — 인구 기준 위험표 × 개인 상대위험

Framingham·QRISK 류의 공개 위험 점수와 같은 뼈대다.

    F(t | x) = 1 - exp( - R(x) · Λ0(a0 → a0+t) )

* **Λ0** — 같은 성별의 인구가 나이 a0 에서 a0+t 까지 겪는 기준 누적 발병 위험.
  `trajectory.json` 의 `baseline` 표에서 읽는다(연도별 위험 h(a)).
* **R(x)** — 1단계 모델의 현재 확률 p 를 같은 나이·성별의 기준 유병률 m 과 견준
  **상대 누적위험** `ln(1-p) / ln(1-m)`. 비례위험 illness-death 모형에서 어떤 사람의
  유병 확률이 1 - exp(-R·Λ0(a)) 이면 그 사람의 R 이 정확히 이 비다. p=m 이면 1 이고
  그때 곡선은 동년배 평균과 같다.

왜 이렇게 갈랐는가. 처음 설계는 각 사람의 특징을 고정한 채 나이만 옮겨 1단계 모델을
다시 채점하고 그 기울기를 발병률로 읽었다. `modeling/validate_trajectory.py` 로 재니
**순위가 망가졌다** — 사망연계에서 F(10) 의 C 가 P(now) 보다 0.06~0.2 낮았다. 기울기는
"지금 확률이 높은 사람이 곧 넘는다" 는 정보를 버리기 때문이다. 이 구조는 순위를
1단계에 맡기고(같은 나이·성별 안에서 F 는 p 에 단조) 시간 모양만 인구 표에서 가져온다.

## 기준 위험표는 어디서 오는가

이 저장소에는 종단 자료가 없다(21번 문서 §7.4). 지금 표는 단면 NHANES 의 연령별
유병률 곡선을 illness-death 모형(Keiding 1991, Brinks & Landwehr 2014)으로 뒤집어
만든다 — `baseline_from_prevalence`.

    i(a) = p'(a) / (1 - p(a)) + p(a) · δ(a),   δ = m1 - m0 (환자·비환자 사망률 차)

δ 는 사망연계 파일에서 실측한다(`modeling/fit_trajectory.py`). 당뇨 환자는 더 일찍
죽으므로 고령 유병률이 발병률보다 낮게 보이고, 그 항을 빼면 70대 발병률이 0 근처로
눌린다. **표의 출처는 파일에 적혀 있고 서빙은 출처를 모른다.** 진짜 코호트의 발생률
(HRS·한국의료패널·NHIS 표본코호트)이 들어오면 표만 갈아 끼우면 된다.

## 어떤 가정 위에 서 있는가 — 화면에 같이 나가야 하는 것

1. **비례위험.** 개인의 위험이 동년배 평균의 R 배로 시간에 걸쳐 일정하다.
2. **정지 인구.** 오늘의 60세가 오늘의 40세의 20년 뒤 모습이라는 가정. 미국 비만
   유행 같은 코호트 효과가 있으면 고령 발병률이 낮게 잡힌다 — Framingham 대조에서
   10년 고혈압 발생을 관찰의 약 60% 로 추정했다(41번 문서). **하한에 가까운 추정**이다.
3. **비가역.** 한 번 생기면 없어지지 않는 질환에서만 성립한다. 그래서 당뇨·고혈압·
   신기능 셋만 켠다. 빈혈은 낫고, 지질 하위유형은 약으로 되돌아가며, 대사증후군은
   체중으로 드나든다 — 그 넷은 유병률이 나이에 따라 오르다 내려서 식이 음수를 낸다.
4. **80세 상한.** NHANES 는 80세 이상을 80 으로 접는다. 그 너머 지평은 잘라 낸다.

## 순수 파이썬

서빙 이미지에 numpy 가 없다(`pyproject.toml` 의 `[project] dependencies` 주석). 그래서
여기는 리스트와 `math` 만 쓴다. 학습·검증 쪽은 같은 함수를 import 해서 쓴다 —
두 벌이 되면 검증한 숫자와 서빙 숫자가 갈라진다.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

#: 화면에 내보내는 지평(년).
#:
#: **5·10년 둘만 낸다.** 1·2·3년을 같이 내던 때가 있었는데 두 가지가 걸렸다.
#: ① 1년 뒤 발병 확률은 대부분 3% 미만이라 화면에서 "거의 안 생긴다" 로 읽히고,
#:    그게 이 제품이 주려는 메시지가 아니다.
#: ② 지평이 다섯이면 사용자가 다섯 숫자를 비교하게 되는데, 실제로 행동을 바꾸는
#:    정보는 "중기(5년)" 와 "장기(10년)" 둘이다. 공개 위험점수(Framingham·QRISK·
#:    PREVENT)가 10년을 쓰고 일부가 5년을 함께 쓰는 것도 같은 이유다.
#: 곡선 대신 **숫자 두 개**를 보여준다는 결정이 여기에 실려 있다.
HORIZONS: tuple[int, ...] = (5, 10)

#: NHANES 가 나이를 접는 상한. 표는 여기까지만 있다.
AGE_CAP = 80
#: 성인 표본 하한.
AGE_FLOOR = 19
#: 연령별 유병률을 다듬는 이동평균 반폭(년). 한 살 구간이 300~400명이라 ±3년이면
#: 표본 잡음은 죽고 10년 단위 굽음은 남는다.
SMOOTH_HALF_WIDTH_YEARS = 3
#: 상대위험 상한. p 가 1 에 붙으면 ln(1-p) 가 발산한다 — 화면에 100% 를 내지 않는다.
RELATIVE_HAZARD_CAP = 25.0

METHOD = "baseline_hazard_from_cross_sectional_age_gradient+illness_death_correction; relative_hazard=ln(1-p)/ln(1-m)"
#: 서빙 디렉터리에서 읽는 표 파일 이름. `modeling/fit_trajectory.py` 가 쓴다.
TRAJECTORY_FILE = "trajectory.json"

#: 궤적을 켜는 질환과 그 근거. 여기 없는 타깃은 `not_applicable` 이다.
#:
#: 셋 다 (1) 비가역, (2) NHANES 유병률이 19~80세에서 단조 증가, (3) 사망연계 검증에서
#: 위험도가 미래 사망을 가른다(27번 문서 §3 — 당뇨 C 0.75~0.77, 고혈압 0.79~0.81,
#: 신기능 0.84). 셋 중 하나라도 빠지면 식이 틀리거나 검증이 없다.
TRAJECTORY_TARGETS: dict[str, str] = {
    "dm": "비가역 · 유병률 단조 증가 · 사망연계 C 0.75 (당뇨 사인 0.86)",
    "htn": "비가역(투약 포함 정의) · 유병률 단조 증가 · 사망연계 C 0.79 (심뇌혈관 사인 0.83)",
    "ckd": "비가역 · 유병률 단조 증가 · 사망연계 C 0.84 (신장염 사인 0.93)",
}

#: 켜지 않은 타깃과 이유. 코드가 읽지는 않지만 "왜 없나" 를 여기 한 곳에 적는다.
EXCLUDED_TARGETS: dict[str, str] = {
    "dlp": "지질강하제로 되돌아가는 라벨. 65세+ 사망연계 C 0.43 으로 방향 역전",
    "hyperchol": "유병률이 50대 정점 뒤 하락(치료·사망). 사망연계 C 0.57",
    "hypertg": "유병률 비단조. 사망연계 C 0.58",
    "low_hdl": "유병률 비단조. 사망연계 C 0.51, 상하위 사망률비 0.8 배 — 역전",
    "mets": "가역(체중으로 드나든다). 식이 순발생률이 아니라 순전이율을 낸다",
    "fatty_liver": "CAP 라벨이 두 주기뿐이고 60대 이후 하락. 사망연계 검증 불가",
    "anemia": "가역. 여성은 폐경 후 유병률이 내려가 나이 기울기가 발병률이 아니다",
}

#: 1단계가 "의심" 으로 보는 조건. 의학 등급(규칙 앵커 양성률 또는 보정 확률) 이
#: 관심 이상이거나, 동일 연령·성별 백분위 70 이상(카드의 `moderate` 밴드) 이면 켠다.
SUSPECT_MEDICAL_LEVELS: frozenset[str] = frozenset({"관심", "주의", "높음"})
SUSPECT_PERCENTILE = 70.0

STATUS_PROJECTED = "projected"
STATUS_NOT_APPLICABLE = "not_applicable"
STATUS_BELOW_GATE = "below_gate"
STATUS_ALREADY_MET = "already_met"
STATUS_ALREADY_PRESENT = "already_present"
#: 결정론 엔진이 침묵하고 ML 확률도 표시하지 않는 질환(ADR-009 §4 — 대사증후군·신기능·지방간)
#: 에서 붙는다. 카드가 "정보 부족" 인데 그 밑에 궤적만 나가면 확률을 뒷문으로 내는 셈이다.
STATUS_WITHHELD = "withheld"
STATUS_AGE_OUT_OF_RANGE = "age_out_of_range"
STATUS_UNAVAILABLE = "unavailable"

CONDITIONAL_ON = "현재 이 질환이 없고, 지금의 수치·생활습관이 그대로 유지된다는 가정"

CAVEATS: tuple[str, ...] = (
    "종단 추적이 아니라 단면 자료의 나이 기울기에서 유도한 기준 위험표를 씁니다. 실제 코호트 대조에서 낮게 나와 하한에 가깝습니다.",
    "지금의 수치가 그대로라는 가정입니다. 관리하면 낮아지고 방치하면 높아집니다.",
    "미국 NHANES 성인 기준이며 한국인 보정을 하지 않았습니다.",
)


# ---------------------------------------------------------------------------
# 표 파일
# ---------------------------------------------------------------------------


class TrajectoryConfig:
    """`trajectory.json` — 질환별 기준 위험표·초과사망률·검증 근거.

    파일이 없으면 궤적을 내지 않는다(`available == False`). 없을 때 무언가로 대신
    계산하면 파일 유무에 따라 화면 숫자가 달라지는데 그 차이를 아무도 못 본다.
    `bundle_io.py` 가 규칙 앵커에서 겪은 것과 같은 종류의 결손이라 처음부터 막는다.
    """

    def __init__(self, payload: dict[str, Any] | None) -> None:
        self.payload: dict[str, Any] = payload or {}
        self.targets: dict[str, dict[str, Any]] = dict(self.payload.get("targets", {}))
        self.created_at: str = str(self.payload.get("created_at", ""))
        self.source: str = str(self.payload.get("source", ""))

    @classmethod
    def load(cls, directory: Path | None) -> TrajectoryConfig:
        if directory is None:
            return cls(None)
        path = directory / TRAJECTORY_FILE
        if not path.is_file():
            return cls(None)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return cls(None)
        return cls(payload if isinstance(payload, dict) else None)

    @property
    def available(self) -> bool:
        return bool(self.targets)

    def baseline(self, target: str) -> dict[str, Any]:
        """성별 → `{age_from, prevalence[], hazard[]}`. 없으면 빈 사전."""
        return dict((self.targets.get(target) or {}).get("baseline", {}))

    def bands(self, target: str) -> list[dict[str, Any]]:
        """초과사망률 표. `[{age_from, age_to, per_year, ...}, ...]`. 없으면 빈 목록."""
        return list((self.targets.get(target) or {}).get("excess_mortality", []))

    def evidence(self, target: str) -> dict[str, Any] | None:
        found = (self.targets.get(target) or {}).get("evidence")
        return dict(found) if found else None


def excess_rate(bands: Sequence[dict[str, Any]], age: float) -> float:
    """나이 `age` 에 적용할 δ(연간 초과사망률). 표 밖이면 가장 가까운 구간을 쓴다."""
    if not bands:
        return 0.0
    for band in bands:
        if float(band["age_from"]) <= age < float(band["age_to"]):
            return max(float(band["per_year"]), 0.0)
    last = bands[-1] if age >= float(bands[-1]["age_to"]) else bands[0]
    return max(float(last["per_year"]), 0.0)


# ---------------------------------------------------------------------------
# 표 만들기 — 유병률 곡선 → 연도별 발병 위험
# ---------------------------------------------------------------------------


def smooth_curve(values: Sequence[float], valid: Sequence[bool], half_width_points: int) -> list[float]:
    """중심 이동평균. 유효하지 않은 점(표본이 없는 나이)은 평균에 넣지 않는다."""
    out: list[float] = []
    n = len(values)
    for k in range(n):
        low = max(0, k - half_width_points)
        high = min(n - 1, k + half_width_points)
        picked = [values[j] for j in range(low, high + 1) if valid[j]]
        out.append(sum(picked) / len(picked) if picked else values[k])
    return out


def monotone_from(values: Sequence[float], start: int) -> list[float]:
    """`start` 부터 누적 최댓값. 비가역 질환의 유병률은 나이에 따라 내려갈 수 없다."""
    out = list(values)
    running = out[start]
    for k in range(start, len(out)):
        running = max(running, out[k])
        out[k] = running
    return out


#: 위험 하한을 켜는 나이. 이 나이부터는 h(a) 가 앞선 나이의 최댓값 아래로 못 내려간다.
HAZARD_FLOOR_FROM_AGE = 40


def baseline_from_prevalence(
    prevalence: Sequence[float | None],
    age_from: int,
    *,
    bands: Sequence[dict[str, Any]] = (),
    half_width_years: int = SMOOTH_HALF_WIDTH_YEARS,
    hazard_floor_from_age: int | None = HAZARD_FLOOR_FROM_AGE,
) -> dict[str, Any]:
    """한 살 간격 유병률 → 다듬은 유병률과 연도별 기준 발병 위험.

    `prevalence[k]` 는 나이 `age_from + k` 의 유병률(표본이 없으면 None). 결과의
    `hazard[k]` 는 나이 `age_from + k` 에서 다음 한 해 동안의 발병 위험이고 길이는
    유병률보다 하나 짧다.

        h(a) = ln( (1 - p(a)) / (1 - p(a+1)) ) + ((p(a) + p(a+1)) / 2) · δ(a + 0.5)

    첫 항은 δ=0 일 때 누적하면 [p(a+t) - p(a)] / [1 - p(a)] 와 정확히 같아지는
    로그 형태다. 다듬기(이동평균 → 누적최댓값)를 먼저 하므로 h 는 음수가 안 된다.

    **위험 하한(`hazard_floor_from_age`).** 단면 유병률은 고령에서 평평해진다 — 환자가
    먼저 죽고(δ 가 절반쯤 되돌린다), 오늘의 70대는 오늘의 50대보다 마른 세대다(코호트
    효과, δ 로 못 되돌린다). 그대로 뒤집으면 70세 남성의 고혈압 10년 위험이 0.07 로
    50세(0.31)의 4분의 1이 되는데, 어떤 코호트도 그렇게 관찰하지 않는다. 그래서 40세
    이후로는 h(a) 를 앞선 나이의 최댓값 아래로 내리지 않는다. 당뇨·고혈압·신기능
    셋 다 발병률이 중년 이후 내려간다는 근거가 없는 질환이다. `None` 이면 끈다.
    """
    values = [float(v) if v is not None else 0.0 for v in prevalence]
    valid = [v is not None for v in prevalence]
    smoothed = smooth_curve(values, valid, half_width_years)
    curve = [min(max(v, 0.0), 1.0 - 1e-9) for v in monotone_from(smoothed, 0)]
    hazard: list[float] = []
    for k in range(len(curve) - 1):
        p0, p1 = curve[k], curve[k + 1]
        onset = math.log((1.0 - p0) / (1.0 - p1))
        mortality = ((p0 + p1) / 2.0) * excess_rate(bands, age_from + k + 0.5)
        hazard.append(onset + mortality)
    if hazard_floor_from_age is not None:
        start = max(0, min(len(hazard), hazard_floor_from_age - age_from))
        hazard = monotone_from(hazard, start) if start < len(hazard) else hazard
    return {
        "age_from": age_from,
        "age_to": age_from + len(curve) - 1,
        "prevalence": [round(v, 5) for v in curve],
        "hazard": [round(h, 6) for h in hazard],
        "mortality_corrected": bool(bands),
        "hazard_floor_from_age": hazard_floor_from_age,
    }


# ---------------------------------------------------------------------------
# 궤적
# ---------------------------------------------------------------------------


def relative_hazard(p_now: float, reference: float) -> float:
    """상대 누적위험 R = ln(1-p) / ln(1-m). p=m 이면 1. 기준이 0 이면 비교 불가라 1."""
    p = min(max(p_now, 0.0), 1.0 - 1e-6)
    m = min(max(reference, 0.0), 1.0 - 1e-6)
    if m <= 0.0:
        return 1.0
    ratio = math.log(1.0 - p) / math.log(1.0 - m)
    return min(max(ratio, 0.0), RELATIVE_HAZARD_CAP)


def project(
    p_now: float,
    age: float,
    sex: str,
    baseline: dict[str, Any],
    *,
    horizons: Sequence[int] = HORIZONS,
) -> dict[str, Any] | None:
    """개인 곡선 F(t) = 1 - exp(-R · Λ0(t)) 와 동년배 곡선(R=1) 을 같이 낸다.

    표에 그 성별이 없거나, 나이가 표 밖이거나, 지평 하나도 상한 안에 못 들면 `None`.
    """
    curve = baseline.get(sex) or baseline.get("all")
    if not curve:
        return None
    age_from = int(curve["age_from"])
    prevalence: list[float] = list(curve["prevalence"])
    hazard: list[float] = list(curve["hazard"])
    index = int(round(age)) - age_from
    if index < 0 or index >= len(prevalence):
        return None
    reference = float(prevalence[index])
    ratio = relative_hazard(p_now, reference)

    kept = [h for h in horizons if index + h <= len(hazard)]
    if not kept:
        return None
    cumulative = 0.0
    personal: dict[int, float] = {}
    population: dict[int, float] = {}
    for k in range(index, index + max(kept)):
        cumulative += float(hazard[k])
        elapsed = k + 1 - index
        if elapsed in kept:
            personal[elapsed] = 1.0 - math.exp(-ratio * cumulative)
            population[elapsed] = 1.0 - math.exp(-cumulative)
    return {
        "horizons_years": kept,
        "onset_probability": [round(personal[h], 4) for h in kept],
        "population_onset_probability": [round(population[h], 4) for h in kept],
        "relative_hazard": round(ratio, 3),
        "reference_prevalence": round(reference, 4),
        "mortality_corrected": bool(curve.get("mortality_corrected", False)),
        "truncated_at_age": age_from + len(hazard) if len(kept) < len(horizons) else None,
    }


# ---------------------------------------------------------------------------
# 유병 궤적 — "그 나이가 됐을 때 기준을 넘고 있을 확률"
# ---------------------------------------------------------------------------
#
# 발병 궤적(위)과 **다른 질문**이다. 헷갈리면 숫자를 잘못 읽는다.
#
#   발병 궤적  지금 없다면 t년 안에 **새로 생길** 확률.  비가역 질환에서만 성립.
#   유병 궤적  t년 뒤에 **기준을 넘고 있을** 확률.        모든 질환에 성립.
#
# 유병 궤적은 1단계 모델을 나이만 옮겨 다시 채점한 것이다. 앞서 발병률을 이 곡선의
# 기울기로 구하려다 순위를 잃었는데(위 "왜 이렇게 갈랐는가"), **곡선 자체를 그대로
# 보여주는 것은 그 문제가 없다** — 같은 나이에서 확률이 높은 사람이 옮긴 나이에서도
# 높으므로 순위가 보존된다.
#
# 가역 질환에서는 곡선이 내려갈 수 있다. 지질은 60대 이후 유병률이 떨어지는데 그것은
# 낫는다는 뜻이 아니라 **약을 먹기 시작하고 고위험군이 먼저 사망하기 때문**이다.
# 화면 문구가 이 사실을 같이 말하지 않으면 "나이 들면 좋아진다" 로 읽힌다.

PREVALENCE_CONDITIONAL_ON = "지금의 수치·생활습관이 그대로 유지되고 치료를 시작하지 않는다는 가정"

PREVALENCE_CAVEATS: tuple[str, ...] = (
    "지금 기준을 넘었는지와 무관하게 '그 나이에 기준을 넘고 있을 확률'입니다. 새로 생길 확률과 다릅니다.",
    "곡선이 내려가는 구간은 좋아진다는 뜻이 아닙니다. 그 나이대에서 치료를 시작한 사람이 많다는 인구 통계입니다.",
    "미국 NHANES 성인 기준이며 한국인 보정을 하지 않았습니다.",
)


def prevalence_curve(
    prob_at_age: Callable[[float], float],
    age: float,
    *,
    irreversible: bool = False,
    horizons: Sequence[int] = HORIZONS,
    age_cap: int = AGE_CAP,
    age_floor: int = AGE_FLOOR,
) -> dict[str, Any] | None:
    """나이만 옮겨 다시 채점한 유병 확률. 지평 하나도 상한 안에 못 들면 `None`.

    평평한 구간을 다듬지 않는다. GBDT 는 나이를 계단으로 쓰므로 곡선이 계단이 되는데,
    그것이 **모델이 실제로 내는 값**이다. 부드럽게 만들면 보기에는 좋아지지만 화면의
    숫자와 모델의 답이 달라진다.

    `irreversible` 은 다르다. 한 번 생기면 없어지지 않는 질환(당뇨·고혈압·신기능)에서
    **개인의 유병 확률은 나이가 들어도 내려갈 수 없다.** 특징을 고정한 채 나이만 옮기는
    반사실이므로 더욱 그렇다. 그런데 GBDT 는 나이에 대해 단조가 아니라 실제로 내려가는
    조합이 나온다(72세 남성 당뇨 0.369 → 0.345 실측). 그것은 임상이 아니라 인공물이라
    누적 최댓값으로 접는다. 가역 질환은 접지 않는다 — 지질이 60대 이후 내려가는 것은
    치료 시작과 고위험군의 선행 사망이라는 실제 인구 현상이다.
    """
    kept = [h for h in horizons if age + h <= age_cap + 1e-9]
    if not kept:
        return None
    now = float(prob_at_age(min(max(age, age_floor), age_cap)))
    values = [float(prob_at_age(min(max(age + h, age_floor), age_cap))) for h in kept]
    if irreversible:
        running = now
        folded = []
        for value in values:
            running = max(running, value)
            folded.append(running)
        values = folded
    return {
        "horizons_years": kept,
        "prevalence_probability": [round(v, 4) for v in values],
        "current_probability": round(now, 4),
        "direction": "상승" if values[-1] > now + 0.005 else ("하락" if values[-1] < now - 0.005 else "유지"),
        "conditional_on": PREVALENCE_CONDITIONAL_ON,
        "irreversible": irreversible,
        "truncated_at_age": age_cap if len(kept) < len(horizons) else None,
        "caveats": list(PREVALENCE_CAVEATS),
    }


# ---------------------------------------------------------------------------
# 1단계 → 2단계 관문
# ---------------------------------------------------------------------------


def gate(
    target: str,
    *,
    medical_level: str | None,
    peer_percentile: float | None,
    judgement_met: bool | None,
    age: float,
    config: TrajectoryConfig | None,
) -> str:
    """이 카드에 궤적을 낼지. 상태 문자열 하나로 답하고 `projected` 일 때만 계산한다.

    순서가 뜻을 정한다. 궤적을 못 내는 질환(`not_applicable`) 은 아무리 의심돼도 안
    내고, 검사값이 이미 기준을 넘었으면(`already_met`) "지금 없다면" 이라는 전제가
    무너지므로 안 낸다. 그 다음이 의심 여부다.
    """
    if target not in TRAJECTORY_TARGETS:
        return STATUS_NOT_APPLICABLE
    if config is None or not config.available:
        return STATUS_UNAVAILABLE
    if judgement_met:
        return STATUS_ALREADY_MET
    if age + min(HORIZONS) > AGE_CAP:
        return STATUS_AGE_OUT_OF_RANGE
    suspected = (medical_level in SUSPECT_MEDICAL_LEVELS) or (
        peer_percentile is not None and peer_percentile >= SUSPECT_PERCENTILE
    )
    return STATUS_PROJECTED if suspected else STATUS_BELOW_GATE


def project_condition(
    target: str,
    probability: float,
    age: float,
    sex: str,
    *,
    medical_level: str | None,
    peer_percentile: float | None,
    judgement: dict[str, Any] | None,
    config: TrajectoryConfig | None,
) -> tuple[dict[str, Any] | None, str]:
    """카드 하나의 궤적. `(궤적 또는 None, 상태)` 를 돌려준다."""
    status = gate(
        target,
        medical_level=medical_level,
        peer_percentile=peer_percentile,
        judgement_met=bool(judgement and judgement.get("met")),
        age=age,
        config=config,
    )
    if status != STATUS_PROJECTED:
        return None, status
    assert config is not None
    curve = project(probability, age, sex, config.baseline(target))
    if curve is None:
        return None, STATUS_AGE_OUT_OF_RANGE
    curve.update(
        {
            "conditional_on": CONDITIONAL_ON,
            "method": METHOD,
            "evidence": config.evidence(target),
            "caveats": list(CAVEATS),
        }
    )
    return curve, STATUS_PROJECTED
