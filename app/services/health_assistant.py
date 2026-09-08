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
from app.services.medication_client import MedicationClient, MedicationClientProtocol
from app.services.medication_tools import execute_medication_tool, get_medication_tools
from app.services.ocr_partial import PartialJsonTextReader

_MEDICATION_KEYWORDS = (
    "약",
    "약품",
    "약물",
    "복약",
    "복용",
    "부작용",
    "병용",
    "같이 먹",
    "함께 먹",
    "먹어도 돼",
    "먹어도 되",
    "금기",
    "처방",
    "성분",
    "DUR",
    "dur",
    "혈압약",
    "당뇨약",
    "혈당약",
    "타이레놀",
    "판콜",
    "아스피린",
    "노바스크",
    "메트포르민",
    "이지엔",
    "게보린",
)

_FACILITY_KEYWORDS = (
    "응급실",
    "병원",
    "의원",
    "약국",
    "당직의료",
    "당번약국",
    "야간약국",
    "야간진료",
    "응급의료",
    "내과",
    "외과",
    "이비인후과",
    "소아과",
    "소아청소년과",
    "신경과",
    "정신과",
    "정신건강의학과",
    "정형외과",
    "신경외과",
    "성형외과",
    "산부인과",
    "안과",
    "피부과",
    "비뇨의학과",
    "비뇨기과",
    "영상의학과",
    "마취통증의학과",
    "통증의학과",
    "재활의학과",
    "가정의학과",
    "응급의학과",
    "치과",
    "한방",
    "한의원",
    "진료소",
    "보건소",
    "의료원",
    "진료",
    "처방",
    "문 연 곳",
    "문연 곳",
    "어디 가야",
    "어디로 가",
)


class HealthAssistantService:
    """통합 건강 어시스턴트 (봄이) 서비스.

    자연어 입력을 분석하여 건강기록(운동, 혈압, 혈당, 복약, 통증 등) 추출,
    기록 조회 의도 분류, 주변 의료시설(응급실, 병원, 약국) 도구 호출(Tool Calling),
    식약처 의약품 정보·병용금기(DUR) 조회, 안전 가이드라인 기반 상담 응답을 생성합니다.
    """

    def __init__(
        self,
        llm_client: LLMClientProtocol | None = None,
        safety_service: HealthAssistantSafetyService | None = None,
        facility_client: MedicalFacilityClient | None = None,
        record_repo: HealthRecordRepository | None = None,
        medication_client: MedicationClientProtocol | None = None,
    ):
        self._llm_client = llm_client
        self.safety_service = safety_service or HealthAssistantSafetyService()
        self.facility_client = facility_client or MedicalFacilityClient()
        self.record_repo = record_repo
        self.medication_client: MedicationClientProtocol = medication_client or MedicationClient()

    @staticmethod
    def _needs_medication_info(request: HealthAssistantChatRequest) -> bool:
        """의약품 정보·병용금기 조회가 실제로 필요한 질문인지 판별한다.

        병원·약국 찾기 질문은 제외한다 (시설 검색과 의약품 정보는 별개).
        """
        if not request.messages:
            return False
        last_msg = request.messages[-1].content
        # 의약품 키워드가 있어야 한다
        return any(k in last_msg for k in _MEDICATION_KEYWORDS)

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
        # 의약품 툴 먼저 확인
        if name == "search_medication_info":
            return await execute_medication_tool(name, args, self.medication_client)
        return await execute_facility_tool(name, args, self.facility_client)

    def _get_tools(self, request: HealthAssistantChatRequest) -> list[Any]:
        """요청에 필요한 Tool 목록을 반환한다. 불필요한 툴은 포함하지 않는다."""
        tools = list(get_facility_tools())
        if self._needs_medication_info(request):
            tools.extend(get_medication_tools())
        return tools

    async def respond(self, request: HealthAssistantChatRequest) -> HealthAssistantResponse:
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            return safety_check

        profile_context = await self._enrich_context(request.profile_context)
        system_instruction = build_system_instruction(profile_context, request.user_location)

        tools = self._get_tools(request)
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
            if tool_result is not None:
                from app.dtos.medication import MedicationSearchResult

                if isinstance(tool_result, MedicationSearchResult):
                    if not response.medication_search_result:
                        response.medication_search_result = tool_result
                elif not response.facility_search_draft:
                    response.facility_search_draft = tool_result
                    if getattr(tool_result, "message", None):
                        response.assistant_message = tool_result.message
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

        tools = self._get_tools(request)
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
            from app.dtos.medication import MedicationSearchResult

            payload = tool_result.model_dump(mode="json") if hasattr(tool_result, "model_dump") else tool_result
            if isinstance(tool_result, MedicationSearchResult):
                yield "medication", payload
                summary_msg = tool_result.message or "의약품 정보를 조회했습니다."
                yield "delta", {"text": summary_msg}
                res_obj = HealthAssistantResponse(
                    intent="health_advice",
                    assistant_message=summary_msg,
                    medication_search_result=tool_result,
                )
                yield "result", self.safety_service.validate_response(res_obj).model_dump(mode="json")
            else:
                yield "facility", payload
                summary_msg = getattr(tool_result, "message", None) or "주변 의료시설을 조회했습니다."
                yield "delta", {"text": summary_msg}
                res_obj = HealthAssistantResponse(
                    intent="search_facility",
                    assistant_message=summary_msg,
                    facility_search_draft=tool_result,
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
        except Exception as ex:
            raise LlmProviderFailedError(f"응답 구조화 실패: {type(ex).__name__}") from ex

        yield "result", self.safety_service.validate_response(parsed).model_dump(mode="json")
