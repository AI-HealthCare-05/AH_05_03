from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.dtos.food_nutrition import FoodNutritionSearchResult
from app.dtos.health_assistant import (
    ChatMessage,
    HealthAssistantChatRequest,
    HealthAssistantResponse,
    HealthAssistantScopeDecision,
    HealthIntent,
)
from app.dtos.health_record_query import HealthRecordQueryResult
from app.dtos.medical_facility import FacilitySearchResult
from app.dtos.medication import MedicationSearchResult
from app.dtos.outdoor_conditions import OutdoorConditionsResult
from app.integrations.llm.protocol import LLMClientProtocol
from app.prompts.health_assistant_boundary import build_health_assistant_scope_instruction

HEALTH_ONLY_MESSAGE = (
    "저는 건강 관리를 돕는 건강비서예요. 질병, 증상, 식단, 운동, 의약품, 검사, "
    "의료기관 등 건강과 관련된 질문을 해주세요."
)
SERVICE_USAGE_MESSAGE = (
    "저는 건강 관리를 돕는 건강비서예요. 건강기록 정리와 조회, 식품 영양성분, "
    "의약품 정보, 날씨와 대기질, 의료기관 등 건강과 관련된 질문을 도와드릴 수 있어요."
)
MISSING_EVIDENCE_MESSAGE = (
    "현재 연결된 공식 정보에서 답변 근거를 확인하지 못했습니다. "
    "근거 없이 건강정보를 안내하지 않겠습니다. 질문을 조금 더 구체적으로 작성해 주세요."
)


@dataclass(frozen=True)
class HealthAssistantBoundaryResult:
    request: HealthAssistantChatRequest | None
    decision: HealthAssistantScopeDecision
    response: HealthAssistantResponse | None = None


_SERVICE_USAGE_EXACT = {
    "안녕",
    "안녕하세요",
    "안녕하십니까",
    "하이",
    "헬로",
    "반가워",
    "반가워요",
    "반갑습니다",
    "고마워",
    "고마워요",
    "감사합니다",
    "감사해요",
    "수고해",
    "수고하세요",
    "수고하셨습니다",
    "잘가",
    "잘있어",
    "바이",
    "굿바이",
    "좋은 하루",
    "좋은하루",
    "좋은 아침",
    "좋은아침",
    "사용법",
    "도움말",
    "기능",
    "기능 알려줘",
    "기능이 뭐야",
    "뭘 할 수 있어",
    "뭐 할 수 있어",
    "뭘할수있어",
    "뭐할수있어",
    "어떤 기능이 있어",
    "너 누구야",
    "누구야",
    "너는 누구야",
    "봄이가 뭐야",
    "봄이 기능",
    "테스트",
}

_PROMPT_ATTACK_KEYWORDS = (
    "이전 지침 무시",
    "지침을 무시",
    "시스템 프롬프트",
    "system prompt",
    "ignore previous instructions",
    "jailbreak",
    "탈옥",
)


