"""의심 질환 상위 세 개를 고른다 — 1단계와 2단계를 잇는 자리.

## 왜 따로 고르는가

카드 열세 장을 한 번에 그리면 사용자가 하는 일은 "그래서 뭘 봐야 하나" 하나다.
`summarize()` 가 `needs_attention` 으로 CAUTION 이상을 급한 순으로 세지만 그건 **등급만**
본다. 등급이 같은 칸이 여럿이면 순서가 사실상 카드 순서고, 무엇보다 **그 등급을 얼마나
믿어도 되는지가 질환마다 다르다**는 사실이 빠진다.

낮은 HDL 카드가 "주의" 로 뜨는 것과 신기능 카드가 "주의" 로 뜨는 것은 무게가 다르다.
사망연계 검증에서 신기능은 C 0.84 인데 낮은 HDL 은 0.51 로 동전 던지기다
(`docs/27` §3 · `docs/42` §3.1). 같은 배지를 달고 나가지만 하나는 근거가 있고 하나는 없다.

## 순위 점수

    score = 신호강도 × 근거가중 × 동년배배수

셋을 곱하는 이유가 각각 있다.

* **신호강도** — 임상 판정이 먼저다. "낮음" 이면 아무리 동년배보다 높아도 의심이 아니라
  0 을 곱해 떨어뜨린다. **여기가 규칙 엔진과 ML 을 한 축에 놓는 자리다** — 검사값으로
  나온 판정(`MEASURED_WEIGHT`)이 확률 추정(`LEVEL_WEIGHT`)보다 언제나 위다. 두 값을
  더하거나 평균하지 않는다. 같은 질환을 두 번 세게 되고, 애초에 두 엔진은 같은 질문에
  답하지 않는다(ADR-009 — "경쟁이 아니라 순서").
* **근거가중** — 그 질환의 위험도가 실제 결과와 이어지는지의 실측(`EVIDENCE`). 사망연계
  Harrell's C 에서 유도했고 표는 아래에 있다. 이것이 없으면 지질 하위유형 세 장이
  유병률이 높다는 이유만으로 상위를 독차지한다.
* **동년배배수** — 같은 나이·성별 중간값 대비 몇 배인가. 절대 확률로 정렬하면 유병률이
  높은 질환(이상지질 47%·고혈압 42%)이 언제나 이겨서 개인화가 사라진다.

**고령에서는 동년배배수의 무게를 줄인다.** 70대 고혈압 유병률이 67.5% 라 그 안에서는
누구나 비슷하게 높고 백분위가 갈리지 않는다(`docs/42` §3.3). 나이가 많을수록 배수를
1 쪽으로 당긴다 — 그 나이대에서는 "동년배보다 높다" 가 정보가 아니기 때문이다.

## 이미 아는 것은 의심이 아니다

규칙·공식 엔진이 측정값으로 "있다" 고 판정한 질환은 후보에서 뺀다. 사용자가 이미
아는 것을 "의심됩니다" 로 다시 띄우는 것은 화면 자리를 버리는 일이다. 대신 그 카드는
등급 그대로 남고, 상위 세 개는 **아직 모르는 것** 중에서 고른다.
"""

from __future__ import annotations

from typing import Any

from app.services.trajectory import TRAJECTORY_TARGETS

#: 화면에 올리는 개수. 사용자가 "최소 3개" 를 요구했고, 후보가 모자라면 등급이 낮은
#: 것으로 채우되 `suspected=False` 로 표시해 "의심이라서 올라온 게 아님" 을 알린다.
TOP_N = 3

