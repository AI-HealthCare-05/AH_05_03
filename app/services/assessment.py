"""엔진 중재자 — 질환마다 어느 엔진이 답하는지 정하는 한 곳.

무엇을 메우는가
---------------
"검사값이 있으면 규칙 엔진, 없으면 ML" 은 이미 제품 동작이었다. 문제는 그 판단의
정본이 **데모 화면의 클라이언트 JS** 에 있었다는 것이다. 서버는 두 엔진을 각각 열어만
두고 누가 답할지는 화면이 정했다. 화면이 둘이 되면 판단도 둘이 된다.

더 정확히 말하면 규칙은 이미 코드 안에 **글로** 적혀 있었다. `risk.py` 의
`BaseRiskModel.judge()` 독스트링이 이렇게 말한다.

    검사값이 들어온 순간 이 판정이 정본이 되고 확률은 참고로 내려간다.
    규칙 엔진이 다루는 네 영역은 그쪽이 더 자세한 판정(전단계·1기·2기)을 내므로
    그쪽을 먼저 읽고, 여기 판정은 규칙 엔진에 대응 영역이 없는 질환에서 그 자리를 메운다.

세 단계 우선순위가 문장으로 다 나와 있는데 그걸 실행하는 코드가 없었다. 이 모듈이
그 문장을 함수로 옮긴다. 결정문은 [ADR-009](../../docs/adr/0009-per-disease-models-and-server-inference-path.md) §4·§5.

세 단계 우선순위
----------------
질환 하나마다 후보를 순서대로 물어보고 **먼저 답하는 쪽이 정본**이다.

1. **E1 규칙 / E3 공개 공식** — 측정값을 학회 임계값과 대조한다. 전단계·1기·2기까지
   가른다. `INSUFFICIENT_DATA` 면 답하지 않은 것으로 친다
2. **E2 임계값 대조** (`model.judge()`) — 규칙 엔진에 대응 영역이 없는 질환에서
   그 자리를 메운다. 라벨을 만드는 검사값이 들어왔을 때만 답이 나온다
3. **E2 확률** — 위 둘이 다 침묵할 때. "재면 기준을 넘을 가능성" 이다

**밀려난 값을 지우지 않는다.** ML 확률·백분위는 정본이 아니어도 `reference` 에 실려
나간다. 지우면 화면이 "왜 이 답인가" 를 설명할 재료를 잃는다.

등급 통일에서 ADR-009 §5 와 갈린 지점
--------------------------------------
§5 는 ML 을 **동년배 백분위**로 5단계에 사상하라고 적었다(≥90 HIGH, 70~90 CAUTION).
그대로 쓰지 않았다. `risk.py` 가 같은 파일 안에서 두 번, `ConditionRisk` 가 한 번,
백분위를 등급에 쓰면 안 되는 이유를 적어 두었기 때문이다 — 만성질환 유병률은 나이를
따라 오르므로 **70대에서 실제 위험이 높은 사람도 "동년배 이하"** 가 되고 배지가
초록색으로 뜬다. `ConditionRisk.band` 의 필드 설명은 아예 "등급 표시에는 쓰지 않는다"
라고 못 박았다.

그래서 `medical_band()`(이 점수대 100명 중 몇 명이 학회 기준을 넘는가)를 재료로 쓴다.
**두 사상 모두 아래에 함수로 있고 `GRADE_SOURCE` 한 줄로 갈아 끼운다.** 팀이 §5 를
그대로 가겠다고 정하면 그 상수만 바꾸면 되고, 반대로 이쪽을 채택하면 ADR-009 §5 를
개정해야 한다. 어느 쪽이든 결정이 먼저다.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, Literal

from app.services.suspects import KNOWN_LEVELS
from app.services.trajectory import STATUS_ALREADY_PRESENT, STATUS_WITHHELD
from chronic_disease_engine.schemas import COMMON_DISCLAIMER, RiskLevel

EngineCode = Literal["E1", "E2", "E3"]

ENGINE_LABELS: dict[str, str] = {
    "E1": "규칙 엔진 (국내 학회 임계값)",
    "E2": "ML 시드 앙상블",
    "E3": "공개 공식",
}

INSUFFICIENT = RiskLevel.INSUFFICIENT_DATA.value
#: 결정론 엔진이 "이미 그 질환" 이라고 본 등급. 궤적의 전제("지금 없다면")가 성립하지 않는다.
_PRESENT_LEVELS = frozenset({RiskLevel.HIGH.value, RiskLevel.VERY_HIGH.value})

#: 5단계의 한글 이름. 화면의 `LEVEL_LABEL`(`contracts.ts`)과 같은 표기여야 한다.
LEVEL_NAMES: dict[str, str] = {
    RiskLevel.VERY_HIGH.value: "매우 높음",
    RiskLevel.HIGH.value: "높음",
    RiskLevel.CAUTION.value: "주의",
    RiskLevel.NORMAL.value: "정상 범위",
    INSUFFICIENT: "정보 부족",
}


# ---------------------------------------------------------------------------
# 질환 축 — 세 이름 공간을 하나로 모은다
# ---------------------------------------------------------------------------
#
# 엔진마다 도메인 이름이 다르다. 벤더 엔진은 `hypertension`, ML 번들은 `htn`,
# 매트릭스는 `htn_risk` 다. 셋을 한 축에 세우는 것이 중재의 절반이고, **이 표가
# 없으면 같은 질환이 화면에 두세 장으로 나온다.**


@dataclass(frozen=True)
class DiseaseSpec:
    key: str
    name: str
    # 결정론 엔진이 내는 도메인 이름. 벤더 엔진 4개 또는 `lab_staging` 의 것.
    deterministic: str | None
    deterministic_engine: EngineCode
    # ML 번들 타깃 이름.
    ml_target: str | None
    # 결정론 엔진이 침묵할 때 ML 확률이 그 자리를 대신할 수 있는가.
    # ADR-009 §4 가 대사증후군·신기능·지방간을 "검사값 없으면 표시하지 않음" 으로
    # 적었다. 번들은 있지만 확률로 답하지 않는다. 비만이 2026-09-07 에 넷째로
    # 붙었다 — 이유는 다르다(§4 가 아니라 라벨이 필수 입력에서 곧바로 나오기 때문).
    ml_fallback: bool = True


# 화면 카드 순서. `app/services/prediction.py` 의 `DISPLAY_ORDER` 와 같은 순서다.
#
# 2026-09-07 까지 비만·간기능·요산 셋은 ML 번들이 없어서 `ml_target=None` 이었다.
# 규칙 엔진이 검사값으로 답하는 카드라 등급은 났지만 "앞으로 어떻게 되는가" 를 말할
# 자리가 없었고, 검사를 안 낸 사람에게는 아무 말도 못 했다. 셋 다 번들을 붙였다.
SPECS: tuple[DiseaseSpec, ...] = (
    DiseaseSpec("dm", "당뇨병", "diabetes", "E1", "dm"),
    DiseaseSpec("htn", "고혈압", "hypertension", "E1", "htn"),
    DiseaseSpec("dlp", "이상지질혈증", "dyslipidemia", "E1", "dlp"),
    DiseaseSpec("hyperchol", "고콜레스테롤혈증", None, "E1", "hyperchol"),
    DiseaseSpec("hypertg", "고중성지방혈증", None, "E1", "hypertg"),
    DiseaseSpec("low_hdl", "낮은 HDL 콜레스테롤", None, "E1", "low_hdl"),
    # **BMI 가 라벨이라 ML 은 BMI 를 못 본다**(`modeling/targets.py`). 키·체중이
    # 필수 입력이라 규칙 엔진의 판정은 언제나 확정이고, ML 이 답하는 것은 다른
    # 물음이다 — 나이만 옮긴 유병 곡선, 곧 "이 허리둘레·생활습관으로 10년 뒤 비만
    # 기준을 넘고 있을 확률".
    #
    # 그래서 `ml_fallback=False` 다. 이 확률은 참고로만 실리고 등급이 되지 않는다.
    # 판별력은 높지만(홀드아웃 AUROC 0.958) 그 대부분은 허리둘레가 BMI 를 거의
    # 결정하기 때문이고, 허리둘레를 안 낸 사람에게는 미국 기저율(72.6%) 근처의
    # 값이 나온다 — BMI 22 인 사람 옆에 "73%" 가 등급으로 서면 안 된다.
    DiseaseSpec("obesity", "비만", "obesity", "E1", "obesity", ml_fallback=False),
    DiseaseSpec("mets", "대사증후군", "metabolic_syndrome", "E3", "mets", ml_fallback=False),
    # **"만성콩팥병" 이라 부르지 않는다.** 번들의 `limits` 가 이유를 적어 뒀다 —
    # KDIGO 는 3개월 지속을 요구하는데 단면 1회 측정으로는 그걸 채울 수 없어서
    # "화면에서 'CKD'라 부르지 않는다" 가 계약이다. 이 표가 그것을 어기고 있었고,
    # 카드는 "만성콩팥병", 의심 패널은 번들 이름인 "신기능 확인 필요" 로 나와서
    # 사용자가 두 이름을 다른 질환으로 읽었다(실제로 그 질문을 받았다).
    DiseaseSpec("ckd", "신기능 확인 필요", "kidney", "E3", "ckd", ml_fallback=False),
    DiseaseSpec("fatty_liver", "지방간", "fatty_liver", "E3", "fatty_liver", ml_fallback=False),
    # 라벨은 ALT 상승(Prati 2002 상한)이고 규칙 엔진은 AST·ALT·γ-GTP 셋을 본다.
    # 같은 질환의 두 기준이라 상한이 1 IU/L 다르다(남 33 vs 34) — 둘 다 출처를 적는다.
    DiseaseSpec("liver", "간기능", "liver", "E1", "liver_enzyme_high"),
    DiseaseSpec("anemia", "빈혈", "anemia", "E1", "anemia"),
    DiseaseSpec("uric_acid", "요산", "uric_acid", "E1", "hyperuricemia"),
    # 라벨이 고감도 CRP 라 규칙 쪽도 같은 값을 본다(`lab_staging.evaluate_inflammation`).
    # CRP 는 국가건강검진 밖이라 대부분의 사용자는 안 갖고 있고, 그래서 이 카드는
    # ML 이 답하는 자리가 실제로 있다 — 빈혈·고요산혈증과 같은 꼴이다.
    DiseaseSpec("inflammation", "만성염증", "inflammation", "E1", "inflammation"),
)

SPEC_BY_KEY = {spec.key: spec for spec in SPECS}


# ---------------------------------------------------------------------------
# 등급 통일 — ADR-009 §5
# ---------------------------------------------------------------------------
#
# 규칙 5단계가 정본이다. ML 을 그 위에 사상하는 방법이 두 가지이고 둘 다 아래에 있다.
#
# **ML 은 VERY_HIGH 를 내지 않는다.** 최고 등급은 "측정값이 진단 기준을 크게 넘었다"
# 는 뜻이고, ML 은 측정을 하지 않았다. 추정에 측정과 같은 배지를 주면 사용자가 둘을
# 구분할 방법이 없어진다. ML 의 역할은 "재보세요" 이지 "당신은 그렇습니다" 가 아니다.

# rate = 이 점수대 100명을 실제로 검사하면 몇 명이 학회 기준을 넘는가.
# 경계값은 `BaseRiskModel.MEDICAL_LEVELS` 와 같아야 한다 — 거기가 정본이다.
_MEDICAL_TO_LEVEL = {
    "낮음": RiskLevel.NORMAL,
    "관심": RiskLevel.CAUTION,
    "주의": RiskLevel.CAUTION,
    "높음": RiskLevel.HIGH,
}


def grade_from_medical(medical: dict[str, Any] | None, percentile: float | None) -> tuple[str, str]:
    """의학 기준 비율로 등급을 정한다 (기본값). 등급과 근거 문구를 함께 낸다."""
    if not medical:
        return INSUFFICIENT, "이 확률을 읽을 기준표가 없습니다."
    level = _MEDICAL_TO_LEVEL.get(str(medical.get("level")), RiskLevel.NORMAL)
    rate = medical.get("rate")
    basis = medical.get("basis", "진단 기준 충족")
    detail = f"이 점수대에서 {basis} 비율이 {float(rate) * 100:.0f}%" if rate is not None else basis
    return level.value, detail


def grade_from_percentile(medical: dict[str, Any] | None, percentile: float | None) -> tuple[str, str]:
    """ADR-009 §5 원문 그대로 — 동년배 백분위로 등급을 정한다.

    기본값이 아니다. 모듈 설명의 "갈린 지점" 절 참조. `GRADE_SOURCE` 로 켠다.
    """
    if percentile is None:
        return INSUFFICIENT, "동년배 참조표가 없어 백분위를 낼 수 없습니다."
    if percentile >= 90:
        return RiskLevel.HIGH.value, f"동년배 상위 {100 - percentile:.0f}%"
    if percentile >= 70:
        return RiskLevel.CAUTION.value, f"동년배 백분위 {percentile:.0f}"
    return RiskLevel.NORMAL.value, f"동년배 백분위 {percentile:.0f}"


# 팀이 ADR-009 §5 를 그대로 가기로 정하면 이 한 줄을 `grade_from_percentile` 로 바꾼다.
GRADE_SOURCE = grade_from_medical


def grade_from_judgement(judgement: dict[str, Any]) -> str:
    """임계값 대조 결과를 5단계에 사상한다.

    `met` 은 단일 임계값 통과 여부라 1기·2기를 가르지 못한다. 그래서 상한이 HIGH 다 —
    VERY_HIGH 는 구간을 아는 규칙 엔진만 낸다.
    """
    return RiskLevel.HIGH.value if judgement.get("met") else RiskLevel.NORMAL.value


# ---------------------------------------------------------------------------
# 판정 결과
# ---------------------------------------------------------------------------


@dataclass
class DiseaseVerdict:
    key: str
    name: str
    engine: str
    engine_label: str
    engine_reason: str
    risk_level: str
    sub_status: str
    display_label: str
    reason: str
    criteria_reference: str
    recommendation: str
    input_values: dict[str, Any] = field(default_factory=dict)
    missing_fields: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    # ML 확률이 무엇에 밀렸는가. ML 이 정본이면 `None`. ADR-009 §4.
    superseded_by: str | None = None
    # 정본이 아니어도 남기는 참고값. 화면이 "왜 이 답인가" 를 설명할 재료다.
    reference: dict[str, Any] = field(default_factory=dict)
    disclaimer: str = COMMON_DISCLAIMER
    # 이 판정이 **사용자가 넣은 값을 기준과 대조해서** 나왔는가.
    #
    # `engine` 으로는 이걸 알 수 없다. `E2` 에 성격이 다른 둘이 들어 있기 때문이다 —
    # 확률 추정(측정 아님)과 `model.judge()` 의 직접 대조(측정)다. 순위 점수와 후보
    # 제외가 둘을 갈라야 해서 판정이 스스로 답하게 했다. `app/services/suspects.py`
    # 의 `MEASURED_FLAG` 설명에 이걸 안 갈랐을 때 무엇이 났는지 적어 두었다.
    measured: bool = False


def level_str(value: Any) -> str:
    """등급을 언제나 맨 문자열로 만든다.

    두 출처의 타입이 다르다. `lab_staging` 은 `_result()` 에서 `risk.value` 를 넣어
    문자열을 내고, 벤더 엔진은 `model_dump()` 가 `RiskLevel` 멤버를 그대로 남긴다.
    `RiskLevel` 이 `str` 하위 타입이라 비교와 JSON 직렬화는 우연히 맞아떨어지지만
    **`str()` 은 `"RiskLevel.HIGH"` 를 낸다** — 파이썬 3.11 에서 바뀐 동작이고,
    로그·문자열 포매팅에서만 조용히 틀린다. 경계에서 한 번 접는다.
    """
    return value.value if isinstance(value, RiskLevel) else str(value)


def _from_domain(spec: DiseaseSpec, domain: dict[str, Any], reason: str) -> DiseaseVerdict:
    """규칙·공식 판정을 그대로 옮긴다. 등급은 이미 5단계라 변환하지 않는다."""
    return DiseaseVerdict(
        key=spec.key,
        name=spec.name,
        engine=spec.deterministic_engine,
        engine_label=ENGINE_LABELS[spec.deterministic_engine],
        engine_reason=reason,
        risk_level=level_str(domain["risk_level"]),
        sub_status=domain.get("sub_status", ""),
        display_label=domain.get("display_label", ""),
        reason=domain.get("reason", ""),
        criteria_reference=domain.get("criteria_reference", ""),
        recommendation=domain.get("recommendation", ""),
        input_values=dict(domain.get("input_values", {})),
        missing_fields=list(domain.get("missing_fields", [])),
        flags=list(domain.get("flags", [])),
        disclaimer=domain.get("disclaimer", COMMON_DISCLAIMER),
    )


def _ml_reference(condition: dict[str, Any] | None) -> dict[str, Any]:
    """정본이 아닌 ML 값을 참고 블록으로 접는다.

    **`accuracy` 와 `rule_anchor` 를 같이 싣는다.** 첫 판에서는 `model_auroc` 한 숫자만
    남기고 잘라 냈는데, 그 한 숫자가 화면에서 가장 오해받는 값이다. AUROC 는 "100명 중
    몇 명을 맞힌다"가 아니라 위험한 사람과 아닌 사람을 한 명씩 뽑았을 때 위험한 쪽에 더
    높은 점수를 줄 확률이다. 사용자가 실제로 겪는 값은 경보 적중률(`alert_ppv`)과
    발견율(`alert_sensitivity`) 쪽이고, `ModelAccuracy` 가 그 둘을 이미 담아 온다.

    `rule_anchor` 는 확률을 읽을 자를 준다 — "이 확률대의 사람들을 실제로 검사하면
    학회 기준으로 몇 %가 넘었나". 확률 하나만으로는 47%가 좋은지 나쁜지 알 수 없다.
    """
    if not condition:
        return {}
    return {
        # **번들 타깃 이름.** 카드 키(`SPECS.key`)와 다를 수 있다 — `liver` 카드는
        # `liver_enzyme_high` 번들이, `uric_acid` 카드는 `hyperuricemia` 번들이
        # 답한다. 화면이 "이 모델이 쓰지 않은 입력" 과 "더 넣으면 정밀해지는 값" 을
        # 낼 때 `/predictions/model-info` 에서 해당 번들을 찾아야 하는데, 카드 키로
        # 찾으면 그 둘이 조용히 빈다.
        "model_target": condition.get("target"),
        "probability": condition.get("probability"),
        "peer_percentile": condition.get("peer_percentile"),
        "peer_group": condition.get("peer_group"),
        "peer_median": condition.get("peer_median"),
        "peer_ratio": condition.get("peer_ratio"),
        "medical_level": (condition.get("medical") or {}).get("level"),
        # 등급 문자열 하나가 아니라 묶음 전체를 싣는다. `rate`·`basis`·`baseline`·`lift`
        # 가 있어야 "이 점수대 100명 중 몇 명" 과 게이지를 그릴 수 있고, 예측 데모가
        # 그 화면을 위해 `/predictions/risk` 를 따로 부르고 있었다. 데모를 판정 화면에
        # 합치면서 두 번째 왕복을 없앤다 — 같은 입력을 두 번 보내면 두 답이 갈릴 수 있다.
        "medical": condition.get("medical"),
        "model_auroc": condition.get("model_auroc"),
        "tier": condition.get("tier"),
        "accuracy": condition.get("accuracy"),
        "rule_anchor": condition.get("rule_anchor"),
        "top_factors": condition.get("top_factors"),
        # 2단계 발병 궤적. 정본이 규칙 엔진이어도 "지금 없다면 앞으로" 는 별개 물음이라
        # 참고 블록에 같이 싣는다. 이미 있다고 판정된 카드는 `arbitrate` 가 지운다.
        "trajectory": condition.get("trajectory"),
        "trajectory_status": condition.get("trajectory_status"),
        # 발병 궤적이 없는 일곱 질환(가역·비단조)에도 앞날을 말할 자리를 준다.
        # 뜻이 다르므로 화면이 다른 이름으로 그린다 — "새로 생길" 과 "기준 초과".
        "prevalence_trajectory": condition.get("prevalence_trajectory"),
    }


#: 모델이 "이 사람은 높은 쪽" 이라고 같이 말하는 의학 등급. `risk.py` 의
#: `MEDICAL_LEVELS` 와 같은 이름이어야 한다 — 거기가 정본이다.
#:
#: 경계를 `주의`(이 점수대의 50% 이상이 기준 초과) 에 둔 이유가 있다. 측정이
#: "넘었다" 고 한 사람 옆에 50% 미만짜리 숫자가 서면 그 숫자가 배지와 다투는
#: 것으로 읽힌다. 절반을 넘겨야 같은 방향을 가리킨다고 말할 수 있다.
_MODEL_AGREES_LEVELS = frozenset({"주의", "높음"})


def model_contradicts_measurement(verdict: DiseaseVerdict) -> bool:
    """측정과 모델이 **서로 반대 방향**을 가리키는가. 양쪽 다 본다.

    측정이 "넘었다" 인데 모델이 "낮다" 는 경우와, 측정이 "기준 안" 인데 모델이
    "높다" 는 경우가 대칭이다. 후자는 규칙 엔진이 "기준 안에 있어요" 라고 한 카드
    바로 밑에 모델의 74% 가 붙던 자리다 — 이 패널에서 가장 헷갈리던 지점이었고
    화면이 따로 막고 있었다. 판단을 한 곳으로 모은다.

    라벨을 만드는 검사값은 그 질환의 ML 입력에서 차단되므로(`modeling/targets.py`)
    차단이 심한 질환에서 이 어긋남이 생긴다. 실측(대사증후군 프리셋)

        비만          높음      모델 91%  의학 '높음'   → 동의
        지방간        높음      모델 66%  의학 '주의'   → 동의
        대사증후군    매우 높음  모델 56%  의학 '주의'   → 동의
        이상지질혈증  높음      모델 65%  의학 '주의'   → 동의
        고중성지방    높음      모델 15%  의학 '낮음'   → **모순** (지질 넉 장이 전부 차단)
        낮은 HDL      높음      모델 22%  의학 '낮음'   → **모순**

    열넷 중 둘만 모순이다. 그래서 "넘었으면 무조건 지운다" 는 규칙은 멀쩡한 열두
    칸의 앞날까지 같이 버린다 — 실제로 사용자가 볼 숫자가 통째로 사라졌다.
    """
    if not verdict.measured:
        return False
    level = str(((verdict.reference or {}).get("medical") or {}).get("level", ""))
    if not level:
        return False
    if verdict.risk_level in _PRESENT_LEVELS:
        return level not in _MODEL_AGREES_LEVELS
    if verdict.risk_level == RiskLevel.NORMAL.value:
        # 측정이 "기준 안" 이라고 답했는데 모델이 최상위 구간을 말하면 어긋난다.
        return level == "높음"
    return False


def _drop_forecasts_when_already_present(verdict: DiseaseVerdict) -> None:
    """이미 기준을 넘은 카드에서 **낼 수 없는** 앞날 숫자만 지운다.

    두 가지를 다르게 다룬다.

    `trajectory`(새로 생길 확률)
        무조건 지운다. "지금 없다면" 이 전제인데 이미 있으므로 물음 자체가 성립하지
        않는다. `CAUTION` 은 남긴다 — 전당뇨·고혈압 전단계는 아직 그 질환이 아니라서
        앞날이 오히려 가장 쓸모 있는 자리다.

    `prevalence_trajectory`(기준을 넘고 있을 확률)
        **모델이 판정과 어긋날 때만** 지운다. 이 물음은 이미 넘은 사람에게도 성립하고
        (5년 뒤에도 넘고 있을 확률), 모델이 같은 방향을 가리키면 그 숫자가 배지와
        다투지 않는다. 첫 판에서 이것까지 싸잡아 지웠더니 비만 91%·지방간 66%·
        대사증후군 58% 처럼 판정과 맞아떨어지는 값이 통째로 사라졌다.

    **두 분기가 같이 쓴다.** 규칙·공식이 답한 칸(1순위)과 ML 이 검사값을 기준과
    대조한 칸(2순위) 둘 다 `measured=True` 다.
    """
    reference = verdict.reference
    if reference is None:
        return
    if verdict.risk_level in _PRESENT_LEVELS and reference.get("trajectory") is not None:
        reference["trajectory"] = None
        reference["trajectory_status"] = STATUS_ALREADY_PRESENT
    if model_contradicts_measurement(verdict):
        reference["prevalence_trajectory"] = None


# ---------------------------------------------------------------------------
# 중재
# ---------------------------------------------------------------------------


def arbitrate(
    domains: dict[str, dict[str, Any]],
    conditions: dict[str, dict[str, Any]],
) -> list[DiseaseVerdict]:
    """질환마다 정본 엔진을 고른다. 순수 함수 — I/O 도 모델 적재도 하지 않는다.

    `domains` 는 규칙·공식 판정(`DomainResult` 모양), `conditions` 는 ML 카드를
    타깃 이름으로 담은 사전이다. 둘 다 이미 계산된 값을 받는다. 이렇게 갈라 둔 이유는
    **모델 번들 없이도 중재 규칙을 테스트할 수 있어야** 하기 때문이다.
    """
    verdicts: list[DiseaseVerdict] = []

    for spec in SPECS:
        domain = domains.get(spec.deterministic) if spec.deterministic else None
        condition = conditions.get(spec.ml_target) if spec.ml_target else None
        decided = domain is not None and domain.get("risk_level") != INSUFFICIENT

        # --- 1순위. 규칙·공식이 답했다 -------------------------------------
        if decided:
            assert domain is not None
            engine_name = "규칙 엔진" if spec.deterministic_engine == "E1" else "공개 공식"
            verdict = _from_domain(
                spec,
                domain,
                f"측정값이 있어 {engine_name}이 정본입니다. ML 확률은 참고로 내려갑니다."
                if condition
                else f"측정값이 있어 {engine_name}이 판정했습니다.",
            )
            verdict.measured = True
            if condition:
                verdict.superseded_by = spec.deterministic_engine
                verdict.reference = _ml_reference(condition)
                # 측정값이 이미 질환 범위면 "지금 없다면 앞으로" 라는 전제가 무너진다.
                _drop_forecasts_when_already_present(verdict)
            verdicts.append(verdict)
            continue

        # --- 2순위. ML 의 임계값 대조 ---------------------------------------
        # 규칙 엔진에 대응 영역이 없는 질환(고콜레스테롤·고중성지방·낮은 HDL)에서
        # 이쪽이 그 자리를 메운다. 라벨을 만드는 검사값이 들어와야 답이 나온다.
        judgement = (condition or {}).get("judgement")
        if judgement:
            checked = judgement.get("checked", [])
            hit = [c for c in checked if c.get("met")]
            verdicts.append(
                DiseaseVerdict(
                    key=spec.key,
                    name=spec.name,
                    engine="E2",
                    engine_label=ENGINE_LABELS["E2"],
                    engine_reason=(
                        "규칙 엔진에 대응 영역이 없는 질환입니다. 입력한 검사값을 "
                        "진단 기준과 직접 대조했고, 확률은 참고로 내려갑니다."
                    ),
                    risk_level=grade_from_judgement(judgement),
                    sub_status="기준 초과" if judgement.get("met") else "기준 이내",
                    display_label=(
                        "입력한 검사값이 진단 기준을 넘었어요."
                        if judgement.get("met")
                        else "입력한 검사값은 기준 안에 있어요."
                    ),
                    reason=" · ".join(
                        f"{c['label']} {c['value']}{c['unit']} ({c['op']} {c['threshold']})" for c in (hit or checked)
                    ),
                    criteria_reference=judgement.get("source", ""),
                    recommendation=(
                        "단일 시점 측정값입니다. 재측정 후에도 같으면 진료를 권합니다."
                        if judgement.get("met")
                        else "현재 기준으로는 추가 조치가 필요하지 않습니다."
                    ),
                    input_values={c["label"]: c["value"] for c in checked},
                    # 확률이 아니라 대조가 정본이므로 확률 쪽이 밀렸다.
                    superseded_by="E2",
                    # 엔진은 `E2` 지만 이건 확률이 아니라 **입력한 검사값을 기준과 대조한
                    # 결과**다. 순위 점수가 이걸 추정으로 취급하면 카드와 패널이 같은
                    # 화면에서 서로 다른 말을 한다.
                    measured=True,
                    reference=_ml_reference(condition),
                )
            )
            # 1순위와 **같은 억제**를 건다. 이쪽도 검사값으로 판정한 칸이라
            # 기준을 넘었으면 앞날 숫자가 배지와 부딪힌다.
            _drop_forecasts_when_already_present(verdicts[-1])
            continue

        # --- 3순위. ML 확률 --------------------------------------------------
        if condition and spec.ml_fallback:
            level, detail = GRADE_SOURCE(condition.get("medical"), condition.get("peer_percentile"))
            verdicts.append(
                DiseaseVerdict(
                    key=spec.key,
                    name=spec.name,
                    engine="E2",
                    engine_label=ENGINE_LABELS["E2"],
                    engine_reason="측정값이 없어 ML 이 답했습니다. 발병 예측이 아니라 재면 기준을 넘을 가능성입니다.",
                    risk_level=level,
                    # **엔진 이름을 여기 다시 쓰지 않는다.** 화면의 두 엔진 칸은
                    # `[엔진 이름][이 칸의 답]` 꼴인데 여기에 "ML 예측" 을 넣으면
                    # "ML 예측 47% → ML 예측 ML 예측" 이 된다(실측). 이 칸의 답은
                    # 등급이다.
                    sub_status=LEVEL_NAMES.get(level, level),
                    display_label="측정값 없이 추정한 값이에요. 확인하려면 검사가 필요합니다.",
                    reason=detail,
                    criteria_reference=condition.get("threshold_source", ""),
                    recommendation="정확히 알려면 해당 검사를 받아 값을 입력해 주세요.",
                    input_values={},
                    missing_fields=list((domain or {}).get("missing_fields", [])),
                    # **결정론 엔진이 침묵하며 남긴 말은 버리지 않는다.**
                    # 값이 없어서 못 답한 경우에는 남길 것이 없지만, 값이 있는데도
                    # 등급을 안 매긴 경우가 있다 — 만성염증의 급성 구간(CRP>10)이
                    # 그렇다. 규칙 엔진은 "2주 뒤 재측정" 이라는 가장 행동에 가까운
                    # 말을 남기고 물러나는데, 그걸 안 옮기면 CRP 15 를 넣은 사람이
                    # 그 문장을 영영 못 본다(실측으로 사라지고 있었다).
                    flags=[
                        *(domain or {}).get("flags", []),
                        "측정하지 않고 추정한 등급이라 최고 등급(VERY_HIGH)은 나오지 않습니다.",
                    ],
                    superseded_by=None,
                    reference=_ml_reference(condition),
                )
            )
            continue

        # --- 아무도 답하지 못했다 --------------------------------------------
        # 카드를 지우지 않는다. "정보 부족" 은 정보다 — 무엇을 더 넣으면 답이
        # 나오는지가 여기 적힌다. 화면이 접을지는 화면이 정한다.
        missing = list((domain or {}).get("missing_fields", []))
        blocked_by_policy = condition is not None and not spec.ml_fallback
        reference = _ml_reference(condition)
        # 확률을 표시하지 않기로 한 질환에서 궤적만 내보내면 같은 확률이 다른 이름으로
        # 나가는 것이다. 카드가 "정보 부족" 이면 궤적도 없다 — 상태로 이유를 남긴다.
        if blocked_by_policy and reference.get("trajectory") is not None:
            reference["trajectory"] = None
            reference["trajectory_status"] = STATUS_WITHHELD
        # 유병 곡선도 같은 이유로 막는다. 확률을 안 보이기로 한 질환에서 곡선만
        # 내보내면 같은 확률이 다른 이름으로 나가는 것이다.
        if blocked_by_policy:
            reference["prevalence_trajectory"] = None
        verdicts.append(
            DiseaseVerdict(
                key=spec.key,
                name=spec.name,
                engine=spec.deterministic_engine,
                engine_label=ENGINE_LABELS[spec.deterministic_engine],
                engine_reason=(
                    "이 질환은 공식이 정본이라 값이 없으면 확률로 대신하지 않습니다 (ADR-009 §4)."
                    if blocked_by_policy
                    else "판정에 필요한 값이 없습니다."
                ),
                risk_level=INSUFFICIENT,
                sub_status=(domain or {}).get("sub_status", "정보 부족"),
                display_label=(domain or {}).get("display_label", "판단할 정보가 부족해요."),
                reason=(domain or {}).get("reason", "필요한 값이 입력되지 않았습니다."),
                criteria_reference=(domain or {}).get("criteria_reference", ""),
                recommendation=(domain or {}).get("recommendation", ""),
                missing_fields=missing,
                superseded_by=None,
                reference=reference,
            )
        )

    return verdicts


# ---------------------------------------------------------------------------
# 요약 — 화면 상단 한 줄
# ---------------------------------------------------------------------------

_SEVERITY = {
    RiskLevel.VERY_HIGH.value: 4,
    RiskLevel.HIGH.value: 3,
    RiskLevel.CAUTION.value: 2,
    RiskLevel.NORMAL.value: 1,
    INSUFFICIENT: 0,
}


def summarize(
    verdicts: list[DiseaseVerdict],
    disease_risks: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """몇 칸을 판정했고 그중 무엇이 가장 급한가.

    벤더 엔진이 "영역을 하나의 종합 점수로 합치지 않는다" 를 설계 원칙으로 못 박았다
    (ADR-009 검토한 대안 참조). 그래서 여기서도 **합산 점수를 만들지 않는다.**
    세는 것과 가장 높은 것을 가리키는 것만 한다.

    **두 축을 한 목록에 섞지 않는다.** 열세 칸(장기별 현재 상태)과 매트릭스(수치 하나가
    가리키는 여러 질환)는 재료가 겹치므로 합치면 같은 값을 두 번 센다. 세어서 나란히
    내보내고, 무엇을 위에 놓을지는 화면이 정한다.
    """
    evaluated = [v for v in verdicts if v.risk_level != INSUFFICIENT]
    insufficient = [v.key for v in verdicts if v.risk_level == INSUFFICIENT]
    by_engine: dict[str, int] = {}
    for verdict in evaluated:
        by_engine[verdict.engine] = by_engine.get(verdict.engine, 0) + 1

    caution = _SEVERITY[RiskLevel.CAUTION.value]
    attention = sorted(evaluated, key=lambda v: -_SEVERITY[v.risk_level])
    top = [v.key for v in attention if _SEVERITY[v.risk_level] >= caution]

    matrix = disease_risks or {}
    matrix_levels = {key: level_str(result.get("risk_level")) for key, result in matrix.items()}
    matrix_done = [key for key, level in matrix_levels.items() if level != INSUFFICIENT]
    matrix_top = sorted(
        (key for key in matrix_done if _SEVERITY.get(matrix_levels[key], 0) >= caution),
        key=lambda key: -_SEVERITY.get(matrix_levels[key], 0),
    )
    return {
        "evaluated": len(evaluated),
        "total": len(verdicts),
        "insufficient": insufficient,
        "by_engine": by_engine,
        "needs_attention": top,
        "highest_level": attention[0].risk_level if attention else INSUFFICIENT,
        "matrix_evaluated": len(matrix_done),
        "matrix_total": len(matrix),
        "matrix_needs_attention": matrix_top,
    }


# ---------------------------------------------------------------------------
# 조립 — 세 엔진을 부르고 중재에 넘긴다
# ---------------------------------------------------------------------------


def collect_domains(profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """규칙 엔진 4 + 확장 5 + 대사증후군 1 = 결정론 판정 10칸.

    엔진을 함수 안에서 불러온다. 앱 기동이 벤더 패키지 존재에 묶이지 않게 하려는
    것이고, `rule_assessment_routers.py` 가 같은 이유로 같은 방식을 쓴다.
    """
    from app.services.lab_staging import assess_extra_domains, evaluate_metabolic_syndrome
    from chronic_disease_engine import assess_chronic_disease_risk

    return {
        **assess_chronic_disease_risk(profile),
        **assess_extra_domains(profile),
        "metabolic_syndrome": evaluate_metabolic_syndrome(profile),
    }


def known_targets(verdicts: Iterable[DiseaseVerdict]) -> set[str]:
    """**측정으로** "있다" 고 확정된 ML 타깃. 의심 순위에서 뺀다.

    이미 아는 질환을 "의심됩니다" 로 다시 올리면 화면의 가장 좋은 자리를 사용자가
    이미 아는 정보에 쓰게 된다.

    도메인이 아니라 **판정**을 본다. 도메인만 보면 규칙 엔진에 대응 영역이 없는
    질환(지질 하위유형 셋)이 통째로 빠지는데, 그 셋은 `model.judge()` 가 검사값을
    직접 대조해 `HIGH` 를 내는 자리다. 그 판정이 여기 안 잡히면 `signal_strength`
    에서도 안 잡혀(`MEASURED_WEIGHT` 에 `HIGH` 가 없다) 조용히 ML 추정으로 떨어졌고,
    그게 2026-09-03 에 실측으로 확인한 25 건이다.
    """
    ml_target = {spec.key: spec.ml_target for spec in SPECS}
    out: set[str] = set()
    for verdict in verdicts:
        if not verdict.measured or level_str(verdict.risk_level) not in KNOWN_LEVELS:
            continue
        target = ml_target.get(verdict.key)
        if target:
            out.add(target)
    return out


def collect_conditions(payload: Any, models: Any) -> dict[str, dict[str, Any]]:
    """ML 카드를 타깃 이름으로 담는다. 번들이 없으면 빈 사전이다.

    번들 미적재를 예외로 만들지 않는다 — 규칙·공식만으로도 답할 칸이 있고, 그때
    화면이 통째로 비는 것보다 "ML 칸만 정보 부족" 이 정확하다. 호출자는 응답의
    `model_available` 로 그 사실을 읽는다.
    """
    if models is None or not models.available:
        return {}

    from app.services.prediction import build_prediction

    data = build_prediction(payload, models)
    return {condition.target: condition.model_dump() for condition in data.conditions}


def collect_disease_risks(profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """수치→질환 매트릭스. 위 열세 칸과 **같은 축이 아니다.**

    영역 판정이 "여러 수치 → 이 장기의 현재 상태" 라면 이쪽은 그 전치다 —
    "수치 하나 → 여러 질환의 앞날". γ-GTP 는 간 영역에서 읽히면서 제2형 당뇨 발생도
    예측하고, 알부민뇨는 eGFR 과 독립적으로 심혈관 사망을 예측한다. 장기별로만 묶어
    읽으면 그 화살표들이 보이지 않는다.

    **합치지 않고 따로 낸다.** 같은 질환이 양쪽에 나올 수 있고 뜻이 다르다. 합치면
    같은 재료를 두 번 세게 되고, 매트릭스가 애초에 그것을 피하려고 만든 구조다
    (`disease_risk_matrix._score_disease` 의 중복 방지). `/assessments/rules` 가 이미
    `domains` 와 `disease_risks` 를 갈라 내보내고 있어 그 계약과도 맞다.

    **심혈관질환은 이 축에만 있다.** 열세 칸에 `cvd` 가 없는 것은 규칙 엔진에도 ML
    번들에도 심혈관 타깃이 없기 때문이고, 그래서 이 축을 빼면 만성질환 서비스에서
    심혈관질환이 통째로 사라진다.
    """
    from app.services.disease_risk_matrix import assess_disease_risks

    return assess_disease_risks(profile)


def assess(payload: Any, models: Any) -> tuple[list[DiseaseVerdict], dict[str, Any], dict[str, Any], bool, list[Any]]:
    """온보딩 입력 한 벌 → 질환별 판정 + 매트릭스 축 + 요약 + ML 적재 여부.

    `payload` 는 `AssessmentSummaryRequest` 다. 타입을 `Any` 로 둔 것은 이 모듈이
    DTO 를 import 하지 않게 하려는 것이다 — 중재 규칙은 순수 계산이고, 스키마가
    바뀔 때마다 규칙 테스트가 같이 흔들리면 안 된다.
    """
    profile = payload.to_rule_profile()
    domains = collect_domains(profile)
    available = models is not None and models.available
    suspects: list[Any] = []
    conditions: dict[str, dict[str, Any]] = {}
    cards: list[Any] = []
    request = None
    tier = "basic"
    features: dict[str, Any] = {}
    if available:
        from app.services.prediction import score_conditions

        request = payload.to_prediction_request()
        cards, tier, features = score_conditions(request, models)
        conditions = {c.target: c.model_dump() for c in cards}

    verdicts = arbitrate(domains, conditions)

    # **순위는 중재 뒤에 매긴다.** 규칙 엔진이 측정값으로 준 판정을 신호로 합쳐야
    # 하는데, 그 판정은 카드가 나온 뒤 중재를 거쳐야 나온다. 순서를 바꾸면 1 단계가
    # 규칙 엔진을 못 보고 ML 확률만으로 고르게 된다.
    if available and request is not None:
        from app.services.prediction import rank_and_attach

        # **순위 매기기는 ML 번들 이름 공간에서 돈다.** 카드는 `SPECS.key` 로
        # 부르는데(`liver`·`uric_acid`) 번들 타깃은 다른 이름이다
        # (`liver_enzyme_high`·`hyperuricemia`). 한쪽으로 통일하지 않으면 판정
        # 조회가 조용히 빗나가서 확진된 카드가 "추정" 으로 떨어진다 — 2026-09-03 에
        # 같은 꼴의 버그를 25 건 겪었다. 들어갈 때 번들 이름으로 바꾸고 나올 때
        # 되돌린다.
        to_target = {spec.key: (spec.ml_target or spec.key) for spec in SPECS}
        to_key = {target: key for key, target in to_target.items()}

        # **ML 번들이 없는 질환도 후보에 넣는다.** 등급은 있는데 순위에 못 오면
        # 패널이 카드 2위를 빼놓게 된다. 실측(당뇨 프리셋)에서 그 상태였다.
        #
        # `rank_suspects` 는 조건 사전을 받으므로 최소 모양으로 만들어 준다. 확률도
        # 의학 등급도 없고, `signal_strength` 가 판정(`verdicts`)만 보고 무게를 준다.
        scored_targets = {card.target for card in cards}
        extra = [
            {"target": to_target[spec.key], "name": spec.name}
            for spec in SPECS
            if spec.ml_target is None or spec.ml_target not in scored_targets
        ]
        suspects = rank_and_attach(
            cards,
            request,
            models,
            tier,
            features,
            verdicts={
                to_target.get(v.key, v.key): {
                    "engine": v.engine,
                    "risk_level": v.risk_level,
                    "measured": v.measured,
                }
                for v in verdicts
            },
            known=known_targets(verdicts),
            extra=extra,
        )
        suspects = [card.model_copy(update={"target": to_key.get(card.target, card.target)}) for card in suspects]

    # **질환 이름의 정본은 `SPECS` 하나다.** 카드는 이 표를 쓰고 의심 패널은 ML
    # 번들의 `name` 을 쓰고 있어서, 같은 질환이 두 이름으로 나갔다 — `ckd` 가
    # "만성콩팥병"/"신기능 확인 필요", `dm` 이 "당뇨병"/"당뇨", `hyperchol` 이
    # "고콜레스테롤혈증"/"고LDL콜레스테롤혈증". 사용자가 두 이름을 다른 질환으로
    # 읽는 것을 실제로 확인했다.
    #
    # 번들 쪽을 고치려면 20개를 재export 해야 하고, 이름은 화면 표기라 학습 산출물이
    # 정할 일이 아니다. 그래서 표시 직전에 이 표로 덮는다.
    #
    # **등급도 같이 덮는다.** `SuspectCard.level` 은 순위 점수를 만든 재료라 규칙
    # 5단계와 의학 4단계가 섞여 들어온다 — 같은 고혈압이 카드에서 "정상", 패널에서
    # "정상 범위" 로 나오던 원인이다. 카드가 쓰는 등급을 `risk_level` 로 따로 실어
    # 화면이 같은 배지를 그리게 한다.
    # 위에서 `to_key` 로 되돌려 놨으므로 여기는 `SPECS.key` 공간이다.
    name_by_target = {spec.key: spec.name for spec in SPECS}
    level_by_target = {verdict.key: verdict.risk_level for verdict in verdicts}
    # **앞날을 낼지 말지는 한 곳에서만 정한다.** 의심 카드의 곡선은 중재를 거치지 않은
    # `ConditionRisk` 에서 곧장 오므로, 판정 쪽에서 지운 칸이 패널에는 남아 있었다.
    # 그러면 같은 질환이 위아래에서 다른 말을 한다 — 화면이 각자 판단하게 두면
    # 한쪽만 고쳐진다. 여기서 같은 결정을 옮겨 담는다.
    muted_targets = {v.key for v in verdicts if model_contradicts_measurement(v)}
    present_targets = {v.key for v in verdicts if v.risk_level in _PRESENT_LEVELS}
    suspects = [
        card.model_copy(
            update={
                "name": name_by_target.get(card.target, card.name),
                "risk_level": level_by_target.get(card.target, ""),
                "prevalence_trajectory": (None if card.target in muted_targets else card.prevalence_trajectory),
                # "지금 없다면" 이 전제라 이미 넘은 칸에서는 성립하지 않는다.
                "onset_trajectory": (None if card.target in present_targets else card.onset_trajectory),
            }
        )
        for card in suspects
    ]

    disease_risks = collect_disease_risks(profile)
    return verdicts, disease_risks, summarize(verdicts, disease_risks), available, suspects
