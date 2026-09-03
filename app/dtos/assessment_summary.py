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
from app.dtos.predictions import ModelAccuracy, RiskFactor, RiskPredictionRequest, RuleAnchor
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
            "difficulty_walking",
            "alcohol_days_per_year",
            "moderate_min_per_week",
            "vigorous_min_per_week",
            "sedentary_min_per_day",
            "sleep_hours",
            "education_level",
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

    probability: float | None = None
    peer_percentile: float | None = None
    peer_group: str | None = None
    peer_median: float | None = None
    peer_ratio: float | None = Field(default=None, description="같은 집단 중간값 대비 배수")
    medical_level: str | None = None
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
    disclaimers: list[str]
    inputs_provided: int
    inputs_total: int
    model_available: bool = Field(description="ML 번들이 적재됐는가. false 면 규칙·공식만으로 답했다")