#: 상위 셋을 **무엇으로** 고르는가. 한 줄로 갈아 끼운다.
#:
#: ``"arbitrated"``
#:     신호강도 × 근거가중 × 동년배배수. 신호강도는 규칙 엔진·공개 공식이 측정값으로
#:     낸 판정을 먼저 쓰고, 없을 때만 ML 등급으로 내려간다. 확진(HIGH·VERY_HIGH)은
#:     후보에서 빠진다. 이 저장소가 2026-09-03 까지 쓰던 방식이다.
#:
#: ``"ml_probability"``
#:     **ML 확률만으로 내림차순.** 규칙 엔진을 순위에서 완전히 뺀다 — 판정 카드는
#:     그대로 규칙·공식이 정본이지만, 상위 셋을 고르는 일에는 관여하지 않는다.
#:
#: 두 방식이 뽑는 것이 실제로 다르므로(같은 프로필에서 셋 중 둘이 바뀐다) 어느 쪽이
#: 제품에 맞는지는 데이터가 아니라 결정 사항이다. 바꾸기 전에 아래 대가를 읽는다.
#:
#: **``ml_probability`` 의 대가 셋.**
#:
#: 1. **유병률이 높은 질환이 늘 이긴다.** 이상지질혈증 47% · 고혈압 42% 대 미진단
#:    당뇨 3.5% 다. 절대 확률로 정렬하면 개인화가 사라지고 거의 모든 사용자가 같은
#:    셋을 본다. ``EVIDENCE`` 와 동년배배수가 그 자리를 메우고 있었다.
#:  2. **근거가 약한 축이 위로 온다.** 낮은 HDL 의 사망연계 C 는 0.506 으로 동전
#:    던지기인데(``EVIDENCE`` 표) 확률만 보면 신기능(C 0.842)보다 위에 설 수 있다.
#: 3. **라벨을 만드는 검사값은 그 질환의 ML 입력에서 차단돼 있다**(`modeling/targets.py`
#:    의 ``blocked``). ``low_hdl`` 모델은 HDL 을 못 본다. 그래서 HDL 81 인 사람도
#:    확률이 낮게 나오지 않고, 사용자가 바로 위 카드에서 "기준 안에 있어요" 를 읽은
#:    항목이 상위 셋에 올라올 수 있다. 2026-09-03 에 실측 140 프로파일에서 25 건 났다.
#: **2026-09-07 에 `arbitrated` 로 되돌렸다.** 9/4 에 `ml_probability` 로 바꾼 근거는
#: "확률만으로 열 질환을 세우면 곡선이 하나도 안 붙는다"(0/3)였는데, 그건
#: `ml_probability + all` 의 문제였고 `arbitrated` 에는 해당하지 않았다. 같은 프로필
#: 120개로 세 방식을 재니 이렇게 갈렸다.
#:
#: | | `ml_prob`+`trajectory` | `ml_prob`+`all` | **`arbitrated`+`all`** |
#: |---|---:|---:|---:|
#: | 뽑힌 집합의 종류 | 1가지 | 15가지 | **20가지** |
#: | 5·10년 곡선 붙은 카드 | 68% | 13% | 54% |
#: | 확진(HIGH+) 유입 | 21% | 47% | **0%** |
#: | 측정 정상인데 1순위 | 28% | 7% | **0%** |
#:
#: 곡선 68→54% 만 대가다. 그 68% 는 **곡선이 붙는 세 질환만 후보로 둔 결과**이고,
#: 그래서 집합이 1가지 — 모든 사용자가 같은 셋을 봤다. 확진 21%(74건)와 "측정으로
#: 정상 확인된 질환이 1순위" 28%(34건)가 사라지는 쪽이 곡선 14%p 보다 크다.
#: `EVIDENCE` 가 지질 하위유형을 0.4 로 눌러서 곡선 없는 고유병률 축이 위로 오는 것을
#: 무게로 막는다 — 후보를 질환 목록으로 자르지 않아도 되는 이유다.
#:
#: ``"verdict"`` — **2026-09-07 채택. 판정 카드의 등급이 순위의 정본이다.**
#:
#: `arbitrated` 로도 카드와 패널이 갈렸다. 실측(당뇨 프리셋 · 공복혈당 148 · HbA1c
#: 7.2)에서 카드 1·2위가 패널에 아예 없었다.
#:
#:     카드   VERY_HIGH 당뇨병 · HIGH 비만 · CAUTION 대사증후군 · CAUTION 지방간
#:     패널   1 대사증후군 · 2 지방간 · 3 이상지질혈증(자리채움)
#:
#: 두 가지가 걸러냈다. **확진 제외**(`KNOWN_LEVELS`)가 당뇨병을, **ML 번들 유무**가
#: 비만을 뺐다. 각각 이유가 있었지만 제목이 "먼저 볼 세 가지" 라 사용자는 "가장 급한
#: 셋" 으로 읽는다 — 약속과 내용이 달랐다.
#:
#: `verdict` 는 카드 등급으로 세우고 같은 등급 안에서만 `arbitrated` 점수로 가른다.
#: 근거가중·동년배배수는 순위를 뒤집지 못하고 동점을 푸는 데만 쓰인다. 후보는 판정
#: 13칸 전부이고 확진도 뺀다 — "이미 아는 것" 이라도 가장 급하면 가장 급한 것이다.
RANK_SOURCE = "verdict"

