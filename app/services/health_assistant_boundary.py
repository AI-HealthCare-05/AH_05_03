from __future__ import annotations

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


class HealthAssistantBoundaryService:
    """서비스 범위와 건강정보 근거 사용을 코드에서 강제한다.

    모델은 분류와 표현만 담당한다. 허용되지 않은 주제를 차단하고 공식 도구
    결과가 없는 건강 사실 답변을 폐기하는 결정은 이 서비스가 수행한다.
    """

    async def check_request(
        self,
        llm_client: LLMClientProtocol,
        request: HealthAssistantChatRequest,
    ) -> HealthAssistantBoundaryResult:
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
