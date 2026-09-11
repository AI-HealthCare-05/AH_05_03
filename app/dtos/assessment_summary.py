"""통합 판정 요청·응답 DTO — 화면이 붙는 단일 진입점 (ADR-009 §8).

왜 요청 스키마가 하나 더 필요한가
---------------------------------
지금 서버에는 건강 수치를 받는 입구가 둘이고 **같은 값을 다른 이름으로 받는다.**

| 개념 | `/predictions/risk` | `/assessments/rules` |
|---|---|---|
| 수축기 혈압 | `sbp` | `systolic_bp` |
| 총콜레스테롤 | `total_chol` | `total_cholesterol` |
| HDL | `hdl` | `hdl_c` |
| 중성지방 | `triglyceride` | `triglycerides` |
| 흡연 | `smoking_status` (3값) | `smoking` (참/거짓) |

화면이 두 곳을 각각 부르면 **입력 폼 하나를 두 벌로 매핑해야 하고, 그 매핑이 화면에
산다.** 엔진 중재를 서버로 올리는 결정(ADR-009 §4)이 이 매핑도 같이 데려온다 —
중재자가 두 엔진을 다 부르는 이상 이름 사상도 서버가 해야 한다.

`RiskPredictionRequest` 를 **상속한다.** 베껴 쓰면 ML 쪽 필드가 조용히 어긋날 수
있고, 그 어긋남은 "확률이 입력에 반응하지 않는다" 로 나타난다 — 이미 한 번 겪은
종류의 버그다(`veg_fruit_daily` 유령 입력).
"""

from typing import Any, ClassVar, Literal

from pydantic import Field

from app.dtos.base import BaseSerializerModel
from app.dtos.predictions import (
    MedicalRisk,
    ModelAccuracy,
    OnsetTrajectory,
    PrevalenceTrajectory,
    RiskFactor,
    RiskPredictionRequest,
    RuleAnchor,
    SuspectCard,
)
from app.dtos.rule_assessment import DiseaseRiskAssessment


class AssessmentSummaryRequest(RiskPredictionRequest):
    """온보딩 입력 한 벌. 필수 5개는 부모에서 오고 여기서는 규칙 엔진 전용만 더한다."""

    # --- 규칙 엔진만 쓰는 값 -------------------------------------------
    ogtt_2h: float | None = Field(default=None, gt=20, le=600, description="경구당부하 2시간 혈당 mg/dL")
    is_fasting: bool | None = Field(default=None, description="공복혈당이 실제 공복 상태 측정인지")
    non_hdl_c: float | None = Field(default=None, gt=0, le=1000, description="비우면 총콜레스테롤-HDL 로 계산")
    has_diabetes: bool | None = Field(default=None, description="당뇨 진단을 받은 적이 있는가")
    has_hypertension: bool | None = Field(default=None, description="고혈압 진단을 받은 적이 있는가")
    has_ascvd_history: bool | None = Field(default=None, description="동맥경화성 심혈관질환 병력")
    # **ML 특징이 아니라 라벨 재료다.** 만성염증 모델이 이 값을 맞히므로 특징으로
    # 쓰면 라벨 누출이고(`modeling/targets.py` 가 차단한다), 다른 타깃의
    # `LAB_FEATURES` 에도 넣지 않았다 — 학습 주기 둘이 통째로 없고 국가건강검진
    # 혈액 패널 밖이라 서빙에서 대부분 결측이다. 그래서 규칙 전용 입력으로 둔다.
    crp: float | None = Field(default=None, gt=0, le=500, description="고감도 CRP mg/L")

    # ML 쪽 이름 -> 규칙 엔진 쪽 이름. 값이 아니라 이름만 바꾼다.
    RENAMED_FOR_RULES: ClassVar[dict[str, str]] = {
        "sbp": "systolic_bp",
        "dbp": "diastolic_bp",
        "total_chol": "total_cholesterol",
        "hdl": "hdl_c",
        "ldl": "ldl_c",
        "triglyceride": "triglycerides",
    }

    # 규칙 엔진·`lab_staging` 이 읽지 않는 값. 넘겨도 무시되지만(엔진이
    # `extra="ignore"`) 넘기지 않는 편이 "누가 무엇을 읽는지" 를 분명하게 한다.
    ML_ONLY: ClassVar[frozenset[str]] = frozenset(
        {
            "self_rated_health",
            "alcohol_days_per_year",
            "moderate_min_per_week",
            "vigorous_min_per_week",
            "sedentary_min_per_day",
            "sleep_hours",
            "albumin",
            "smoking_status",
        }
    )

    def to_prediction_request(self) -> RiskPredictionRequest:
        """ML 쪽이 아는 필드만 남겨 부모 타입으로 되돌린다.

        `include=` 에 `model_fields` 를 쓰는 것이 중요하다. 그냥 `model_dump()` 하면
        계산 필드 `bmi` 가 딸려 들어가고 부모는 `extra="forbid"` 라 422 가 된다 —
        큐 경로에서 한 번 겪은 실패다(`docs/35_prediction_queue_and_workers.md` §8).
        """
        fields = set(RiskPredictionRequest.model_fields)
        return RiskPredictionRequest.model_validate(self.model_dump(include=fields, exclude_none=True))

    def to_rule_profile(self) -> dict[str, Any]:
        """규칙 엔진과 `lab_staging` 이 읽는 이름으로 바꾼다."""
        raw = self.model_dump(exclude_none=True)
        raw.pop("bmi", None)  # 엔진이 키·체중에서 직접 계산한다
        profile: dict[str, Any] = {}
        for name, value in raw.items():
            if name in self.ML_ONLY:
                continue
            profile[self.RENAMED_FOR_RULES.get(name, name)] = value

        # 흡연은 값의 모양이 다르다. 3값을 참/거짓으로 접되 `former` 를 참으로 세지
        # 않는다 — 규칙 엔진의 `smoking` 은 현재 흡연 여부를 묻는다.
        if self.smoking_status is not None:
            profile["smoking"] = self.smoking_status == "current"
        return profile