#: 카드 등급의 급한 순. `RANK_SOURCE = "verdict"` 가 1차 정렬에 쓴다.
LEVEL_RANK: dict[str, int] = {
    "VERY_HIGH": 0,
    "HIGH": 1,
    "CAUTION": 2,
    "NORMAL": 3,
    "INSUFFICIENT_DATA": 4,
}

#: 카드 등급 중 "먼저 볼" 에 해당하는 것. 나머지는 자리채움이다.
ATTENTION_LEVELS = frozenset({"VERY_HIGH", "HIGH", "CAUTION"})

#: 확률 순위의 **후보 집합**. `RANK_SOURCE = "ml_probability"` 일 때만 읽는다.
#:
#: ``"trajectory"``
#:     2단계가 곡선을 낼 수 있는 질환만 — 비가역 3종(당뇨·고혈압·신기능).
#:     뽑힌 셋이 **전부** 5년 발병 확률을 갖는다.
#:
#: ``"all"``
#:     열 질환 전부.
#:
#: **왜 기본이 `"trajectory"` 인가.** 2026-09-04 에 `"all"` 로 한 번 돌려 보고 정했다.
#: 같은 프로필(52세 남성 · 134/86 · 공복혈당 112)에서 상위 셋이 이상지질(0.636) ·
#: 지방간(0.583) · 대사증후군(0.452) 으로 뽑혔는데, **셋 다 발병 궤적이 붙지 않는
#: 질환이라 5년 곡선이 하나도 안 나왔다**(`onset_status` 3/3 `not_applicable`).
#: 발병 궤적은 비가역 질환에만 정의돼 있기 때문이다(`docs/41` §2.3) — 이상지질은
#: 지질강하제로 되돌아가므로 "언제 걸리나" 가 성립하지 않는다.
#:
#: 대가는 분명하다. 후보가 셋이고 `TOP_N` 도 셋이라 **뽑히는 질환은 언제나 같고
#: 순서만 바뀐다.** 선별의 성격이 옅어지는 대신 뽑힌 셋이 전부 곡선을 갖는다.
#: 가역 질환까지 궤적을 확장하면 그때 `"all"` 로 되돌릴 자리다.
#: **`all` 로 되돌렸다.** 후보를 질환 목록으로 자르면 뽑히는 셋이 사람마다 같아진다
#: (실측 120 프로필에서 1가지). 곡선 유무는 후보 조건이 아니라 **결과**여야 한다 —
#: 없으면 `onset_status` 가 왜 없는지 말한다.
RANK_POOL = "all"

#: ML 의학 등급 → 신호 강도. "낮음" 은 0 이라 곱하면 떨어진다.
#:
#: 이 값은 **추정**의 강도다. 측정으로 나온 판정은 아래 `MEASURED_WEIGHT` 를 쓰고
#: 언제나 이보다 크다 — 같은 "주의" 라도 검사값을 보고 준 것과 확률로 추정한 것은
#: 무게가 다르다. ADR-009 가 엔진 우선순위를 "경쟁이 아니라 순서" 로 못 박은 것과
#: 같은 판단을 순위 점수에도 적용한 것이다.
LEVEL_WEIGHT: dict[str, float] = {"높음": 2.0, "주의": 1.5, "관심": 1.0, "낮음": 0.0}

