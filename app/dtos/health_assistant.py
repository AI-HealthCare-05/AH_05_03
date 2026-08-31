from typing import Any, Literal
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ProfileContext(BaseModel):
    profile_name: str
    relationship: str | None = None
    birth_year: int | None = None
    recent_records_summary: str | None = None


class ExerciseDraft(BaseModel):
    exercise_name: str = Field(description="운동 종목명 (예: 랫풀다운, 벤치프레스, 스쿼트 등)")
    weight_kg: float | None = Field(default=None, description="중량 (kg)")
    reps: int | None = Field(default=None, description="반복 횟수 (회)")
    sets: int | None = Field(default=None, description="세트 수")
    duration_minutes: int | None = Field(default=None, description="운동 시간 (분)")
    date_str: str | None = Field(default=None, description="운동 일자 (YYYY-MM-DD, 없으면 오늘)")
    note: str | None = Field(default=None, description="추가 특이사항")


class BloodPressureDraft(BaseModel):
    systolic: int | None = Field(default=None, description="수축기 혈압 (mmHg)")
    diastolic: int | None = Field(default=None, description="이완기 혈압 (mmHg)")
    pulse: int | None = Field(default=None, description="맥박수 (bpm)")
    measured_at: str | None = Field(default=None, description="측정 일시 (YYYY-MM-DDTHH:MM)")
    note: str | None = Field(default=None, description="특이사항 메모")


class BloodGlucoseDraft(BaseModel):
    value: float | None = Field(default=None, description="혈당 수치 (mg/dL)")
    timing: Literal["fasting", "before_meal", "after_meal", "bedtime", "random"] | None = Field(
        default=None, description="측정 시점"
    )
    measured_at: str | None = Field(default=None, description="측정 일시 (YYYY-MM-DDTHH:MM)")
    note: str | None = Field(default=None, description="특이사항 메모")


class MedicationDraft(BaseModel):
    medication_name: str = Field(description="약품명 (예: 타이레놀, 혈압약 등)")
    dosage: str | None = Field(default=None, description="복용량 (예: 1정, 500mg)")
    taken_at: str | None = Field(default=None, description="복용 일시 (예: 아침 식후, 2026-08-31T08:30)")
    note: str | None = Field(default=None, description="특이사항 메모")


class PainDraft(BaseModel):
    body_area: str = Field(description="통증 부위 (예: 오른쪽 무릎, 허리, 어깨 등)")
    intensity: int = Field(default=5, description="통증 강도 (0~10)")
    sensation: str | None = Field(default=None, description="통증 양상 (예: 욱신거림, 찌르는 듯함 등)")
    onset_at: str | None = Field(default=None, description="통증 시작 시점")
    note: str | None = Field(default=None, description="추가 메모")


class LabResultDraft(BaseModel):
    screening_name: str | None = Field(default="건강검진", description="검진명 또는 서류명")
    institution: str | None = Field(default=None, description="검사 기관")
    recorded_at: str | None = Field(default=None, description="검사 일자 (YYYY-MM-DD)")
    summary: str | None = Field(default=None, description="검사 결과 핵심 요약")
    items_summary: str | None = Field(default=None, description="주요 검사항목 및 수치 목록")


class QueryDraft(BaseModel):
    record_type: str | None = Field(
        default=None,
        description="조회 대상 기록 종류 (exercise, blood_pressure, blood_glucose, medication, pain, lab_result, health_screening 등)",
    )
    time_range: str | None = Field(
        default=None,
        description="조회 기간 (today, yesterday, this_week, this_month, recent, 8/28 등)",
    )
    keyword: str | None = Field(default=None, description="검색 키워드 (예: 원본, 건강검진 등)")


HealthIntent = Literal[
    "record_exercise",
    "record_blood_pressure",
    "record_blood_glucose",
    "record_medication",
    "record_pain",
    "record_lab_result",
    "query_records",
    "health_advice",
    "general_chat",
    "unknown",
]


class HealthAssistantChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(description="대화 이력 리스트")
    profile_context: ProfileContext | None = Field(
        default=None, description="현재 선택된 가족 구성원의 컨텍스트 정보"
    )


class HealthAssistantResponse(BaseModel):
    intent: HealthIntent = Field(description="사용자의 자연어 의도 분류")
    assistant_message: str = Field(
        description="사용자에게 전달할 정갈하고 친절한 답변 (이모티콘 사용 금지)"
    )
    exercise_draft: ExerciseDraft | None = Field(default=None, description="운동 기록 초안")
    blood_pressure_draft: BloodPressureDraft | None = Field(default=None, description="혈압 기록 초안")
    blood_glucose_draft: BloodGlucoseDraft | None = Field(default=None, description="혈당 기록 초안")
    medication_draft: MedicationDraft | None = Field(default=None, description="복약 기록 초안")
    pain_draft: PainDraft | None = Field(default=None, description="통증 기록 초안")
    lab_result_draft: LabResultDraft | None = Field(default=None, description="검사/검진 서류 결과 초안")
    query_draft: QueryDraft | None = Field(default=None, description="기록 조회 조건 초안")
    missing_fields: list[str] = Field(
        default_factory=list, description="초안 완성을 위해 사용자에게 추가 확인이 필요한 필드 목록"
    )
    needs_confirmation: bool = Field(
        default=False, description="사용자에게 저장 전 확인 카드를 노출해야 하는지 여부"
    )
    suggested_quick_replies: list[str] = Field(
        default_factory=list, description="사용자가 누르기 편한 추천 빠른 답변 목록"
    )
    emergency_notice: str | None = Field(
        default=None, description="응급 증상 감지 시 119 또는 응급실 안내 메시지"
    )
    safety_disclaimer: str | None = Field(
        default="본 서비스는 의료 진단이나 처방을 대신하지 않습니다. 이상 징후가 있을 경우 의료진과 상담하세요.",
        description="비진단 안전 고지문구",
    )