class HealthAssistantBoundaryService:
    """서비스 범위와 건강정보 근거 사용을 코드에서 강제한다.

    모델은 분류와 표현만 담당한다. 허용되지 않은 주제를 차단하고 공식 도구
    결과가 없는 건강 사실 답변을 폐기하는 결정은 이 서비스가 수행한다.
    """

    @classmethod
    def _fast_path_decision(cls, messages: list[ChatMessage]) -> HealthAssistantScopeDecision | None:  # noqa: C901
        """명확한 패턴의 경우 LLM 호출 없이 0.001초 만에 즉시 판정한다."""
        if not messages:
            return None
        last_msg = ""
        for m in reversed(messages):
            if m.role == "user":
                last_msg = m.content.strip()
                break
        if not last_msg:
            return None

        # 1. 프롬프트 공격 패턴
        compact = last_msg.replace(" ", "")
        if any(k in last_msg or k.replace(" ", "") in compact for k in _PROMPT_ATTACK_KEYWORDS):
            return HealthAssistantScopeDecision(
                scope="prompt_attack",
                requires_authoritative_evidence=False,
            )

        # 2. 명확한 일상 인사 / 사용법 문의
        cleaned = re.sub(r"[!?.~^]+", "", last_msg).strip()
        if cleaned in _SERVICE_USAGE_EXACT or compact in {k.replace(" ", "") for k in _SERVICE_USAGE_EXACT}:
            return HealthAssistantScopeDecision(
                scope="service_usage",
                requires_authoritative_evidence=False,
            )

        # 3. 명확한 건강 기록 입력 (혈압/혈당/복약/운동 수치 등록)
        has_record_keyword = any(
            k in compact
            for k in (
                "측정",
                "기록",
                "저장",
                "입력",
                "쟀어",
                "나왔어",
                "복용완료",
                "먹었어",
                "먹음",
                "챙겨먹",
                "운동했",
                "걸었",
                "달렸",
                "보걸음",
            )
        )
        has_bp_pattern = bool(re.search(r"\b\d{2,3}\s*[/]\s*\d{2,3}\b", last_msg)) or (
            "혈압" in compact and bool(re.search(r"\d{2,3}", compact))
        )
        has_bs_pattern = "혈당" in compact and bool(re.search(r"\d{2,3}", compact))
        has_exercise_pattern = any(k in compact for k in ("걸음", "km", "분운동", "헬스", "스쿼트", "러닝"))
        has_med_taken_pattern = any(k in compact for k in ("약먹었", "약먹음", "복용했", "1알먹", "한알먹", "복용완료"))

        if has_record_keyword and (has_bp_pattern or has_bs_pattern or has_exercise_pattern or has_med_taken_pattern):
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=False,
                required_evidence_types=[],
            )

        # 4. 명확한 단일 도구 질의 (의약품 / 식품 / 시설)
        # 식약처 의약품 / DUR 질의
        if any(
            k in compact for k in ("효능", "부작용", "용법", "용량", "주의사항", "같이먹", "함께먹", "병용")
        ) and any(k in compact for k in ("약", "타이레놀", "아스피린", "노바스크", "이지엔", "판콜", "게보린", "탁센")):
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=True,
                required_evidence_types=["medication"],
            )

        # 식품 영양성분 질의
        if any(k in compact for k in ("칼로리", "열량", "나트륨", "당류", "영양성분")) and any(
            k in compact for k in ("라면", "짜장", "짬뽕", "찌개", "음식", "밥", "고기", "치킨", "피자")
        ):
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=True,
                required_evidence_types=["food_nutrition"],
            )

        # 주변 의료시설 / 응급실 / 약국 질의
        if any(k in compact for k in ("응급실", "병원", "약국", "내과", "이비인후과", "소아과", "정형외과")) and any(
            k in compact for k in ("찾아", "근처", "주변", "어디", "문연", "진료중", "영업중", "위치")
        ):
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=True,
                required_evidence_types=["facility"],
            )

        # 5. 그 외 복잡/혼합/애매한 질문은 LLM 판정기로 위임 (None 반환)
        return None

    async def check_request(
        self,
        llm_client: LLMClientProtocol,
        request: HealthAssistantChatRequest,
    ) -> HealthAssistantBoundaryResult:
        # 1차: 0.001초 초고속 룰 기반 패스트패스 시도
        decision = self._fast_path_decision(request.messages)

        # 2차: 애매한 경우에만 LLM 판정 모델 호출
        if decision is None:
            decision = await llm_client.generate_structured_response(
                system_instruction=build_health_assistant_scope_instruction(),
                messages=request.messages,
                response_schema=HealthAssistantScopeDecision,
            )

        if decision.scope == "service_usage":
            return HealthAssistantBoundaryResult(
                request=None,
                decision=decision,
                response=self._fixed_response(SERVICE_USAGE_MESSAGE),
            )

        if decision.scope in {"out_of_scope", "unrecognized", "prompt_attack"}:
            return HealthAssistantBoundaryResult(
                request=None,
                decision=decision,
                response=self._fixed_response(HEALTH_ONLY_MESSAGE),
            )

        if decision.scope == "mixed":
            allowed = (decision.allowed_health_request or "").strip()
            latest_user_message = self._latest_user_message(request.messages)
            if not allowed or allowed not in latest_user_message:
                return HealthAssistantBoundaryResult(
                    request=None,
                    decision=decision,
                    response=self._fixed_response(HEALTH_ONLY_MESSAGE),
                )
            request = request.model_copy(update={"messages": [ChatMessage(role="user", content=allowed)]})

        return HealthAssistantBoundaryResult(request=request, decision=decision)

    def enforce_grounding(
        self,
        decision: HealthAssistantScopeDecision,
        response: HealthAssistantResponse,
        *,
        tool_result: Any | None,
        outdoor_conditions: OutdoorConditionsResult | None,
    ) -> HealthAssistantResponse:
        """건강 사실·권고가 승인된 근거 없이 사용자에게 나가는 것을 막는다."""
        if response.emergency_notice:
            return response

        requires_evidence = (
            decision.requires_authoritative_evidence
            or response.intent == "health_advice"
            or response.challenge_draft is not None
        )
        if requires_evidence and not self.has_required_evidence(decision, tool_result, outdoor_conditions):
            return self._fixed_response(MISSING_EVIDENCE_MESSAGE, intent="health_advice")
        return response

    @classmethod
    def has_required_evidence(
        cls,
        decision: HealthAssistantScopeDecision,
        tool_result: Any | None,
        outdoor_conditions: OutdoorConditionsResult | None,
    ) -> bool:
        required = set(decision.required_evidence_types)
        if not required:
            return False
        return required.issubset(cls.available_evidence_types(tool_result, outdoor_conditions))

    @classmethod
    def available_evidence_types(
        cls,
        tool_result: Any | None,
        outdoor_conditions: OutdoorConditionsResult | None,
    ) -> set[str]:
        available: set[str] = set()
        if outdoor_conditions and (outdoor_conditions.weather or outdoor_conditions.air_quality):
            available.add("outdoor")
        if isinstance(tool_result, (list, tuple)):
            for item in tool_result:
                available.update(cls.available_evidence_types(item, None))
            return available
        if isinstance(tool_result, FoodNutritionSearchResult):
            if tool_result.items:
                available.add("food_nutrition")
        if isinstance(tool_result, MedicationSearchResult):
            if tool_result.items or tool_result.interaction_items:
                available.add("medication")
        if isinstance(tool_result, FacilitySearchResult):
            available.add("facility")
        if isinstance(tool_result, HealthRecordQueryResult):
            available.add("health_records")
        return available

    @staticmethod
    def _latest_user_message(messages: list[ChatMessage]) -> str:
        for message in reversed(messages):
            if message.role == "user":
                return message.content
        return ""

    @staticmethod
    def _fixed_response(message: str, *, intent: HealthIntent = "general_chat") -> HealthAssistantResponse:
        return HealthAssistantResponse(
            intent=intent,
            assistant_message=message,
            safety_disclaimer=None,
            missing_fields=[],
            suggested_quick_replies=[],
        )