#: 규칙 엔진(E1)·공개 공식(E3)이 **측정값으로** 준 판정의 신호 강도.
#:
#: **`HIGH`·`VERY_HIGH` 를 2026-09-07 에 넣었다.** 그 전에는 확진이 `KNOWN_LEVELS` 로
#: 후보에서 빠졌기 때문에 이 표에 있을 필요가 없었다. `RANK_SOURCE = "verdict"` 로
#: 바꾸면서 확진도 후보가 됐는데 표를 같이 안 고쳤고, 그 결과 `signal_strength` 가
#: 확진을 **측정으로 인식하지 못하고 ML 추정으로 떨어뜨렸다.** 화면에 이렇게 나갔다.
#:
#:     1순위 당뇨병 [추정] [매우 높음]
#:       "검사값 없이 추정한 등급이 '주의'"     ← 공복혈당 148 을 넣은 사용자에게
#:
#: 값은 확진 순서를 지키도록 `CAUTION` 위에 둔다.
MEASURED_WEIGHT: dict[str, float] = {"VERY_HIGH": 5.0, "HIGH": 4.0, "CAUTION": 3.0, "NORMAL": 0.0}

#: 측정 여부는 **엔진 코드로 알 수 없다.** 판정이 스스로 말해야 한다.
#:
#: 2026-09-03 에 이걸 엔진 코드(`{"E1","E3"}`)로 판단하다 두 가지가 났다. `E2` 안에
#: 성격이 다른 둘이 섞여 있기 때문이다 — 확률 추정과, `model.judge()` 가 사용자의
#: 검사값을 진단 기준과 **직접 대조**한 판정이다. 규칙 엔진에 대응 영역이 없는 지질
#: 하위유형 셋(고콜레스테롤·고중성지방·낮은 HDL)이 정확히 후자다.
#:
#: 그 결과 실측 140 프로파일에서:
#:   ① 판정 카드가 "입력한 검사값은 기준 안에 있어요" 라고 한 항목을 패널이 '관심' 으로
#:      경고했다. 패널에 오른 22 번 중 12 번.
#:   ② TG 300·LDL 172 처럼 기준을 넘은 항목이 패널에서 빠지고, HDL 81 인 사람에게
#:      "낮은 HDL" 이 자리채움으로 올라왔다. 25 건.
#:
#: `judge()` 독스트링이 "선별 제품에서 가장 비싼 종류의 오류" 라고 부른 그것이
#: 한 층 위에서 다시 난 것이다. 그래서 판정에 `measured` 를 싣고 그것만 본다.
MEASURED_FLAG = "measured"

#: 질환별 근거 가중. **사망연계 Harrell's C 에서 유도한다** — 그 위험도가 미래의 결과와
#: 얼마나 이어지는지의 유일한 전향 실측이다(`docs/27` §3, `docs/42` §3).
#:
#: | C | 뜻 | 가중 |
#: |---|---|---|
#: | ≥0.75 | 미래 사망을 뚜렷이 가른다 | 1.0 |
#: | 0.65~0.75 | 가르긴 한다 | 0.7 |
#: | 잴 수 없음 | 학습 주기에 라벨이 없다(지방간) | 0.5 |
#: | <0.65 | 동전 던지기이거나 65세+ 에서 역전 | 0.4 |
#:
#: 지질 하위유형 셋이 0.4 인 이유는 모델이 나빠서가 아니다. 단일 지질 분획 이상은 그
#: 자체가 사망 위험이 아니라 위험요인 여럿 중 하나이고, 고령에서는 방향이 뒤집힌다.
#: 표본을 늘려도 안 바뀌므로 순위에서 무게를 줄이는 것이 맞는 대응이다.
EVIDENCE: dict[str, float] = {
    "ckd": 1.0,  # 0.842 / 0.839
    "htn": 1.0,  # 0.792 / 0.805
    "anemia": 1.0,  # 0.755 / 0.761
    "dm": 1.0,  # 0.754 / 0.767
    "mets": 0.7,  # 0.717 / 0.722
    "fatty_liver": 0.5,  # 학습 주기에 CAP 라벨이 없어 잴 수 없다
    "dlp": 0.4,  # 0.654 / 0.648, 65세+ 0.434 로 역전
    "hypertg": 0.4,  # 0.551 / 0.579
    "hyperchol": 0.4,  # 0.567 / 0.551, 65세+ 0.399 로 역전
    "low_hdl": 0.4,  # 0.506 / 0.512, 상하위 사망률비 0.8 배
}
DEFAULT_EVIDENCE = 0.5

