import uuid
from collections.abc import AsyncIterator
from typing import Any, cast

from app.dtos.health_assistant import (
    HealthAssistantChatRequest,
    HealthAssistantResponse,
    ProfileContext,
    UserLocation,
)
from app.exceptions import LlmProviderFailedError
from app.integrations.llm.chain import shared_chat_client
from app.integrations.llm.protocol import LLMClientProtocol
from app.models.households import HouseholdStatus
from app.models.service_accounts import ServiceAccount
from app.prompts.health_assistant import build_system_instruction
from app.repositories.chat_session_repository import ChatSessionRepository
from app.repositories.health_record_repository import HealthRecordRepository
from app.repositories.household_repository import HouseholdRepository
from app.repositories.profile_repository import ProfileRepository
from app.services.health_assistant_safety import HealthAssistantSafetyService
from app.services.medical_facility_client import MedicalFacilityClient
from app.services.medical_facility_tools import (
    execute_facility_tool,
    get_facility_tools,
)
from app.services.medication_client import MedicationClient, MedicationClientProtocol
from app.services.medication_tools import execute_medication_tool, get_medication_tools
from app.services.ocr_partial import PartialJsonTextReader
from app.services.outdoor_conditions_client import (
    OutdoorConditionsClient,
    OutdoorConditionsClientProtocol,
    resolve_sido_coordinates,
)
from app.services.outdoor_conditions_tools import execute_outdoor_conditions_tool

_OUTDOOR_ENVIRONMENT_KEYWORDS = ("날씨", "미세먼지", "초미세먼지", "대기질")
_OUTDOOR_ACTIVITY_KEYWORDS = (
    "산책",
    "조깅",
    "러닝",
    "달리기",
    "유산소",
    "자전거",
    "라이딩",
    "걷기",
    "운동추천",
    "운동할",
    "야외",
    "밖에서",
    "외출",
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
)
_FACILITY_SEARCH_KEYWORDS = (
    "찾아",
    "검색",
    "조회",
    "알려",
    "추천",
    "가까운",
    "가까이",
    "근처",
    "주변",
    "위치",
    "어디",
    "문 연",
    "문연",
    "진료 중",
    "진료중",
    "운영 중",
    "운영중",
    "가야",
    "갈 수",
    "전화번호",
    "지도",
)
_FACILITY_HISTORY_OR_ADVICE_KEYWORDS = (
    "다녀",
    "갔다",
    "왔어",
    "받았",
    "진료받",
    "처방받",
    "기록해",
    "복용",
    "먹어도",
    "부작용",
)

