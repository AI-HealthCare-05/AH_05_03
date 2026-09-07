from collections.abc import AsyncIterator
from typing import Any, cast

from app.dtos.health_assistant import (
    HealthAssistantChatRequest,
    HealthAssistantResponse,
    ProfileContext,
)
from app.exceptions import LlmProviderFailedError
from app.integrations.llm.chain import shared_chat_client
from app.integrations.llm.protocol import LLMClientProtocol
from app.prompts.health_assistant import build_system_instruction
from app.repositories.health_record_repository import HealthRecordRepository
from app.services.health_assistant_safety import HealthAssistantSafetyService
from app.services.medical_facility_client import MedicalFacilityClient
from app.services.medical_facility_tools import (
    execute_facility_tool,
    get_facility_tools,
)
from app.services.ocr_partial import PartialJsonTextReader


class HealthAssistantService:
    """통합 건강 어시스턴트 (봄이) 서비스.

    자연어 입력을 분석하여 건강기록(운동, 혈압, 혈당, 복약, 통증 등) 추출,
    기록 조회 의도 분류, 주변 의료시설(응급실, 병원, 약국) 도구 호출(Tool Calling),
    안전 가이드라인 기반 상담 응답을 생성합니다.
    """

    def __init__(
        self,
        llm_client: LLMClientProtocol | None = None,
        safety_service: HealthAssistantSafetyService | None = None,
        facility_client: MedicalFacilityClient | None = None,
        record_repo: HealthRecordRepository | None = None,
    ):
        self._llm_client = llm_client
        self.safety_service = safety_service or HealthAssistantSafetyService()
        self.facility_client = facility_client or MedicalFacilityClient()
        self.record_repo = record_repo

    async def _enrich_context(self, context: ProfileContext | None) -> ProfileContext | None:
        if context is None or context.recent_records_summary or not context.profile_id or not self.record_repo:
            return context
        try:
            records = await self.record_repo.list_by_profile(context.profile_id, limit=5)
            if records:
                summaries = []
                for r in records:
                    date_str = r.recorded_at.strftime("%Y-%m-%d")
                    summaries.append(f"[{date_str}] {r.record_type}: {r.payload}")
                context.recent_records_summary = "; ".join(summaries)[:2000]
        except Exception:
            pass
        return context

    @property
    def llm_client(self) -> LLMClientProtocol:
        if self._llm_client is None:
            self._llm_client = shared_chat_client()
        return self._llm_client

    async def _execute_tool(self, name: str, args: dict[str, Any]) -> Any:
        return await execute_facility_tool(name, args, self.facility_client)

    async def respond(self, request: HealthAssistantChatRequest) -> HealthAssistantResponse:
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            return safety_check

        profile_context = await self._enrich_context(request.profile_context)
        system_instruction = build_system_instruction(profile_context, request.user_location)

        tools = get_facility_tools()
        response: HealthAssistantResponse
        client_any = cast(Any, self.llm_client)

        if hasattr(client_any, "generate_structured_response_with_tools"):
            res_tuple = await client_any.generate_structured_response_with_tools(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
                tools=tools,
                tool_executor=self._execute_tool,
            )
            response, tool_result = res_tuple
            if tool_result and not response.facility_search_draft:
                response.facility_search_draft = tool_result
                if getattr(tool_result, "message", None):
                    response.assistant_message = tool_result.message
                if getattr(tool_result, "emergency_notice", None) and not response.emergency_notice:
                    response.emergency_notice = tool_result.emergency_notice
        else:
            response = await self.llm_client.generate_structured_response(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
            )

        validated_response = self.safety_service.validate_response(response)
        return validated_response

    async def stream(self, request: HealthAssistantChatRequest) -> AsyncIterator[tuple[str, Any]]:
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            yield "delta", {"text": safety_check.assistant_message}
            yield "result", safety_check.model_dump(mode="json")
            return

        profile_context = await self._enrich_context(request.profile_context)
        system_instruction = build_system_instruction(profile_context, request.user_location)
        reader = PartialJsonTextReader("assistant_message")
        raw = ""
        tool_result = None

        tools = get_facility_tools()
        client_any = cast(Any, self.llm_client)

        if hasattr(client_any, "stream_structured_response_with_tools"):
            stream_gen, tool_result = await client_any.stream_structured_response_with_tools(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
                tools=tools,
                tool_executor=self._execute_tool,
            )
        else:
            stream_gen = self.llm_client.stream_structured_response(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
            )

        if tool_result is not None:
            payload = tool_result.model_dump(mode="json") if hasattr(tool_result, "model_dump") else tool_result
            yield "facility", payload
            summary_msg = getattr(tool_result, "message", None) or "주변 의료시설을 조회했습니다."
            yield "delta", {"text": summary_msg}
            res_obj = HealthAssistantResponse(
                intent="search_facility",
                assistant_message=summary_msg,
                facility_search_draft=tool_result,
                emergency_notice=getattr(tool_result, "emergency_notice", None),
            )
            yield "result", self.safety_service.validate_response(res_obj).model_dump(mode="json")
            return

        async for piece in stream_gen:
            raw += piece
            fresh = reader.push(piece)
            if fresh:
                yield "delta", {"text": fresh}

        try:
            parsed = HealthAssistantResponse.model_validate_json(raw)
            if tool_result and not parsed.facility_search_draft:
                parsed.facility_search_draft = tool_result
                if getattr(tool_result, "emergency_notice", None) and not parsed.emergency_notice:
                    parsed.emergency_notice = tool_result.emergency_notice
        except Exception as ex:
            raise LlmProviderFailedError(f"응답 구조화 실패: {type(ex).__name__}") from ex

        yield "result", self.safety_service.validate_response(parsed).model_dump(mode="json")