#: 동년배배수의 상한. 희귀 질환에서 중간값이 0 에 가까우면 배수가 발산한다.
LIFT_CAP = 3.0

#: 동년배배수를 1 쪽으로 당기기 시작하는 나이와, 완전히 무시하는 나이.
LIFT_FADE_FROM = 60
LIFT_FADE_TO = 80

#: 결정론 엔진이 "이미 그 질환" 이라고 본 등급. 후보에서 뺀다.
KNOWN_LEVELS = frozenset({"HIGH", "VERY_HIGH"})


def lift_weight(peer_ratio: float | None, age: float) -> float:
    """동년배 대비 배수를 나이로 감쇠한 값. 정보가 없으면 1.0(중립)."""
    if peer_ratio is None or peer_ratio <= 0:
        return 1.0
    capped = min(float(peer_ratio), LIFT_CAP)
    if age <= LIFT_FADE_FROM:
        return capped
    if age >= LIFT_FADE_TO:
        return 1.0
    # 60 세에서 그대로, 80 세에서 1.0 이 되도록 선형으로 당긴다.
    remaining = (LIFT_FADE_TO - age) / (LIFT_FADE_TO - LIFT_FADE_FROM)
    return 1.0 + (capped - 1.0) * remaining


def signal_strength(condition: dict[str, Any], verdict: dict[str, Any] | None) -> tuple[float, str, str]:
    """이 질환의 신호가 얼마나 센가. `(강도, 표시할 등급, 근거의 출처)`.

    **규칙 엔진과 ML 을 한 축에 놓는 자리다.** 측정으로 나온 판정이 있으면 그것을
    쓰고, 없을 때만 ML 추정 등급으로 내려간다. 두 값을 더하거나 평균하지 않는다 —
    같은 질환을 두 번 세게 되고, 애초에 두 엔진은 같은 질문에 답하지 않는다.

    측정인지는 `MEASURED_FLAG` 하나로 판단한다. 엔진 코드로 보면 안 되는 이유는
    그 상수 설명에 적어 두었다.
    """
    if verdict and verdict.get(MEASURED_FLAG):
        level = str(verdict.get("risk_level", ""))
        if level in MEASURED_WEIGHT:
            return MEASURED_WEIGHT[level], level, "측정"
    level = ((condition.get("medical") or {}).get("level")) or "낮음"
    return LEVEL_WEIGHT.get(level, 0.0), level, "예측"


def score_one(
    condition: dict[str, Any], age: float, verdict: dict[str, Any] | None = None
) -> tuple[float, dict[str, Any]]:
    """한 카드의 순위 점수와 그 근거. 점수만 돌려주면 왜 뽑혔는지 화면이 못 적는다."""
    target = condition.get("target", "")
    level_w, level, basis = signal_strength(condition, verdict)
    evidence_w = EVIDENCE.get(target, DEFAULT_EVIDENCE)
    lift_w = lift_weight(condition.get("peer_ratio"), age)
    return level_w * evidence_w * lift_w, {
        "level": level,
        "basis": basis,
        # 측정이 "기준 이내" 라고 이미 답한 카드. 점수가 같으면 뒤로 보낸다.
        #
        # 자리채움을 확률로 고르면 안 되는 경우가 여기다. 라벨을 만드는 검사값은 그
        # 질환의 ML 입력에서 차단되므로(`modeling/targets.py` 의 `blocked`) `low_hdl`
        # 모델은 HDL 을 **볼 수 없다.** 그래서 HDL 81 인 사람도 확률이 낮지 않고,
        # 동점 타이브레이크가 그 확률을 쓰면 "낮은 HDL 콜레스테롤" 이 자리채움 1 등이
        # 된다. 사용자는 바로 위 카드에서 "기준 안에 있어요" 를 읽은 참이다.
        "settled": basis == "측정" and level == "NORMAL",
        "level_weight": level_w,
        "evidence_weight": evidence_w,
        "peer_ratio": condition.get("peer_ratio"),
        "lift_weight": round(lift_w, 3),
    }


#: 화면에 쓰는 등급 이름. 규칙 엔진 5단계와 ML 4단계가 섞여 들어오므로 한 번 접는다.
LEVEL_LABEL: dict[str, str] = {"CAUTION": "주의", "NORMAL": "정상 범위", "HIGH": "높음", "VERY_HIGH": "매우 높음"}