class VerdictReference(BaseSerializerModel):
    """정본이 아닌 엔진이 낸 값. 지우지 않고 참고로 싣는다.

    `accuracy` 와 `rule_anchor` 가 여기 있는 이유는 **AUROC 한 숫자가 화면에서 가장
    오해받는 값**이기 때문이다. "100명 중 몇 명을 맞힌다"가 아니라 위험한 사람과 아닌
    사람을 한 명씩 뽑았을 때 위험한 쪽에 더 높은 점수를 줄 확률이다. 사용자가 실제로
    겪는 값은 경보 적중률·발견율이고 `ModelAccuracy` 가 그 둘을 담아 온다.
    `rule_anchor` 는 확률을 읽을 자를 준다 — 이 확률대의 사람들을 실제로 검사하면
    학회 기준으로 몇 %가 넘었는가.
    """

    model_target: str | None = Field(
        default=None,
        description="이 확률을 낸 ML 번들의 타깃 이름. 카드 키와 다를 수 있다 (liver → liver_enzyme_high)",
    )
    probability: float | None = None
    peer_percentile: float | None = None
    peer_group: str | None = None
    peer_median: float | None = None
    peer_ratio: float | None = Field(default=None, description="같은 집단 중간값 대비 배수")
    medical_level: str | None = None
    medical: MedicalRisk | None = Field(
        default=None,
        description=(
            "의학 기준 등급 묶음. `medical_level` 은 이 안의 `level` 하나다.\n\n"
            "**등급 문자열만으로는 게이지를 그릴 수 없어서 전체를 싣는다.** 자세히 보기가 "
            "'이 점수대 100명 중 몇 명' 과 전체 평균 대비 배수를 함께 보여주는데, 그 재료가 "
            "`rate`·`basis`·`baseline`·`lift` 다. 예측 데모(`/api/demo`)가 `/predictions/risk` 를 "
            "따로 불러 이 값을 쓰고 있었고, 데모를 판정 화면에 합치면서 여기로 옮겼다."
        ),
    )
    model_auroc: float | None = None
    tier: str | None = None
    accuracy: ModelAccuracy | None = Field(default=None, description="이 숫자를 얼마나 믿어도 되는가")
    rule_anchor: RuleAnchor | None = Field(
        default=None, description="이 확률대를 실제로 검사하면 학회 기준으로 몇 %가 넘는가"
    )
    top_factors: list[RiskFactor] = Field(
        default=[],
        description=(
            "로그오즈 기여도. **개선 조언으로 그대로 쓰면 안 된다** — 단면 데이터에서 "
            "금연·절주가 당뇨 위험을 올리는 방향으로 나온다. 설명 재료로만 쓴다"
        ),
    )
    trajectory: OnsetTrajectory | None = Field(
        default=None, description="2단계 발병 궤적. 1단계가 의심한 비가역 질환(당뇨·고혈압·신기능)에만 있다"
    )
    trajectory_status: str | None = Field(default=None, description="궤적이 없으면 왜 없는지. `TrajectoryStatus` 값")
    prevalence_trajectory: PrevalenceTrajectory | None = Field(
        default=None,
        description=(
            "'그 나이가 됐을 때 기준을 넘고 있을 확률'. 발병 궤적과 **다른 물음**이라 "
            "열 질환 전부에 있다. 확률을 표시하지 않기로 한 질환(ADR-009 §4)과 이미 "
            "기준을 넘은 카드에서는 지운다 — 같은 확률이 다른 이름으로 나가면 안 된다"
        ),
    )