_MEDICATION_KEYWORDS = (
    "약",
    "약품",
    "약물",
    "복약",
    "복용",
    "부작용",
    "병용",
    "같이 먹",
    "같이먹",
    "함께 먹",
    "함께먹",
    "먹어도 돼",
    "먹어도돼",
    "먹어도 되",
    "먹어도되",
    "복용해도 돼",
    "복용해도돼",
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
    "탁센",
    "피임약",
    "감기약",
    "소화제",
    "진통제",
    "소염진통제",
    "항생제",
    "위장약",
    "스테로이드",
    "영양제",
    "비타민",
    "마그네슘",
    "오메가",
    "유산균",
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
        chat_session_repo: ChatSessionRepository | None = None,
        outdoor_conditions_client: OutdoorConditionsClientProtocol | None = None,
        medication_client: MedicationClientProtocol | None = None,
        profile_repo: ProfileRepository | None = None,
        household_repo: HouseholdRepository | None = None,
    ):
        self._llm_client = llm_client
        self.safety_service = safety_service or HealthAssistantSafetyService()
        self.facility_client = facility_client or MedicalFacilityClient()
        self.record_repo = record_repo
        self.chat_session_repo = chat_session_repo
        self.outdoor_conditions_client = outdoor_conditions_client or OutdoorConditionsClient()
        self.medication_client: MedicationClientProtocol = medication_client or MedicationClient()
        self.profile_repo = profile_repo
        self.household_repo = household_repo

    @staticmethod
    def _needs_medication_info(request: HealthAssistantChatRequest) -> bool:
        """의약품 정보·병용금기 조회가 실제로 필요한 질문인지 판별한다.

        - 단순 복약 기록 발화("저녁 8시에 타이레놀 1알 복용했어", "혈압약 먹음")는 기록 의도이므로 검색 도구를 부르지 않는다.
        - 효능, 부작용, 복용법, 병용금기 등을 묻는 질문형 발화에만 검색 도구를 활성화한다.
        """
        if not request.messages:
            return False
        last_msg = request.messages[-1].content
        # 1) 의약품 키워드가 반드시 있어야 함
        if not any(k in last_msg for k in _MEDICATION_KEYWORDS):
            return False

        # 2) 병용 가능 여부 질문("같이 먹어도 돼?", "함께 복용해도 되나요?")은 최우선 검색
        compact_msg = last_msg.replace(" ", "")
        is_interaction_question = any(
            k in compact_msg
            for k in (
                "같이",
                "함께",
                "병용",
                "동시에",
                "먹어도돼",
                "먹어도되",
                "복용해도돼",
                "복용해도되",
                "먹어도괜찮",
                "복용해도괜찮",
                "먹어도될까",
                "복용해도될까",
                "먹어도되나요",
                "복용해도되나요",
            )
        )
        if is_interaction_question:
            return True

        # 3) 질문 의도 키워드 또는 물음표가 있는 경우 질문으로 우선 처리
        has_question_intent = any(
            k in last_msg
            for k in (
                "뭐야",
                "무슨 약",
                "어떤 약",
                "어떻게",
                "용법",
                "용량",
                "효능",
                "효과",
                "부작용",
                "주의사항",
                "주의점",
                "성분",
                "금기",
                "상호작용",
                "알려줘",
                "궁금",
                "설명",
                "몇 알",
                "얼마나",
                "언제",
                "되나요",
                "될까",
                "괜찮",
            )
        ) or last_msg.strip().endswith("?")
        if has_question_intent:
            return True

        # 4) 단순 복약 기록 완료형 발화는 검색에서 제외 ("복용했어", "먹었어", "먹음", "1알 복용" 등)
        is_past_record = any(
            suffix in last_msg
            for suffix in (
                "복용했",
                "복용햇",
                "먹었",
                "먹엇",
                "머것",
                "먹음",
                "먹어씀",
                "복용함",
                "투약함",
                "챙겨먹",
                "먹은",
                "복용한",
            )
        )
        if is_past_record:
            return False

        return False

    @staticmethod
    def _needs_facility_tools(request: HealthAssistantChatRequest) -> bool:
        """의료시설 조회 도구가 실제로 필요한 질문인지 판별한다."""
        if not request.messages:
            return False
        last_msg = request.messages[-1].content
        compact_msg = last_msg.replace(" ", "")
        # 날씨나 대기질을 묻는 질문은 의료시설 조회가 아님
        if any(w in last_msg for w in ("날씨", "미세먼지", "초미세먼지", "대기질")):
            return False
        # 단순히 거주지나 위치만 말한 경우("난 서울살아", "종로구에 있어")도 시설 조회가 아님
        if any(last_msg.strip().endswith(suffix) for suffix in ("살아", "살아요", "있어", "있어요")) and not any(
            k in last_msg for k in ("병원", "약국", "응급실", "의원")
        ):
            return False
        has_facility = any(k in last_msg for k in _FACILITY_KEYWORDS)
        has_search_intent = any(k in last_msg for k in _FACILITY_SEARCH_KEYWORDS)
        if has_facility and has_search_intent:
            return True
        # "강남응급실", "서울 내과"처럼 짧은 검색어만 입력한 경우는 허용하되,
        # 과거 진료·복약 상담 문장은 시설 검색으로 오인하지 않는다.
        if (
            has_facility
            and len(compact_msg) <= 15
            and not any(k in last_msg for k in _FACILITY_HISTORY_OR_ADVICE_KEYWORDS)
        ):
            return True
        if any(k in last_msg for k in ("어디 가야", "어디로 가")):
            return True
        # 이전 어시스턴트 메시지가 시설 위치를 되묻던 상황인지 확인
        if len(request.messages) >= 2:
            prev_msg = request.messages[-2]
            if prev_msg.role == "assistant" and any(
                k in prev_msg.content for k in ("가까운 병원이나 약국", "의료시설", "찾으시는 지역명")
            ):
                return True
        return False

    async def _resolve_request_location(self, request: HealthAssistantChatRequest) -> UserLocation | None:
        """동의된 좌표를 우선하고, 야외 질문의 사용자 장소명만 보조적으로 좌표화한다."""
        loc = request.location
        if loc is not None:
            return loc

        recent_user_messages = [message for message in request.messages[-3:] if message.role == "user"]
        for message in reversed(recent_user_messages):
            resolved = resolve_sido_coordinates(message.content)
            if resolved:
                sido, lat, lon = resolved
                return UserLocation(
                    latitude=lat,
                    longitude=lon,
                    address=f"{sido}특별시" if sido == "서울" else sido,
                )

        if self._needs_outdoor_conditions(request):
            for message in reversed(recent_user_messages):
                resolved_place = await self.outdoor_conditions_client.resolve_location(message.content)
                if resolved_place:
                    lat, lon, address = resolved_place
                    return UserLocation(latitude=lat, longitude=lon, address=address)
        return None

    @staticmethod
    def _needs_outdoor_conditions(request: HealthAssistantChatRequest) -> bool:
        """실시간 API가 필요한 질문만 판별한다.

        모든 대화에 외부 API를 호출하면 느려지고 할당량을 낭비한다. 이 라우팅은
        도구의 호출 조건만 정하며, 최종 건강 안내 문장은 모델의 안전 지침을 거친다.
        """
        if not request.messages:
            return False
        message = request.messages[-1].content.replace(" ", "")
        if any(keyword in message for keyword in _OUTDOOR_ENVIRONMENT_KEYWORDS):
            return True
        if any(
            keyword in message
            for keyword in ("했어", "완료", "기록해", "기록할", "기록하기", "달렸어", "뛰었어", "걸었어", "탔어")
        ):
            return False
        if any(keyword in message for keyword in _OUTDOOR_ACTIVITY_KEYWORDS) or (
            "운동" in message and any(k in message for k in ("추천", "할까", "할건", "할거", "예정", "계획", "뭐"))
        ):
            return True
        # 이전 턴에서 위치 미확인으로 날씨 조회를 못했을 때 사용자가 거주지/지역명을 답변한 경우
        if len(request.messages) >= 2:
            prev_msg = request.messages[-2]
            if prev_msg.role == "assistant" and any(
                k in prev_msg.content for k in ("실시간 날씨", "날씨와 대기질", "외출 전 기온", "날씨를 확인")
            ):
                if resolve_sido_coordinates(message) is not None or "살아" in message:
                    return True
        return False

    async def _load_outdoor_conditions(self, request: HealthAssistantChatRequest, loc: UserLocation | None):
        if not self._needs_outdoor_conditions(request) or loc is None:
            return None
        return await execute_outdoor_conditions_tool(
            "get_outdoor_health_conditions",
            {
                "latitude": loc.latitude,
                "longitude": loc.longitude,
            },
            self.outdoor_conditions_client,
        )

    @staticmethod
    def _temperature_risk(temperature_c: float | None) -> tuple[str | None, str | None]:
        if temperature_c is None:
            return None, None
        if temperature_c >= 33:
            return "폭염 수준 고온", None
        if temperature_c <= -10:
            return "한파 수준 저온", None
        if temperature_c >= 30:
            return None, "높은 기온"
        if temperature_c <= 0:
            return None, "낮은 기온"
        return None, None

    @staticmethod
    def _classify_weather_risks(weather: Any) -> tuple[list[str], list[str]]:
        unsafe_reasons: list[str] = []
        caution_reasons: list[str] = []
        if weather.precipitation_type and weather.precipitation_type != "강수 없음":
            unsafe_reasons.append("비/강수")
        unsafe_temperature, caution_temperature = HealthAssistantService._temperature_risk(weather.temperature_c)
        if unsafe_temperature:
            unsafe_reasons.append(unsafe_temperature)
        if caution_temperature:
            caution_reasons.append(caution_temperature)
        if weather.wind_speed_mps is not None:
            if weather.wind_speed_mps >= 14:
                unsafe_reasons.append("강풍")
            elif weather.wind_speed_mps >= 9:
                caution_reasons.append("강한 바람")
        if (
            weather.temperature_c is not None
            and weather.temperature_c >= 28
            and weather.humidity_percent is not None
            and weather.humidity_percent >= 80
        ):
            caution_reasons.append("고온다습")
        return unsafe_reasons, caution_reasons

    @staticmethod
    def _format_outdoor_conditions_context(result: Any | None, location_available: bool) -> str | None:
        if result is None:
            return (
                "현재 위치가 제공되지 않아 실시간 날씨·대기질을 조회하지 못했습니다."
                if not location_available
                else None
            )

        lines: list[str] = []
        unsafe_reasons: list[str] = []
        caution_reasons: list[str] = []
        if result.weather:
            weather = result.weather
            weather_unsafe, weather_caution = HealthAssistantService._classify_weather_risks(weather)
            unsafe_reasons.extend(weather_unsafe)
            caution_reasons.extend(weather_caution)
            lines.append(
                "날씨: "
                f"기온 {weather.temperature_c if weather.temperature_c is not None else '확인 불가'}℃, "
                f"습도 {weather.humidity_percent if weather.humidity_percent is not None else '확인 불가'}%, "
                f"강수 {weather.precipitation_type}, "
                f"풍속 {weather.wind_speed_mps if weather.wind_speed_mps is not None else '확인 불가'}m/s"
            )
        if result.air_quality:
            air = result.air_quality
            bad_air = bool(
                (air.pm10_grade in ("나쁨", "매우 나쁨", "매우나쁨"))
                or (air.pm25_grade in ("나쁨", "매우 나쁨", "매우나쁨"))
            )
            if bad_air:
                unsafe_reasons.append("미세먼지 나쁨")
            lines.append(
                "대기질: "
                f"{air.region_name} {air.station_name or '측정소'}, "
                f"PM10 {air.pm10 if air.pm10 is not None else '확인 불가'}㎍/㎥({air.pm10_grade or '등급 확인 불가'}), "
                f"PM2.5 {air.pm25 if air.pm25 is not None else '확인 불가'}㎍/㎥({air.pm25_grade or '등급 확인 불가'})"
            )
        if unsafe_reasons:
            lines.append(
                f"환경 종합 평가: 야외 활동 비권장 ({', '.join(unsafe_reasons)} - 야외 유산소 대신 실내 운동 추천 필요)"
            )
        elif caution_reasons:
            lines.append(
                f"환경 종합 평가: 야외 활동 주의 필요 ({', '.join(caution_reasons)} - "
                "운동 강도와 시간을 낮추고 수분 섭취 및 컨디션 확인 필요)"
            )
        elif result.weather and result.air_quality:
            lines.append("환경 종합 평가: 야외 활동 적합 (쾌적한 환경 - 가벼운 산책이나 야외 러닝 적극 추천 가능)")

        if result.errors:
            lines.append("일부 조회 실패: " + "; ".join(result.errors))
        return "\n".join(lines) or "실시간 야외 환경 정보를 불러오지 못했습니다."

    @staticmethod
    def _parse_profile_id(raw: str | uuid.UUID | None) -> uuid.UUID | None:
        if isinstance(raw, uuid.UUID):
            return raw
        if isinstance(raw, str):
            try:
                return uuid.UUID(raw)
            except ValueError:
                return None
        return None

    async def _has_profile_access(self, profile_id: uuid.UUID, account_id: uuid.UUID) -> bool:
        """현재 계정(account_id)이 대상 프로필(profile_id)의 활성 가구 구성원인지 검증한다."""
        if not self.profile_repo or not self.household_repo:
            return False
        try:
            profile = await self.profile_repo.get(profile_id)
            if profile is None or profile.status != "active":
                return False
            household = await self.household_repo.get(profile.household_id)
            if household is None or household.status != HouseholdStatus.ACTIVE:
                return False
            return await self.household_repo.has_active_membership(profile.household_id, account_id)
        except Exception:
            return False

    async def _enrich_records_summary(
        self,
        context: ProfileContext,
        account_id: uuid.UUID | None,
    ) -> None:
        if context.recent_records_summary or not context.profile_id or not self.record_repo or not account_id:
            return
        profile_id = self._parse_profile_id(context.profile_id)
        if profile_id is None or not await self._has_profile_access(profile_id, account_id):
            return

        try:
            records = await self.record_repo.list_by_profile(profile_id, limit=5)
            if records:
                summaries = []
                for r in records:
                    date_str = r.recorded_at.strftime("%Y-%m-%d")
                    if r.record_type == "pain" and isinstance(r.payload, dict):
                        anatomy = r.payload.get("anatomyEvent")
                        if isinstance(anatomy, dict):
                            concept = anatomy.get("concept", {})
                            body = anatomy.get("body", {})
                            coverage = anatomy.get("coverage", {})
                            label = concept.get("label") or concept.get("id") or "지정 부위"
                            side = body.get("side")
                            region = body.get("region")
                            side_kr = {"left": "왼쪽", "right": "오른쪽", "bilateral": "양쪽"}.get(side, side or "")
                            side_desc = f"{side_kr} {region}".strip() if side_kr or region else ""
                            area_part = f"{label}({side_desc})" if side_desc else label
                            rad = coverage.get("radius")
                            cov_part = f", 확산범위 {rad}mm" if rad is not None else ""
                            note_part = r.payload.get("note") or r.payload.get("sensation") or ""
                            desc = f": {note_part}" if note_part else ""
                            summaries.append(f"[{date_str}] 통증[3D해부학: {area_part}{cov_part}]{desc}")
                            continue
                    summaries.append(f"[{date_str}] {r.record_type}: {r.payload}")
                context.recent_records_summary = "; ".join(summaries)[:2000]
        except Exception:
            pass

    async def _build_past_sessions_summary(self, sessions: list[Any]) -> str:
        if not self.chat_session_repo:
            return ""
        session_summaries: list[str] = []
        for s in sessions:
            msgs = await self.chat_session_repo.list_messages(s.id, limit=6)
            if msgs:
                msg_lines = [
                    f"  * {'사용자' if m.role == 'user' else '봄이'}: {m.content[:120].replace(chr(10), ' ')}"
                    for m in msgs
                ]
                session_summaries.append(f"- 세션 '{s.title or '이전 대화'}':\n" + "\n".join(msg_lines))
        return "\n".join(session_summaries)

    async def _enrich_cross_session_summary(
        self,
        context: ProfileContext,
        account_id: uuid.UUID | None,
        current_session_id: uuid.UUID | None,
    ) -> None:
        if (
            context.previous_conversations_summary
            or not context.profile_id
            or not self.chat_session_repo
            or not account_id
        ):
            return
        profile_id = self._parse_profile_id(context.profile_id)
        if profile_id is not None and not await self._has_profile_access(profile_id, account_id):
            return

        try:
            sessions = await self.chat_session_repo.list_sessions(
                account_id=account_id, profile_id=str(context.profile_id), limit=6
            )
            past_sessions = [s for s in sessions if s.id != current_session_id][:3]
            if not past_sessions:
                return
            summaries = await self._build_past_sessions_summary(past_sessions)
            if summaries:
                context.previous_conversations_summary = summaries[:2500]
        except Exception:
            pass

    async def _enrich_context(
        self,
        context: ProfileContext | None,
        account_id: uuid.UUID | None = None,
        current_session_id: uuid.UUID | None = None,
    ) -> ProfileContext | None:
        if context is None:
            return None
        await self._enrich_records_summary(context, account_id=account_id)
        await self._enrich_cross_session_summary(context, account_id, current_session_id)
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

    def _get_tools(self, request: HealthAssistantChatRequest) -> list[Any] | None:
        """요청에 필요한 Tool 목록을 반환한다. 불필요한 툴은 포함하지 않는다."""
        tools: list[Any] = []
        if self._needs_facility_tools(request):
            tools.extend(get_facility_tools())
        if self._needs_medication_info(request):
            tools.extend(get_medication_tools())
        return tools if tools else None

    async def respond(
        self,
        request: HealthAssistantChatRequest,
        account: ServiceAccount | None = None,
    ) -> HealthAssistantResponse:
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            return safety_check

        account_id = account.id if account else None
        profile_context = await self._enrich_context(
            request.profile_context,
            account_id=account_id,
            current_session_id=request.session_id,
        )
        loc = await self._resolve_request_location(request)
        outdoor_conditions = await self._load_outdoor_conditions(request, loc)
        system_instruction = build_system_instruction(
            profile_context,
            user_location=loc,
            outdoor_conditions_context=self._format_outdoor_conditions_context(outdoor_conditions, loc is not None)
            if self._needs_outdoor_conditions(request)
            else None,
        )

        tools = self._get_tools(request)
        response: HealthAssistantResponse
        client_any = cast(Any, self.llm_client)

        if tools and hasattr(client_any, "generate_structured_response_with_tools"):
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

        if outdoor_conditions and not response.outdoor_conditions:
            response.outdoor_conditions = outdoor_conditions
        validated_response = self.safety_service.validate_response(response)
        return validated_response

    async def _get_stream_generator(
        self,
        request: HealthAssistantChatRequest,
        system_instruction: str,
        tools: list[Any] | None,
    ) -> tuple[AsyncIterator[str], Any]:
        client_any = cast(Any, self.llm_client)
        if tools and hasattr(client_any, "stream_structured_response_with_tools"):
            return await client_any.stream_structured_response_with_tools(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
                tools=tools,
                tool_executor=self._execute_tool,
            )
        return (
            self.llm_client.stream_structured_response(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
            ),
            None,
        )

    @staticmethod
    def _enrich_parsed_response(
        parsed: HealthAssistantResponse,
        tool_result: Any,
        outdoor_conditions: Any,
    ) -> HealthAssistantResponse:
        if tool_result:
            from app.dtos.medication import MedicationSearchResult

            if isinstance(tool_result, MedicationSearchResult):
                if not parsed.medication_search_result:
                    parsed.medication_search_result = tool_result
            elif not parsed.facility_search_draft:
                parsed.facility_search_draft = tool_result
        if outdoor_conditions and not parsed.outdoor_conditions:
            parsed.outdoor_conditions = outdoor_conditions
        return parsed

    async def stream(
        self,
        request: HealthAssistantChatRequest,
        account: ServiceAccount | None = None,
    ) -> AsyncIterator[tuple[str, Any]]:
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            yield "delta", {"text": safety_check.assistant_message}
            yield "result", safety_check.model_dump(mode="json")
            return

        account_id = account.id if account else None
        profile_context = await self._enrich_context(
            request.profile_context,
            account_id=account_id,
            current_session_id=request.session_id,
        )
        loc = await self._resolve_request_location(request)
        outdoor_conditions = await self._load_outdoor_conditions(request, loc)
        system_instruction = build_system_instruction(
            profile_context,
            user_location=loc,
            outdoor_conditions_context=self._format_outdoor_conditions_context(outdoor_conditions, loc is not None)
            if self._needs_outdoor_conditions(request)
            else None,
        )
        reader = PartialJsonTextReader("assistant_message")
        raw = ""

        tools = self._get_tools(request)
        stream_gen, tool_result = await self._get_stream_generator(request, system_instruction, tools)

        if tool_result is not None:
            from app.dtos.medication import MedicationSearchResult

            payload = tool_result.model_dump(mode="json") if hasattr(tool_result, "model_dump") else tool_result
            if isinstance(tool_result, MedicationSearchResult):
                yield "medication", payload
            else:
                yield "facility", payload
                summary_msg = getattr(tool_result, "message", None) or "주변 의료시설을 조회했습니다."
                yield "delta", {"text": summary_msg}
                res_obj = HealthAssistantResponse(
                    intent="search_facility",
                    assistant_message=summary_msg,
                    facility_search_draft=tool_result,
                    outdoor_conditions=outdoor_conditions,
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
            parsed = self._enrich_parsed_response(parsed, tool_result, outdoor_conditions)
        except Exception as ex:
            raise LlmProviderFailedError(f"응답 구조화 실패: {type(ex).__name__}") from ex

        yield "result", self.safety_service.validate_response(parsed).model_dump(mode="json")