def reason_text(detail: dict[str, Any], suspected: bool) -> str:
    """화면이 그대로 읽을 한 줄. 숫자를 그대로 쓰지 않고 뜻을 적는다."""
    if not suspected:
        return "의심 신호는 없지만 함께 볼 만한 항목이에요."
    level = LEVEL_LABEL.get(detail["level"], detail["level"])
    if detail["basis"] == "측정":
        # 확진과 전단계를 가른다. "'매우 높음' 판정" 은 맞는 말이지만 사용자가
        # 다음에 할 일이 다르다 — 확진은 진료, 전단계는 재측정이다.
        if detail.get("risk_level") in KNOWN_LEVELS:
            parts = [f"입력한 검사값이 이미 기준을 넘었어요 ('{level}')"]
        else:
            parts = [f"입력한 검사값으로 '{level}' 판정"]
    elif detail["basis"] == "확률":
        # `RANK_SOURCE = "ml_probability"`. 확률만으로 뽑았으므로 그렇게 말한다 —
        # "검사값 없이 추정" 이라고 하면 검사값을 넣은 사용자에게 거짓말이 된다.
        probability = detail.get("probability")
        head = f"예측 모델이 매긴 확률이 상위 {f'({probability:.0%})' if probability is not None else ''}".strip()
        parts = [head]
    else:
        parts = [f"검사값 없이 추정한 등급이 '{level}'"]
    ratio = detail["peer_ratio"]
    if ratio and ratio >= 1.2:
        parts.append(f"동년배 중간값의 {ratio:.1f}배")
    if detail["evidence_weight"] >= 1.0:
        parts.append("이 항목은 장기 추적에서 근거가 확인된 축")
    elif detail["evidence_weight"] <= 0.4:
        parts.append("다만 이 수치는 장기 결과와의 연결이 약해 참고로만 봅니다")
    return " · ".join(parts) + "."


#: 정렬 전략 하나. `(점수, 조건, 근거)` 목록을 순위 순으로 돌려준다.
Scored = list[tuple[float, dict[str, Any], dict[str, Any]]]


def _by_verdict(
    conditions: list[dict[str, Any]], age: float, verdicts: dict[str, dict[str, Any]], known: set[str]
) -> Scored:
    """**카드 등급이 1차 정렬이다.**

    근거가중·동년배배수는 순위를 뒤집지 못하고 같은 등급 안에서 동점을 푸는 데만
    쓰인다 — 그래야 패널이 카드와 같은 말을 한다. `known` 도 보지 않는다: 확진이라도
    가장 급하면 가장 급한 것이다.
    """
    scored: Scored = []
    for condition in conditions:
        verdict = verdicts.get(condition.get("target", "")) or {}
        score, detail = score_one(condition, age, verdict)
        detail["risk_level"] = str(verdict.get("risk_level", "")) or "INSUFFICIENT_DATA"
        scored.append((score, condition, detail))
    scored.sort(
        key=lambda row: (
            LEVEL_RANK.get(row[2]["risk_level"], len(LEVEL_RANK)),
            -row[0],
            row[2]["settled"],
            -(row[1].get("probability") or 0.0),
        )
    )
    return scored


def _by_probability(
    conditions: list[dict[str, Any]], age: float, verdicts: dict[str, dict[str, Any]], known: set[str]
) -> Scored:
    """**규칙 엔진을 순위에서 뺀다.** `verdicts` 도 `known` 도 보지 않는다.

    확진 질환을 거르던 것까지 같이 빠지므로 이미 아는 질환이 다시 상위에 오를 수
    있다. 그게 이 방식의 정의다 — 확률만 본다.
    """
    scored: Scored = []
    for condition in conditions:
        if RANK_POOL == "trajectory" and condition.get("target") not in TRAJECTORY_TARGETS:
            continue
        probability = condition.get("probability")
        _, detail = score_one(condition, age, verdicts.get(condition.get("target", "")))
        # 화면이 읽는 값들은 그대로 두되, 무엇으로 뽑혔는지는 바꿔 적는다.
        detail["basis"] = "확률"
        detail["probability"] = probability
        scored.append((float(probability) if probability is not None else 0.0, condition, detail))
    # 확률 내림차순. 동점이면 카드 순서(안정 정렬).
    scored.sort(key=lambda row: -row[0])
    return scored


