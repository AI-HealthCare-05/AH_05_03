"""만성질환 위험도 예측 요청·응답 DTO.

필수 4개(나이·성별·BMI 재료·주관적 건강)만 받으면 전체 성능의 99.5%가 나온다.
근거는 docs/20_prediction_inputs_and_levers.md 1절.

나머지는 선택이다. 비우면 학습 시점의 중앙값으로 대치하고 결측 지시자를 켜므로
예측은 항상 나온다. 다만 값이 없으면 그만큼 그 사람에 대한 정보가 없다.
"""

from typing import ClassVar, Literal

from pydantic import Field, computed_field, model_validator

from app.dtos.base import BaseRequestModel, BaseSerializerModel

SelfRatedHealth = Literal[1, 2, 3, 4, 5]
SmokingStatus = Literal["never", "former", "current"]


class RiskPredictionRequest(BaseRequestModel):
    # --- 필수 4개 ---------------------------------------------------
    age: int = Field(ge=19, le=100, description="만 나이")
    sex: Literal["M", "F"]
    height_cm: float = Field(gt=100, lt=230, description="키. BMI 계산에만 사용한다")
    weight_kg: float = Field(gt=25, lt=300, description="체중. BMI 계산에만 사용한다")
    self_rated_health: SelfRatedHealth = Field(
        description="전반적으로 본인의 건강이 어떻다고 생각하십니까. 1=매우 좋음 ... 5=매우 나쁨"
    )

    # --- 선택 -------------------------------------------------------
    waist_cm: float | None = Field(default=None, gt=40, lt=200)
    smoking_status: SmokingStatus | None = None
    difficulty_walking: bool | None = Field(default=None, description="걷는 데 불편이 있는가")
    alcohol_days_per_year: float | None = Field(default=None, ge=0, le=365)
    moderate_min_per_week: float | None = Field(default=None, ge=0, le=5000)
    vigorous_min_per_week: float | None = Field(default=None, ge=0, le=5000)
    sedentary_min_per_day: float | None = Field(default=None, ge=0, le=1440)
    sleep_hours: float | None = Field(default=None, ge=0, le=24)
    # `veg_fruit_daily` 를 여기서 뺐다. 서빙 번들 20개 어디에도 그 특징이 없어서
    # 받아도 채점에 안 들어갔다 — 켜고 끈 결과 차이가 0.0%p 였다. 물어보면
    # 사용자는 답이 반영된다고 믿는다. 학습 쪽 실험 코드에는 남아 있다
    # (modeling/minimal_features.py 의 후보 목록). 번들에 들어오면 다시 받는다.
    sbp: float | None = Field(default=None, ge=60, le=260, description="수축기 혈압")
    dbp: float | None = Field(default=None, ge=30, le=200, description="이완기 혈압")
    education_level: int | None = Field(default=None, ge=1, le=5, description="1=중학교 미만 ... 5=대졸 이상")

    # --- 검사값 (전부 선택) ------------------------------------------
    #
    # 국가건강검진 결과지에 인쇄되는 항목만 받는다. 채우면 정밀형 모델로,
    # 비우면 일반형으로 채점된다. 질환마다 자기 라벨을 만든 검사값은 그 질환의
    # 입력에서 자동으로 빠진다 — 혈당은 당뇨 모델에, 지질은 이상지질혈증
    # 모델에 들어가지 않는다. 라벨 누출이기 때문이고, 그 판단은 모델 번들의
    # optional_inputs 가 이미 하고 있다.
    fasting_glucose: float | None = Field(default=None, ge=20, le=800, description="공복혈당 mg/dL")
    hba1c: float | None = Field(default=None, ge=2, le=20, description="당화혈색소 %")
    total_chol: float | None = Field(default=None, ge=50, le=600, description="총콜레스테롤 mg/dL")
    hdl: float | None = Field(default=None, ge=5, le=200, description="HDL 콜레스테롤 mg/dL")
    ldl: float | None = Field(default=None, ge=5, le=500, description="LDL 콜레스테롤 mg/dL")
    triglyceride: float | None = Field(default=None, ge=10, le=3000, description="중성지방 mg/dL")
    ast: float | None = Field(default=None, ge=1, le=2000, description="AST(SGOT) IU/L")
    alt: float | None = Field(default=None, ge=1, le=2000, description="ALT(SGPT) IU/L")
    ggt: float | None = Field(default=None, ge=1, le=2000, description="감마지티피 IU/L")
    uric_acid: float | None = Field(default=None, ge=0.5, le=30, description="요산 mg/dL")
    creatinine: float | None = Field(default=None, ge=0.1, le=20, description="혈청 크레아티닌 mg/dL")
    hemoglobin: float | None = Field(default=None, ge=3, le=25, description="혈색소 g/dL")
    albumin: float | None = Field(default=None, ge=1, le=7, description="혈청 알부민 g/dL")
    urine_acr: float | None = Field(default=None, ge=0, le=20000, description="요알부민/크레아티닌비 mg/g")

    # 위 순서를 그대로 to_features 가 쓴다. 모델 입력 이름과 필드명이 같아야
    # 하므로 여기에 항목을 더할 때 이름을 임의로 바꾸면 조용히 무시된다.
    LAB_FIELDS: ClassVar[tuple[str, ...]] = (
        "fasting_glucose",
        "hba1c",
        "total_chol",
        "hdl",
        "ldl",
        "triglyceride",
        "ast",
        "alt",
        "ggt",
        "uric_acid",
        "creatinine",
        "hemoglobin",
        "albumin",
        "urine_acr",
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def bmi(self) -> float:
        return round(self.weight_kg / (self.height_cm / 100) ** 2, 2)

    @property
    def labs_provided(self) -> int:
        return sum(1 for name in self.LAB_FIELDS if getattr(self, name) is not None)

    @model_validator(mode="after")
    def check_blood_pressure(self) -> "RiskPredictionRequest":
        if self.sbp is not None and self.dbp is not None and self.dbp >= self.sbp:
            raise ValueError("이완기 혈압이 수축기 혈압보다 크거나 같습니다. 값을 확인해 주세요.")
        return self

    def to_features(self) -> dict[str, float | str]:
        """모델이 기대하는 이름으로 변환한다. None은 빼서 결측으로 넘긴다."""
        payload: dict[str, float | str] = {
            "age": float(self.age),
            "sex": self.sex,
            "bmi": self.bmi,
            "self_rated_health": float(self.self_rated_health),
        }
        # height_cm 은 BMI 계산에만 쓰던 값인데 허리/키 비율의 분모로도 들어간다.
        payload["height_cm"] = float(self.height_cm)
        optional: dict[str, float | bool | str | None] = {
            "waist_cm": self.waist_cm,
            "smoking_status": self.smoking_status,
            "difficulty_walking": self.difficulty_walking,
            "alcohol_days_per_year": self.alcohol_days_per_year,
            "moderate_min_per_week": self.moderate_min_per_week,
            "vigorous_min_per_week": self.vigorous_min_per_week,
            "sedentary_min_per_day": self.sedentary_min_per_day,
            "sleep_hours": self.sleep_hours,
            "sbp": self.sbp,
            "dbp": self.dbp,
            "education_level": self.education_level,
            **{name: getattr(self, name) for name in self.LAB_FIELDS},
        }
        for name, value in optional.items():
            if value is None:
                continue
            # 불리언은 학습 때 True/False 문자열이 아니라 1/0 수치로 들어갔다.
            payload[name] = float(value) if isinstance(value, (bool, int, float)) else value
        return payload


class RiskFactor(BaseSerializerModel):
    feature: str
    contribution: float = Field(description="로그오즈 기여. 양수면 위험을 올리는 방향")


class RuleAnchor(BaseSerializerModel):
    """이 확률을 받은 사람들을 실제로 검사하면 학회 기준으로 어떻게 나오는가.

    확률 하나만으로는 읽을 수 없다는 문제에 대한 답이다. "고혈압 47%"가 좋은
    건지 나쁜 건지는 유병률을 알아야 판단되는데, 사용자가 그걸 알 리 없다.
    대신 규칙 엔진(국내 학회 임계값)을 같은 사람들에게 돌려서 세어 둔 비율을
    보여준다 — `modeling/engine_agreement.py`.
    """

    society: str = Field(description="임계값을 정한 학회")
    positive_from: str = Field(description="이 등급 이상을 '기준 초과'로 셌다")
    rule_positive_rate: float = Field(description="이 확률대에서 규칙 엔진이 기준 초과를 준 비율")
    overall_rate: float | None = Field(default=None, description="전체 평균 비율. 배수 해석의 분모")
    lift: float | None = Field(default=None, description="전체 평균 대비 배수. 1.0이면 평균과 같다")
    sample: int = Field(description="이 확률 구간에 들어간 사람 수")
    levels: dict[str, float] = Field(default_factory=dict, description="규칙 엔진 5단계 분포")


class CriterionCheck(BaseSerializerModel):
    label: str
    unit: str
    value: float
    threshold: float
    op: str
    met: bool


class ThresholdJudgement(BaseSerializerModel):
    """입력된 검사값을 진단 기준과 직접 대조한 결과.

    이게 있으면 **이쪽이 정본**이다. ML 확률은 검사값 없이 "넘을 가능성"을
    추정하는 값인데, 그 값을 실제로 넣었다면 추정할 이유가 없다. 라벨을 만드는
    검사값은 ML 입력에서 차단돼 있어서 확률은 그 입력에 반응하지도 않는다.
    """

    met: bool = Field(description="기준에 하나라도 해당하는가. '<' 기준은 미만일 때 해당이다")
    checked: list[CriterionCheck]
    source: str = Field(description="임계값 출처 학회")
    definition: str


class MedicalRisk(BaseSerializerModel):
    """의학 기준 등급. 동년배 비교가 아니다.

    만성질환 유병률은 나이를 따라 오르므로, 동년배와 비교하면 70대에서 실제
    위험이 높은 사람도 "동년배 이하"가 된다. 비교는 맞지만 사용자가 읽는 뜻은
    "괜찮다"이고 그건 틀렸다. 그래서 등급은 나이를 나눠 주지 않은 절대 비율,
    곧 "이 점수대의 100명 중 몇 명이 학회 기준을 넘는가"로 정한다.
    """

    level: Literal["낮음", "관심", "주의", "높음"]
    rate: float = Field(description="이 점수대에서 기준을 넘는 비율 0~1")
    basis: str = Field(description="무슨 기준을 넘는다는 뜻인지")
    baseline: float | None = Field(default=None, description="같은 검사를 받은 사람 전체의 비율")
    lift: float | None = Field(default=None, description="전체 대비 배수")
    anchored_on_rule_engine: bool = Field(description="규칙 엔진 판정으로 잰 값인가")


class ModelAccuracy(BaseSerializerModel):
    """이 카드의 숫자를 얼마나 믿어도 되는가.

    AUROC 를 "정확도"라고 부르는 건 엄밀히 틀리다 — 100명 중 몇 명을 맞힌다는
    뜻이 아니라, 위험한 사람과 아닌 사람을 한 명씩 뽑았을 때 위험한 쪽에 더
    높은 점수를 줄 확률이다. 그래서 경보 운영점의 적중률·발견율을 같이 낸다.
    사용자가 실제로 겪는 값은 그쪽이다.
    """

    headline_auroc: float = Field(description="화면에 쓰는 판별력. 미진단자 값이 있으면 그쪽")
    grade: str = Field(description="뛰어남 / 좋음 / 쓸 만함 / 낮음 / 거의 없음")
    measured_on: str = Field(description="미진단자 | 전체")
    auroc: float = Field(description="라벨 전체 기준 AUROC")
    auroc_undiagnosed: float | None = Field(default=None, description="이미 진단받은 양성을 뺀 뒤 다시 잰 값")
    alert_ppv: float | None = Field(default=None, description="상위 10% 경보 시 실제 해당자 비율")
    alert_sensitivity: float | None = Field(default=None, description="상위 10% 경보로 잡아내는 실제 해당자 비율")
    holdout_n: int | None = Field(default=None, description="이 수치를 잰 홀드아웃 인원")
    holdout_cycle: str | None = Field(default=None, description="홀드아웃 주기")


class ConditionRisk(BaseSerializerModel):
    target: str
    description: str
    # 아래 네 개는 다질환 확장에서 들어왔다. 카드가 여러 장이 되면 사용자가
    # "이 숫자는 무슨 기준인가"를 카드마다 물을 수밖에 없다.
    name: str = Field(default="", description="화면에 쓰는 질환 이름")
    tier: Literal["basic", "lab"] = Field(default="basic", description="검사값을 썼는지")
    label_definition: str = Field(default="", description="이 확률이 넘을지 보는 진단 기준 원문")
    threshold_source: str = Field(default="", description="임계값을 가져온 학회·문서")
    probability: float = Field(description="0~1. 이 라벨의 유병률이 높으면 절대값만으로는 해석이 어렵다")
    # 등급의 정본. 화면 배지는 이걸 쓴다.
    medical: MedicalRisk | None = None
    # 검사값을 넣었으면 이쪽이 정본. 확률은 참고로 내려간다.
    judgement: ThresholdJudgement | None = None
    band: Literal["low", "moderate", "high"] = Field(
        description="동일 연령·성별 백분위 기준. 70 미만 low, 70~89 moderate, 90 이상 high. "
        "등급 표시에는 쓰지 않는다 — 나이를 나눠 준 상대 위치라 고령자의 절대 위험을 가린다"
    )
    # 절대 확률만 보여주면 오해가 생긴다. 고혈압 유병률이 42%라 누구나 50% 근처에
    # 앉고, 그 숫자는 "동전 던지기"로 읽히지만 실제 뜻은 "평균 수준"이다.
    peer_group: str = Field(description="비교 집단 표시용 라벨. 예: 50대 남성")
    peer_percentile: float | None = Field(default=None, description="동일 연령·성별 내 백분위 0~100")
    peer_median: float | None = Field(default=None, description="같은 집단의 중간값 확률")
    peer_ratio: float | None = Field(default=None, description="중간값 대비 배수. 1.0이면 평균과 같다")
    alert: bool = Field(description="동일 집단 상위 10% 구간인가")
    model_auroc: float
    accuracy: ModelAccuracy | None = None
    # 규칙 엔진 대조 해석. 규칙 엔진에 대응 영역이 없는 질환(대사증후군·신기능·
    # 지방간·빈혈)에서는 None 이고, 화면은 그때 백분위만 보여준다.
    rule_anchor: RuleAnchor | None = None
    top_factors: list[RiskFactor]


class RiskPredictionData(BaseSerializerModel):
    bmi: float
    conditions: list[ConditionRisk]
    # 화면에 그대로 띄워야 하는 문구. 모델 카드의 한계와 같은 내용이다.
    disclaimers: list[str]
    inputs_provided: int
    inputs_total: int
