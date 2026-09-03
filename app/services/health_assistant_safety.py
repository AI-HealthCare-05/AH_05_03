from app.dtos.health_assistant import ChatMessage, HealthAssistantResponse


class HealthAssistantSafetyService:
    """응급 감지 및 안전 수칙 검증 서비스"""

    @staticmethod
    def check_input_safety(messages: list[ChatMessage]) -> HealthAssistantResponse | None:
        """사용자 입력 메시지에 응급 키워드가 있는지 사전 검사합니다."""
        if not messages:
            return None

        last_message = messages[-1].content
        emergency_keywords = [
            "가슴이 쥐어짜듯",
            "심한 흉통",
            "호흡곤란",
            "호흡 곤란",
            "숨쉬기 힘들어",
            "의식 저하",
            "마비",
            "심한 출혈",
        ]

        for keyword in emergency_keywords:
            if keyword in last_message:
                return HealthAssistantResponse(
                    intent="health_advice",
                    assistant_message="입력하신 증상은 응급 상황일 가능성이 높습니다. 지체하지 마시고 즉시 119에 연락하거나 가까운 응급실을 방문하세요.",
                    emergency_notice="응급 상황 가능성이 높습니다. 즉시 119에 도움을 요청하세요.",
                    safety_disclaimer="본 서비스는 의료 진단이나 처방을 대신하지 않습니다. 이상 징후가 있을 경우 의료진과 상담하세요.",
                    missing_fields=[],
                    suggested_quick_replies=[],
                )

        return None

    @staticmethod
    def validate_response(response: HealthAssistantResponse) -> HealthAssistantResponse:
        """LLM 응답의 안전성을 검증하고 필요한 경우 안전 고지를 추가합니다."""

        if response.emergency_notice:
            # 응급 상황 시 확인 카드 등 부가 동작 차단
            response.needs_confirmation = False
            response.auto_save = False
            response.missing_fields = []
            response.suggested_quick_replies = []

            # 모든 초안(Draft) 제거
            response.exercise_draft = None
            response.blood_pressure_draft = None
            response.blood_glucose_draft = None
            response.medication_draft = None
            response.pain_draft = None
            response.lab_result_draft = None

            # 응급 고지가 누락된 경우 기본 고지문 추가
            if not response.safety_disclaimer:
                response.safety_disclaimer = "본 서비스는 의료 진단이나 처방을 대신하지 않습니다. 이상 징후가 있을 경우 즉시 의료진과 상담하세요."

        return response