def _by_arbitration(
    conditions: list[dict[str, Any]], age: float, verdicts: dict[str, dict[str, Any]], known: set[str]
) -> Scored:
    """신호강도 × 근거가중 × 동년배배수. 확진은 후보에서 뺀다."""
    scored: Scored = []
    for condition in conditions:
        target = condition.get("target", "")
        if target in known:
            continue
        score, detail = score_one(condition, age, verdicts.get(target))
        scored.append((score, condition, detail))
    # 점수 내림차순. 동점이면 ① 측정이 이미 "기준 이내" 라고 답한 카드를 뒤로,
    # ② 확률이 높은 쪽, ③ 카드 순서(안정 정렬)를 따른다. ①이 ②보다 앞서는 이유는
    # `settled` 설명에 적어 두었다 — 확률은 라벨 검사값을 못 보기 때문이다.
    scored.sort(key=lambda row: (-row[0], row[2]["settled"], -(row[1].get("probability") or 0.0)))
    return scored


#: `RANK_SOURCE` -> 정렬 전략. 셋을 한 함수에 두면 분기가 깊어져 어느 경로가 무엇을
#: 보장하는지 읽기 어렵다(실제로 복잡도 검사에 걸렸다).
_SORTERS: dict[str, Any] = {
    "verdict": _by_verdict,
    "ml_probability": _by_probability,
    "arbitrated": _by_arbitration,
}


def rank_suspects(
    conditions: list[dict[str, Any]],
    age: float,
    *,
    verdicts: dict[str, dict[str, Any]] | None = None,
    known: set[str] | None = None,
    top_n: int = TOP_N,
) -> list[dict[str, Any]]:
    """의심 순위 상위 `top_n`. 후보가 모자라면 신호 없는 것으로 채운다.

    `verdicts` 는 중재 계층이 낸 질환별 판정이다(`{target: {engine, risk_level}}`).
    **이 값이 있으면 규칙 엔진의 측정 기반 판정이 ML 추정보다 먼저 쓰인다.** 없으면
    ML 등급만으로 매긴다 — `/predictions/risk` 는 규칙 엔진을 부르지 않는다.

    `known` 은 결정론 엔진이 이미 "있다" 고 판정한 타깃이다. 사용자가 이미 아는 것을
    "의심됩니다" 로 다시 띄우지 않는다.
    """
    known = known or set()
    verdicts = verdicts or {}
    scored = _SORTERS[RANK_SOURCE](conditions, age, verdicts, known)

    out = []
    for rank, (score, condition, detail) in enumerate(scored[:top_n], start=1):
        if RANK_SOURCE == "verdict":
            # 카드가 "먼저 볼" 이라고 한 등급이면 의심이다. 등급이 정본이므로 점수로
            # 다시 판단하지 않는다 — 그러면 배지와 표시가 또 갈린다.
            suspected = detail["risk_level"] in ATTENTION_LEVELS
        elif RANK_SOURCE == "ml_probability":
            # 확률은 0 이 되지 않으므로 `score > 0` 로는 전부 "의심" 이 된다.
            # 모델 자신의 등급이 '낮음' 이 아닌 것만 의심으로 표시한다.
            suspected = detail["level"] != "낮음"
        else:
            suspected = score > 0
        out.append(
            {
                "target": condition.get("target"),
                "name": condition.get("name"),
                "rank": rank,
                "score": round(score, 4),
                "suspected": suspected,
                "probability": condition.get("probability"),
                "level": LEVEL_LABEL.get(detail["level"], detail["level"]),
                "basis": detail["basis"],
                "peer_ratio": detail["peer_ratio"],
                "evidence_weight": detail["evidence_weight"],
                "reason": reason_text(detail, suspected),
                # 2단계가 여기에 붙는다. `prediction.build_prediction` 이 채운다.
                "prevalence_trajectory": None,
                "onset_trajectory": None,
                "onset_status": condition.get("trajectory_status"),
            }
        )
    return out