class DiseaseVerdictOut(BaseSerializerModel):
    key: str
    name: str
    engine: Literal["E1", "E2", "E3"] = Field(description="이 질환에 답한 엔진")
    engine_label: str
    engine_reason: str = Field(description="왜 그 엔진이 답했는가. 화면이 그대로 읽을 수 있어야 한다")
    risk_level: Literal["INSUFFICIENT_DATA", "NORMAL", "CAUTION", "HIGH", "VERY_HIGH"] = Field(
        description="규칙 엔진 5단계로 통일된 등급 (ADR-009 §5)"
    )
    sub_status: str
    display_label: str
    reason: str
    criteria_reference: str
    recommendation: str
    input_values: dict[str, Any] = {}
    missing_fields: list[str] = []
    flags: list[str] = []
    superseded_by: str | None = Field(
        default=None,
        description="ML 확률이 무엇에 밀렸는가. ML 이 정본이면 null",
    )
    reference: VerdictReference | None = None
    disclaimer: str


class Complication(BaseSerializerModel):
    """이 질환이 그대로 이어질 때 뒤따르는 것 하나.

    `DiseaseRiskAssessment.contributors` 와 **같은 모양**이다(설명·효과·출처·인과).
    저쪽이 "무엇이 이 질환을 가리켰나" 라면 이쪽은 "이 질환이 무엇을 부르나" 이고,
    같은 문법으로 읽히는 편이 맞다.
    """

    label: str
    organ: str = Field(description="어느 장기·계통의 이야기인가. 목록이 길 때 묶어 읽을 손잡이")
    detail: str
    effect: str = Field(description="크기. 숫자를 못 대는 고리는 지침 문구만 적고 크기를 말하지 않는다")
    source: str
    causal: bool | None = Field(
        default=None,
        description=(
            "`null` 은 인과를 따로 따져본 적이 없다는 뜻, `false` 는 따져봤더니 아니었다는 "
            "뜻이다 — 완전히 다른 말이라 화면이 구분해 적는다"
        ),
    )


class ComplicationOutlook(BaseSerializerModel):
    """이미 기준을 넘었거나 경계에 있는 질환 하나의 앞날.

    **`verdicts` 의 뒤쪽이다.** 판정이 "지금 어떤가" 에서 끝나는 반면 이쪽은 "그대로
    두면 무엇이 뒤따르나" 를 답한다. 궤적(`onset_trajectory`)이 이미 넘은 칸에서
    지워지기 때문에(ADR-009 §4), 판정이 높게 나온 사람일수록 그다음에 읽을 것이
    없었다 — 이 목록이 그 자리를 채운다.

    **환자별 계산이 아니라 질환별 사전이다.** 입력 수치가 정하는 것은 어떤 질환이
    목록에 오르는가 하나뿐이고, 무엇이 딸려 오는지는 지침과 코호트가 정한다.
    """

    key: str = Field(description="`verdicts[].key` 와 같다")
    name: str = Field(description="`verdicts[].name` 과 같다. 이름의 정본은 판정 쪽 하나다")
    risk_level: Literal["CAUTION", "HIGH", "VERY_HIGH"] = Field(
        description="이 전망이 붙은 판정 등급. `NORMAL`·`INSUFFICIENT_DATA` 는 목록에 오지 않는다"
    )
    lead: str = Field(description="첫 줄. 넘은 것과 경계에 있는 것은 다른 문장으로 말한다")
    summary: str
    caveat: str | None = Field(
        default=None,
        description=(
            "이 질환을 합병증 틀로 말하면 안 되는 이유. 낮은 HDL 처럼 중재시험이 실패한 "
            "고리는 `complications` 가 비고 이 줄만 선다"
        ),
    )
    complications: list[Complication] = []
    monitoring: list[str] = Field(
        default=[],
        description="지금 무엇을 언제 확인하는가. 합병증은 대개 증상이 없어서 이 줄이 없으면 읽고 할 일이 남지 않는다",
    )


class AssessmentSummary(BaseSerializerModel):
    evaluated: int
    total: int
    insufficient: list[str]
    by_engine: dict[str, int] = Field(description="엔진별로 몇 칸을 답했는가")
    needs_attention: list[str] = Field(description="CAUTION 이상인 질환. 급한 순")
    highest_level: str
    # 매트릭스 축은 따로 센다. 열세 칸과 재료가 겹쳐 합치면 두 번 세게 된다.
    matrix_evaluated: int = Field(default=0, description="매트릭스 축에서 판정이 나온 질환 수")
    matrix_total: int = 0
    matrix_needs_attention: list[str] = Field(default=[], description="매트릭스 축에서 CAUTION 이상. 급한 순")


class AssessmentSummaryData(BaseSerializerModel):
    bmi: float
    summary: AssessmentSummary
    verdicts: list[DiseaseVerdictOut]
    disease_risks: dict[str, DiseaseRiskAssessment] = Field(
        default={},
        description=(
            "**`verdicts` 의 전치다.** `verdicts` 가 '여러 수치 → 이 장기의 현재 상태' 라면 "
            "이쪽은 '수치 하나 → 여러 질환의 앞날'이다. 같은 질환이 양쪽에 나올 수 있고 뜻이 "
            "다르다. 합치지 않는 이유는 합치면 같은 재료를 두 번 세기 때문이다.\n\n"
            "**심혈관질환은 이 축에만 있다** — 규칙 엔진에도 ML 번들에도 심혈관 타깃이 없다. "
            "각 항목의 `contributors` 가 어떤 값이 왜 위험을 올렸는지와 그 효과크기·출처·"
            "인과 여부를 담는다."
        ),
    )
    complication_outlooks: list[ComplicationOutlook] = Field(
        default=[],
        description=(
            "**`verdicts` 중 `CAUTION` 이상인 칸에만 붙는 앞날이다.** `disease_risks` 가 "
            "'아직 안 걸렸는데 향하고 있는가' 를 답한다면 이쪽은 '이미 걸린 것이 무엇을 "
            "부르는가' 를 답한다. 급한 등급 순으로 정렬돼 있다.\n\n"
            "질환별 사전이라 입력 수치에 따라 내용이 달라지지 않는다 — 수치가 정하는 것은 "
            "어떤 질환이 목록에 오르는지 하나뿐이다. 그래서 확률을 붙이지 않는다."
        ),
    )
    top_suspects: list[SuspectCard] = Field(
        default=[],
        description=(
            "1단계가 고른 의심 상위 세 개. 규칙 엔진이 이미 '있다' 고 판정한 질환은 빠진다 — "
            "사용자가 이미 아는 것을 다시 의심으로 올리지 않는다. 각 장에 2단계 곡선이 붙는다"
        ),
    )
    disclaimers: list[str]
    inputs_provided: int
    inputs_total: int
    model_available: bool = Field(description="ML 번들이 적재됐는가. false 면 규칙·공식만으로 답했다")
