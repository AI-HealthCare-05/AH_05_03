import logging
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast

import httpx

from app.dtos.health_assistant import (
    HealthAssistantChatRequest,
    HealthAssistantLlmResponse,
    HealthAssistantResponse,
    HealthAssistantScopeDecision,
    ProfileContext,
    UserLocation,
)
from app.dtos.health_record_query import AlcoholConsultationSnapshot
from app.dtos.outdoor_conditions import OutdoorConditionsResult
from app.exceptions import LlmProviderFailedError
from app.integrations.llm.chain import shared_chat_client, shared_classifier_client
from app.integrations.llm.protocol import LLMClientProtocol
from app.models.households import HouseholdStatus
from app.models.service_accounts import ServiceAccount
from app.prompts.health_assistant import build_system_instruction
from app.repositories.chat_session_repository import ChatSessionRepository
from app.repositories.health_record_repository import HealthRecordRepository
from app.repositories.household_repository import HouseholdRepository
from app.repositories.profile_repository import ProfileRepository
from app.services.facility_topic import (
    FACILITY_HISTORY_OR_ADVICE_KEYWORDS,
    FACILITY_KEYWORDS,
    FACILITY_SEARCH_KEYWORDS,
    is_facility_location_followup,
)
from app.services.food_nutrition_client import (
    FoodNutritionClient,
    FoodNutritionClientProtocol,
)
from app.services.food_nutrition_tools import (
    execute_food_nutrition_tool,
    get_food_nutrition_tools,
)
from app.services.health_assistant_boundary import (
    _MEDICAL_EVIDENCE_TYPES,
    HealthAssistantBoundaryService,
)
from app.services.health_assistant_safety import HealthAssistantSafetyService
from app.services.health_knowledge_catalog import HealthKnowledgeClientProtocol, is_alcohol_topic
from app.services.health_knowledge_query import normalize_knowledge_query
from app.services.health_record_tools import (
    QUERY_HEALTH_RECORDS_TOOL_NAME,
    execute_health_record_tool,
    get_health_record_tools,
)
from app.services.health_records import HealthRecordService
from app.services.kdca_health_info_client import KdcaHealthInfoClient
from app.services.medical_facility_client import MedicalFacilityClient
from app.services.medical_facility_tools import (
    execute_facility_tool,
    get_facility_tools,
)
from app.services.medication_client import MedicationClient, MedicationClientProtocol
from app.services.medication_tools import execute_medication_tool, get_medication_tools
from app.services.medication_topic import mentions_medication
from app.services.outdoor_conditions_client import (
    OutdoorConditionsClient,
    OutdoorConditionsClientProtocol,
    resolve_sido_coordinates,
)
from app.services.outdoor_conditions_tools import execute_outdoor_conditions_tool

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _PreparedExecution:
    request: HealthAssistantChatRequest
    decision: HealthAssistantScopeDecision
    profile_context: ProfileContext | None
    preloaded_results: list[Any]
    outdoor_conditions: OutdoorConditionsResult | None
    system_instruction: str
    tools: list[Any] | None


#: 봄이가 먼저 "0~10점 중 몇 점인가요?" 라고 물으면 사용자는 보통 `2` 처럼 숫자만
#: 답한다. 그 답은 `강도 2` 와 달리 위 패턴에 걸리지 않아, 묻고서 받은 답을 도로
#: 버렸다 — 화면에는 "강도 2를 저장했습니다" 가 뜨는데 슬라이더는 비어 있었다
#: (2026-09-16). 질문이 앞에 있었는지까지 보면 맨 숫자도 명시한 값이다.
_PAIN_INTENSITY_QUESTION_PATTERN = re.compile(r"(?:강도|세기)[^?]{0,30}?(?:몇|점|0\s*[~-]\s*10)")
_BARE_INTENSITY_ANSWER_PATTERN = re.compile(r"^\D{0,4}(?:10|[0-9])\D{0,4}$")


_EXPLICIT_PAIN_INTENSITY_PATTERN = re.compile(
    r"(?:통증\s*(?:을|은|이|도)?\s*)?(?:강도|세기)\s*(?:는|가)?\s*(?:약\s*)?(?:10|[0-9])(?:\s*(?:점|정도|/\s*10))?"
    r"|통증\s*(?:을|은|이|도)?\s*(?:10|[0-9])(?=\s*(?:점|정도|라?고|이야|입니다|$))"
    r"|(?<!\d)(?:10|[0-9])\s*(?:점|/\s*10)(?!\d)"
)

_SUPPLEMENT_DISCLAIMER = "영양제 섭취는 담당 의료진이나 전문의와 상의를 먼저 하신 후 복용을 권장드립니다."
_SUPPLEMENT_TOPIC_KEYWORDS = (
    "영양제",
    "건강기능식품",
    "보충제",
    "비타민",
    "미네랄",
    "오메가3",
    "유산균",
    "홍삼",
    "마그네슘",
)

_FOOD_NUTRITION_KEYWORDS = (
    "칼로리",
    "열량",
    "나트륨",
    "당류",
    "당분",
    "설탕",
    "탄수화물",
    "단백질",
    "지방",
    "영양성분",
    "영양정보",
    "영양소",
    "성분표",
    "몇칼로리",
    "얼마나들어",
)

_FOOD_EATING_QUERY_KEYWORDS = (
    "먹어도돼",
    "먹어도되",
    "먹어도될까",
    "먹어도괜찮",
    "먹어도되나요",
    "먹어도될까요",
    "먹어도됨",
    "먹을까",
    "먹어도",
    "섭취해도돼",
    "섭취해도되",
    "마셔도돼",
    "마셔도되",
)

_COMMON_FOOD_NAMES = (
    "라면",
    "신라면",
    "진라면",
    "짜장면",
    "자장면",
    "짬뽕",
    "김밥",
    "떡볶이",
    "순대",
    "튀김",
    "찌개",
    "김치찌개",
    "된장찌개",
    "순두부",
    "삼겹살",
    "제육",
    "불고기",
    "치킨",
    "피자",
    "햄버거",
    "돈까스",
    "돈가스",
    "냉면",
    "칼국수",
    "바나나",
    "사과",
    "고구마",
    "감자",
    "계란",
    "달걀",
    "우유",
    "콜라",
    "사이다",
    "커피",
    "라떼",
    "소주",
    "맥주",
    "음식",
    "식단",
    "야식",
    "간식",
)


class HealthAssistantService:
    """통합 건강 어시스턴트 (봄이) 서비스.

    자연어 입력을 분석하여 건강기록(운동, 혈압, 혈당, 복약, 통증 등) 추출,
    기록 조회 의도 분류, 주변 의료시설(응급실, 병원, 약국) 도구 호출(Tool Calling),
    식약처 의약품 정보·DUR 품목정보 및 식품영양성분(칼로리/나트륨/당류) 조회,
    안전 가이드라인 기반 상담 응답을 생성합니다.
    """

    def __init__(
        self,
        llm_client: LLMClientProtocol | None = None,
        classifier_llm_client: LLMClientProtocol | None = None,
        safety_service: HealthAssistantSafetyService | None = None,
        boundary_service: HealthAssistantBoundaryService | None = None,
        facility_client: MedicalFacilityClient | None = None,
        record_repo: HealthRecordRepository | None = None,
        chat_session_repo: ChatSessionRepository | None = None,
        outdoor_conditions_client: OutdoorConditionsClientProtocol | None = None,
        medication_client: MedicationClientProtocol | None = None,
        food_nutrition_client: FoodNutritionClientProtocol | None = None,
        health_knowledge_client: HealthKnowledgeClientProtocol | None = None,
        profile_repo: ProfileRepository | None = None,
        household_repo: HouseholdRepository | None = None,
        health_record_service: HealthRecordService | None = None,
    ):
        self._llm_client = llm_client
        self._classifier_llm_client = classifier_llm_client
        self.safety_service = safety_service or HealthAssistantSafetyService()
        self.boundary_service = boundary_service or HealthAssistantBoundaryService()
        self.facility_client = facility_client or MedicalFacilityClient()
        self.health_record_service = health_record_service
        self.record_repo = record_repo or getattr(health_record_service, "record_repo", None)
        self.chat_session_repo = chat_session_repo
        self.outdoor_conditions_client = outdoor_conditions_client or OutdoorConditionsClient()
        self.medication_client: MedicationClientProtocol = medication_client or MedicationClient()
        self.food_nutrition_client: FoodNutritionClientProtocol = food_nutrition_client or FoodNutritionClient()
        self.health_knowledge_client: HealthKnowledgeClientProtocol = health_knowledge_client or KdcaHealthInfoClient()
        self.profile_repo = profile_repo
        self.household_repo = household_repo

    @staticmethod
    def _get_eval_text(request: HealthAssistantChatRequest) -> str:
        if not request.messages:
            return ""
        base = request.messages[-1].content
        if request.enriched_query:
            return f"{base} {request.enriched_query}"
        return base

    @classmethod
    def _needs_food_nutrition(cls, request: HealthAssistantChatRequest) -> bool:
        """음식 영양성분(칼로리, 나트륨, 당류 등) 조회가 필요한 질문인지 판별한다."""
        if not request.messages:
            return False
        last_msg = cls._get_eval_text(request)
        compact_msg = last_msg.replace(" ", "")

        # 1) 명시적 영양성분 키워드가 포함된 경우 우선 처리
        if any(k in compact_msg for k in _FOOD_NUTRITION_KEYWORDS):
            return True

        # 2) 의약품 전용 명칭이 포함된 복약 질문인 경우 제외
        explicit_drug_terms = (
            "약",
            "약품",
            "약물",
            "복약",
            "복용",
            "처방",
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
        )
        if any(k in last_msg for k in explicit_drug_terms):
            return False

        # 3) 음식 섭취 가능 여부 질문
        has_eating_query = any(k in compact_msg for k in _FOOD_EATING_QUERY_KEYWORDS)
        has_food_term = any(k in last_msg for k in _COMMON_FOOD_NAMES) or any(
            k in compact_msg for k in ("밥", "국", "탕", "찌개", "면", "고기", "과일")
        )
        if has_eating_query and has_food_term:
            return True

        return False

    @staticmethod
    def _needs_health_record_query_tool(request: HealthAssistantChatRequest) -> bool:
        """1차 수직 슬라이스인 기간별 혈압 기준 초과 일수 질문만 연다."""
        if not request.messages:
            return False
        message = request.messages[-1].content.replace(" ", "")
        has_period = re.search(r"(?<!\d)(?:[1-9]|1[0-2])개월", message) is not None
        has_threshold = any(word in message for word in ("넘", "초과", "이상"))
        has_day_count = any(word in message for word in ("며칠", "몇일", "몇번", "몇회", "날이", "날은"))
        return "혈압" in message and has_period and has_threshold and has_day_count

    @staticmethod
    def _needs_personal_record_evidence(
        request: HealthAssistantChatRequest,
        decision: HealthAssistantScopeDecision,
    ) -> bool:
        """개인 건강기록 스냅샷 조회 전에 프로필 선택을 요구할지 판단한다.

        바운더리(fast-path 또는 LLM 판정기)가 이미 health_records 근거가
        필요하다고 판단했고, 그 주제가 음주(현재 유일하게 개인기록 스냅샷이
        구현된 주제)일 때만 프로필이 필요하다."""
        if "health_records" not in decision.required_evidence_types:
            return False
        if not request.messages:
            return False
        return is_alcohol_topic(request.messages[-1].content)

    async def _fetch_alcohol_snapshot(
        self,
        *,
        account: ServiceAccount | None,
        profile_context: ProfileContext | None,
    ) -> AlcoholConsultationSnapshot:
        """음주 상담용 개인 건강기록 스냅샷을 조회한다. 조회 실패·데이터 없음도 정직하게 반환한다."""
        snapshot: AlcoholConsultationSnapshot | None = None
        if account is not None and profile_context is not None and self.health_record_service is not None:
            profile_id = self._parse_profile_id(profile_context.profile_id)
            if profile_id is not None:
                try:
                    snapshot = await self.health_record_service.get_alcohol_consultation_snapshot(account, profile_id)
                except Exception as ex:
                    logger.warning("음주 상담 스냅샷 조회 실패: %s", ex)

        if snapshot is None:
            snapshot = AlcoholConsultationSnapshot(
                message="현재 프로필에서 음주 상담에 활용할 최근 기록을 찾지 못했습니다.",
                missing_sections=["blood_pressure", "liver_tests", "recent_medications"],
            )
        return snapshot

    async def _load_authoritative_evidence(
        self,
        request: HealthAssistantChatRequest,
        decision: HealthAssistantScopeDecision,
        *,
        account: ServiceAccount | None,
        profile_context: ProfileContext | None,
    ) -> tuple[list[Any], str | None]:
        """바운더리 판정이 요구한 근거 종류를 메인 LLM 호출 전에 서버가 직접 채운다.

        health_knowledge/health_records는 LLM이 도구를 "알아서" 부르게 두지 않는다 —
        모델이 도구를 안 부르거나 다른 도구를 먼저 부르면 근거가 영원히 안 채워지고,
        그 판단이 매 호출마다 달라질 수 있어 재현도 안 된다. 여기서 결정론적으로
        채우고, 메인 LLM은 이미 채워진 근거를 요약·설명만 한다.

        바운더리가 이미 내린 판정(``decision.required_evidence_types``)을 그대로
        신뢰해서 근거를 채운다 — 여기서 같은 판단을 별도 키워드로 다시 하면,
        판정과 근거 로딩이 서로 다른 기준으로 어긋날 수 있다.
        """
        if not decision.requires_authoritative_evidence or not request.messages:
            return [], None

        required = set(decision.required_evidence_types)
        if not required & {"health_knowledge", "health_records"}:
            return [], None

        # 원문("당뇨에 좋은 음식")보다 쿼리 빌더가 만든 enriched_query("당뇨병 환자의
        # 식이요법 안내" 같은)가 포털 제목과 더 가깝게 맞는다 — 원문 그대로 검색하면
        # 관련 없는 문서가 걸리기 쉽다.
        query = request.enriched_query or request.messages[-1].content
        raw_query = request.messages[-1].content
        results: list[Any] = []
        snapshot_lines: list[str] = []
        knowledge_lines: list[str] = []

        # 개인 건강기록 스냅샷은 아직 음주 주제만 구현돼 있다. 다른 주제의 개인기록
        # 스냅샷이 생기면 여기에 분기를 추가하면 된다.
        if "health_records" in required and is_alcohol_topic(raw_query):
            snapshot = await self._fetch_alcohol_snapshot(account=account, profile_context=profile_context)
            results.append(snapshot)
            snapshot_lines = ["[개인 건강기록 스냅샷]", snapshot.model_dump_json(exclude_none=True)]

        if "health_knowledge" in required:
            knowledge = await self.health_knowledge_client.search(query)
            if not knowledge.items:
                # 포털은 문장이 아니라 주제어에 매칭된다 — "임신 중인데 달리기 해도 돼?"
                # 도 "임신 중 달리기 안전성" 도 0건이지만 "임신 운동" 은 3건이다
                # (2026-09-16 실측). 1차가 비었을 때만 주제어로 줄여 한 번 더 본다.
                fallback_query = normalize_knowledge_query(query)
                if fallback_query and fallback_query != query:
                    knowledge = await self.health_knowledge_client.search(fallback_query)
            # 카탈로그/포털에 아직 없는 주제는 items가 빈 채로 돌아온다. 그걸 그대로
            # results에 넣으면 "근거를 하나도 못 채웠다"는 사전 차단 게이트가 빈 결과도
            # "뭔가 채워졌다"고 착각해서, 실제로는 근거가 없는데도 메인 LLM 호출까지
            # 새어나간다. 빈 결과는 근거가 아니므로 넣지 않는다.
            if knowledge.items:
                results.append(knowledge)
                knowledge_lines.append("[질병관리청 국가건강정보포털 근거]")
                for item in knowledge.items:
                    knowledge_lines.append(f"- {item.title}: {item.summary} (출처: {item.url})")

        if not results:
            return [], None

        lines = snapshot_lines + knowledge_lines
        return results, "\n".join(lines) if lines else None

    @classmethod
    def _needs_medication_info(cls, request: HealthAssistantChatRequest) -> bool:
        """의약품 허가정보(효능·부작용·주의사항) 조회가 실제로 필요한 질문인지 판별한다.

        - 단순 복약 기록 발화("저녁 8시에 타이레놀 1알 복용했어", "혈압약 먹음")는 기록 의도이므로 검색 도구를 부르지 않는다.
        - 효능, 부작용, 복용법, 주의사항 등을 묻는 질문형 발화에만 검색 도구를 활성화한다.
        """
        if not request.messages:
            return False
        last_msg = cls._get_eval_text(request)
        # 1) 의약품 키워드가 반드시 있어야 함
        if not mentions_medication(last_msg):
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

    @classmethod
    def _needs_facility_tools(cls, request: HealthAssistantChatRequest) -> bool:
        """의료시설 조회 도구가 실제로 필요한 질문인지 판별한다."""
        if not request.messages:
            return False
        last_msg = cls._get_eval_text(request)
        compact_msg = last_msg.replace(" ", "")
        # 날씨나 대기질을 묻는 질문은 의료시설 조회가 아님
        if any(w in last_msg for w in ("날씨", "미세먼지", "초미세먼지", "대기질")):
            return False
        # 직전에 시설 위치를 물었으면 "고양시에 있어요" 같은 자연스러운 위치 답변도
        # 시설 검색으로 이어져야 한다. 이 검사를 아래 일반 위치 발화 차단보다 먼저 둔다.
        if len(request.messages) >= 2:
            prev_msg = request.messages[-2]
            if prev_msg.role == "assistant" and is_facility_location_followup(prev_msg.content, last_msg):
                return True
        # 단순히 거주지나 위치만 말한 경우("난 서울살아", "종로구에 있어")도 시설 조회가 아님
        if any(last_msg.strip().endswith(suffix) for suffix in ("살아", "살아요", "있어", "있어요")) and not any(
            k in last_msg for k in ("병원", "약국", "응급실", "의원")
        ):
            return False
        has_facility = any(k in last_msg for k in FACILITY_KEYWORDS)
        has_search_intent = any(k in last_msg for k in FACILITY_SEARCH_KEYWORDS)
        if has_facility and has_search_intent:
            return True
        # "강남응급실", "서울 내과"처럼 짧은 검색어만 입력한 경우는 허용하되,
        # 과거 진료·복약 상담 문장은 시설 검색으로 오인하지 않는다.
        if (
            has_facility
            and len(compact_msg) <= 15
            and not any(k in last_msg for k in FACILITY_HISTORY_OR_ADVICE_KEYWORDS)
        ):
            return True
        if any(k in last_msg for k in ("어디 가야", "어디로 가")):
            return True
        return False

    async def _resolve_request_location(
        self, request: HealthAssistantChatRequest, needs_outdoor: bool, client_ip: str | None = None
    ) -> UserLocation | None:
        """동의된 좌표를 우선하고, 야외 질문의 사용자 장소명만 보조적으로 좌표화한다. 둘 다 없으면 IP 기반으로 추정한다."""
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

        if needs_outdoor:
            for message in reversed(recent_user_messages):
                resolved_place = await self.outdoor_conditions_client.resolve_location(message.content)
                if resolved_place:
                    lat, lon, address = resolved_place
                    return UserLocation(latitude=lat, longitude=lon, address=address)

        return await self._resolve_location_by_ip(client_ip)

    @staticmethod
    async def _resolve_location_by_ip(client_ip: str | None) -> UserLocation | None:
        """좌표도 장소명도 없을 때의 마지막 폴백. 실패하면 조용히 None — 위치는 있으면 좋은 것이지 필수가 아니다."""
        if not client_ip:
            return None
        if client_ip in ("127.0.0.1", "::1", "localhost", "testclient"):
            # 로컬 개발용 폴백 (서울)
            return UserLocation(latitude=37.5665, longitude=126.9780, address="서울특별시")
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"http://ip-api.com/json/{client_ip}?lang=ko")
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("status") == "success":
                        return UserLocation(
                            latitude=data["lat"],
                            longitude=data["lon"],
                            address=data.get("city", data.get("regionName", "알 수 없는 지역")),
                        )
        except Exception:
            logger.debug("IP 기반 위치 추정 실패", exc_info=True)

        return None

    async def _load_outdoor_conditions(self, loc: UserLocation | None):
        if loc is None:
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
                            side = concept.get("side") or body.get("side")
                            region = concept.get("region") or body.get("region")
                            side_kr = {"left": "왼쪽", "right": "오른쪽", "bilateral": "양쪽", "midline": "중앙"}.get(
                                side, side or ""
                            )
                            side_parts = [p for p in (side_kr, region) if p]
                            side_desc = " ".join(side_parts)
                            area_part = f"{label}({side_desc})" if side_desc and side_desc not in label else label
                            rad = coverage.get("radius")
                            cov_part = f", 반경 {rad}" if rad is not None else ""
                            note_part = r.payload.get("note") or r.payload.get("sensation") or ""
                            desc = f": {note_part}" if note_part else ""
                            summaries.append(f"[{date_str}] 통증[3D해부학: {area_part}{cov_part}]{desc}")
                            continue
                    summaries.append(f"[{date_str}] {r.record_type}: {r.payload}")
                context.recent_records_summary = "; ".join(summaries)[:2000]
        except Exception:
            pass

    @staticmethod
    def _needs_recent_records(request: HealthAssistantChatRequest) -> bool:
        """일반 인사나 비건강 잡담에는 건강기록을 조회·주입하지 않는다.

        건강정보는 '필요할 때만 전달'하는 원칙(Issue #102)을 준수하며,
        통증·증상·복약·혈압·혈당 등 건강 관련 맥락이 감지될 때만 선별 보강한다.
        """
        if not request.messages:
            return False
        content = request.messages[-1].content.strip()
        normalized = content.replace(" ", "")

        # 1) 명백한 인사말/잡담 단독 발화는 차단
        greeting_words = {
            "안녕",
            "안녕하세요",
            "안녕하십니까",
            "하이",
            "반가워",
            "반갑습니다",
            "좋은아침",
            "좋은아침입니다",
            "헬로",
            "방가",
        }
        if normalized in greeting_words:
            return False

        # 2) 감사/작별/단순 응답 등 잡담 차단
        chitchat_words = {
            "고마워",
            "감사합니다",
            "고맙습니다",
            "수고했어",
            "수고하세요",
            "잘있어",
            "잘가",
            "바이",
            "네",
            "응",
            "알겠어",
            "그래",
        }
        if normalized in chitchat_words:
            return False

        # 3) 건강/증상/부위/측정/기록 관련 키워드가 있는 경우에만 보강
        return any(
            kw in normalized
            for kw in (
                "통증",
                "아파",
                "아프",
                "결려",
                "쑤셔",
                "뻐근",
                "묵직",
                "저려",
                "찌릿",
                "혈압",
                "혈당",
                "당뇨",
                "수축기",
                "이완기",
                "체온",
                "약",
                "복용",
                "처방",
                "영양제",
                "운동",
                "스쿼트",
                "러닝",
                "달리",
                "걸었",
                "헬스",
                "건강",
                "기록",
                "수치",
                "검진",
                "술",
                "음주",
                "식사",
                "챌린지",
                "지난번",
                "최근",
                "어땠",
                "허리",
                "무릎",
                "어깨",
                "목",
                "등",
                "배",
                "머리",
                "가슴",
                "허벅지",
                "종아리",
                "발",
                "손",
            )
        )

    @classmethod
    def _needs_recent_records_context(cls, request: HealthAssistantChatRequest) -> bool:
        """건강기록 Tool Calling 요청은 요약 선조회 없이 툴 결과만 사용한다."""
        if not request.messages or cls._needs_health_record_query_tool(request):
            return False
        return cls._needs_recent_records(request)

    async def _enrich_context(
        self,
        context: ProfileContext | None,
        account_id: uuid.UUID | None = None,
        request: HealthAssistantChatRequest | None = None,
    ) -> ProfileContext | None:
        if context is None:
            return None
        if request is not None and not self._needs_recent_records_context(request):
            return context
        await self._enrich_records_summary(context, account_id=account_id)
        return context

    @property
    def llm_client(self) -> LLMClientProtocol:
        if self._llm_client is None:
            self._llm_client = shared_chat_client()
        return self._llm_client

    @property
    def classifier_llm_client(self) -> LLMClientProtocol:
        """바운더리 판정(범위·근거 종류 분류) 전용 client.

        `llm_client`가 생성자에 명시적으로 주입된 경우(테스트가 흔히 그런다)는 그
        client를 그대로 재사용한다 — 분류용을 따로 안 준 테스트가 갑자기 진짜
        네트워크를 부르게 되는 것을 막는다. 아무것도 안 준 경우(프로덕션 기본값)만
        `shared_classifier_client()`로 갈라진다.
        """
        if self._classifier_llm_client is not None:
            return self._classifier_llm_client
        if self._llm_client is not None:
            return self._llm_client
        return shared_classifier_client()

    async def _execute_tool(
        self,
        name: str,
        args: dict[str, Any],
        *,
        account: ServiceAccount | None = None,
        profile_id: uuid.UUID | None = None,
    ) -> Any:
        if name == "search_food_nutrition":
            return await execute_food_nutrition_tool(name, args, self.food_nutrition_client)
        if name == QUERY_HEALTH_RECORDS_TOOL_NAME:
            if account is None or profile_id is None or self.health_record_service is None:
                raise ValueError("건강기록 조회에 필요한 인증 프로필 정보가 없습니다.")
            return await execute_health_record_tool(
                name,
                args,
                account=account,
                profile_id=profile_id,
                record_service=self.health_record_service,
            )
        if name == "search_medication_info":
            return await execute_medication_tool(name, args, self.medication_client)
        return await execute_facility_tool(name, args, self.facility_client)

    def _get_tools(self, request: HealthAssistantChatRequest) -> list[Any] | None:
        """요청에 필요한 Tool 목록을 반환한다. 불필요한 툴은 포함하지 않는다.

        health_knowledge·outdoor는 여기 없다 — LLM이 호출 여부를 그때그때
        판단하게 두면 근거가 채워질 때도 있고 안 채워질 때도 있어서(재현 안 됨),
        `_load_authoritative_evidence`/`_load_outdoor_conditions`가 메인 LLM을
        부르기 전에 서버에서 결정론적으로 미리 채운다.
        """
        if self._needs_health_record_query_tool(request):
            return get_health_record_tools()
        tools: list[Any] = []
        if self._needs_facility_tools(request):
            tools.extend(get_facility_tools())
        if self._needs_medication_info(request):
            tools.extend(get_medication_tools())
        if self._needs_food_nutrition(request):
            tools.extend(get_food_nutrition_tools())

        return tools if tools else None

    @staticmethod
    def _attach_tool_result_to_response(  # noqa: C901
        response: HealthAssistantResponse,
        tool_result: Any,
    ) -> None:
        if tool_result is None:
            return
        if isinstance(tool_result, (list, tuple)):
            for item in tool_result:
                HealthAssistantService._attach_tool_result_to_response(response, item)
            return
        from app.dtos.food_nutrition import FoodNutritionSearchResult
        from app.dtos.health_knowledge import HealthKnowledgeSearchResult
        from app.dtos.health_record_query import AlcoholConsultationSnapshot, HealthRecordQueryResult
        from app.dtos.medication import MedicationSearchResult

        if isinstance(tool_result, FoodNutritionSearchResult):
            if not response.food_nutrition_search_result:
                response.food_nutrition_search_result = tool_result
        elif isinstance(tool_result, HealthKnowledgeSearchResult):
            response.health_knowledge_search_result = tool_result
        elif isinstance(tool_result, AlcoholConsultationSnapshot):
            response.alcohol_consultation_snapshot = tool_result
        elif isinstance(tool_result, HealthRecordQueryResult):
            response.intent = "query_records"
            response.health_record_query_result = tool_result
            response.assistant_message = tool_result.message
        elif isinstance(tool_result, MedicationSearchResult):
            if not response.medication_search_result:
                response.medication_search_result = tool_result
        elif not response.facility_search_draft:
            response.facility_search_draft = tool_result
            if getattr(tool_result, "message", None):
                response.assistant_message = tool_result.message

    @staticmethod
    def _profile_required_response() -> HealthAssistantResponse:
        return HealthAssistantResponse(
            intent="query_records",
            assistant_message="건강기록을 조회할 대상을 확인할 수 없습니다. 먼저 대화할 프로필을 선택해 주세요.",
            missing_fields=["profile_id"],
            needs_confirmation=False,
        )

    @staticmethod
    def _outdoor_location_required_response() -> HealthAssistantResponse:
        return HealthAssistantResponse(
            intent="health_advice",
            assistant_message=(
                "오늘 날씨와 대기질을 확인하려면 현재 위치 권한을 허용하거나 "
                "지역명을 알려주세요. 예를 들어 '서울 날씨'처럼 말씀해 주세요."
            ),
            missing_fields=["user_location"],
            needs_confirmation=False,
        )

    @staticmethod
    def _clear_unstated_pain_intensity(
        response: HealthAssistantResponse,
        request: HealthAssistantChatRequest,
    ) -> HealthAssistantResponse:
        """사용자가 말하지 않은 통증 수치를 LLM이 만들어도 저장 경로에서 제거한다."""
        if response.intent != "record_pain" or not request.messages:
            return response
        previous_assistant = ""
        for message in request.messages:
            if message.role != "user":
                previous_assistant = message.content
                continue
            if _EXPLICIT_PAIN_INTENSITY_PATTERN.search(message.content):
                return response
            # 앞선 질문이 강도를 물었다면 `2` 같은 숫자만의 답도 명시한 값이다.
            if _PAIN_INTENSITY_QUESTION_PATTERN.search(previous_assistant) and _BARE_INTENSITY_ANSWER_PATTERN.match(
                message.content.strip()
            ):
                return response

        changed = False
        if response.pain_draft is not None and response.pain_draft.intensity is not None:
            response.pain_draft.intensity = None
            changed = True
        if response.pain_diary_tool is not None and response.pain_diary_tool.intensity is not None:
            response.pain_diary_tool.intensity = None
            changed = True
        if changed:
            response.auto_save = False
            response.needs_confirmation = True
        return response

    @staticmethod
    def _remove_irrelevant_supplement_disclaimer(
        response: HealthAssistantResponse,
        request: HealthAssistantChatRequest,
    ) -> HealthAssistantResponse:
        """음식·식단의 '영양'을 영양제로 오인해 붙인 고정 문구를 제거한다."""
        """음식·식단의 '영양'을 영양제로 오인해 붙인 고정 문구와, LLM이 본문에 포함한 비진단 안전 고지를 제거한다."""
        conversation = " ".join(message.content for message in request.messages if message.role == "user")

        # LLM이 본문에 면책 조항을 포함한 경우 제거 (중복 노출 방지)
        disclaimers_to_remove = [
            "본 서비스는 의료 진단이나 처방을 대신하지 않습니다. 이상 징후가 있을 경우 의료진과 상담하세요.",
            "※ 본 서비스는 의료 진단이나 처방을 대신하지 않습니다. 이상 징후가 있을 경우 의료진과 상담하세요.",
            "제공해 드린 건강 정보는 참고용이며, 정확한 진단과 치료는 의료기관을 방문하여 전문의와 상담하시기 바랍니다.",
            "본 답변은 의학적 진단을 대신하지 않으며,",
        ]

        for disclaimer in disclaimers_to_remove:
            if disclaimer in response.assistant_message:
                response.assistant_message = response.assistant_message.replace(disclaimer, "").strip()

        if any(keyword in conversation for keyword in _SUPPLEMENT_TOPIC_KEYWORDS):
            return response
        if not response.assistant_message.startswith(_SUPPLEMENT_DISCLAIMER):
            return response

        cleaned = response.assistant_message.removeprefix(_SUPPLEMENT_DISCLAIMER).lstrip()
        if cleaned:
            response.assistant_message = cleaned
        return response

    async def _prepare_execution(
        self,
        request: HealthAssistantChatRequest,
        account: ServiceAccount | None,
        client_ip: str | None,
    ) -> HealthAssistantResponse | _PreparedExecution:
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            return safety_check

        boundary = await self.boundary_service.check_request(self.classifier_llm_client, request)
        if boundary.response:
            return boundary.response
        assert boundary.request is not None
        request = boundary.request

        needs_health_query = self._needs_health_record_query_tool(request) or self._needs_personal_record_evidence(
            request, boundary.decision
        )
        if needs_health_query and (
            request.profile_context is None
            or request.profile_context.profile_id is None
            or account is None
            or self.health_record_service is None
        ):
            return self._profile_required_response()

        account_id = account.id if account else None
        profile_context = await self._enrich_context(
            request.profile_context,
            account_id=account_id,
            request=request,
        )
        preloaded_results, authoritative_evidence_context = await self._load_authoritative_evidence(
            request,
            boundary.decision,
            account=account,
            profile_context=profile_context,
        )
        needs_outdoor = "outdoor" in boundary.decision.required_evidence_types
        loc = await self._resolve_request_location(request, needs_outdoor, client_ip)
        medical_required = bool(set(boundary.decision.required_evidence_types) & _MEDICAL_EVIDENCE_TYPES)
        if needs_outdoor and loc is None and not medical_required:
            return self._outdoor_location_required_response()
        outdoor_conditions = await self._load_outdoor_conditions(loc) if loc is not None else None
        system_instruction = build_system_instruction(
            profile_context,
            user_location=loc,
            outdoor_conditions_context=self._format_outdoor_conditions_context(outdoor_conditions, loc is not None)
            if (needs_outdoor and loc is not None)
            else None,
            authoritative_evidence_context=authoritative_evidence_context,
            session_core_memory=request.core_memory,
        )

        tools = self._get_tools(request)

        # [알잘딱깔센] 민감 개인 허가 질문에 대한 사전 차단 로직 제거
        # 임신 주차 계산, 알레르기 대체 약품 추천 등 고도의 추론을 위해 무조건 LLM에 컨텍스트를 넘긴다.

        return _PreparedExecution(
            request=request,
            decision=boundary.decision,
            profile_context=profile_context,
            preloaded_results=preloaded_results,
            outdoor_conditions=outdoor_conditions,
            system_instruction=system_instruction,
            tools=tools,
        )

    async def respond(
        self,
        request: HealthAssistantChatRequest,
        account: ServiceAccount | None = None,
        client_ip: str | None = None,
    ) -> HealthAssistantResponse:
        prepared = await self._prepare_execution(request, account, client_ip)
        if isinstance(prepared, HealthAssistantResponse):
            return prepared

        request = prepared.request
        response: HealthAssistantResponse
        client_any = cast(Any, self.llm_client)

        async def tool_executor(name: str, args: dict[str, Any]) -> Any:
            return await self._execute_tool(
                name,
                args,
                account=account,
                profile_id=self._parse_profile_id(prepared.profile_context.profile_id)
                if prepared.profile_context
                else None,
            )

        tool_result: Any | None = prepared.preloaded_results or None
        if prepared.tools and hasattr(client_any, "generate_structured_response_with_tools"):
            res_tuple = await client_any.generate_structured_response_with_tools(
                system_instruction=prepared.system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantLlmResponse,
                tools=prepared.tools,
                tool_executor=tool_executor,
            )
            llm_res, generated_tool_result = res_tuple
            if generated_tool_result is not None:
                tool_result = [*prepared.preloaded_results, generated_tool_result]
            response = HealthAssistantResponse.model_validate(llm_res.model_dump())
            self._attach_tool_result_to_response(response, tool_result)
        else:
            llm_res = await self.llm_client.generate_structured_response(
                system_instruction=prepared.system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantLlmResponse,
            )
            response = HealthAssistantResponse.model_validate(llm_res.model_dump())
            self._attach_tool_result_to_response(response, tool_result)

        response = self._remove_irrelevant_supplement_disclaimer(response, request)
        response = self._clear_unstated_pain_intensity(response, request)
        if prepared.outdoor_conditions and not response.outdoor_conditions:
            response.outdoor_conditions = prepared.outdoor_conditions
        validated_response = self.safety_service.validate_response(response)
        return self.boundary_service.enforce_grounding(
            prepared.decision,
            validated_response,
            tool_result=tool_result,
            outdoor_conditions=prepared.outdoor_conditions,
            messages=request.messages,
        )

    async def _get_stream_generator(
        self,
        request: HealthAssistantChatRequest,
        system_instruction: str,
        tools: list[Any] | None,
        tool_executor: Callable[[str, dict[str, Any]], Awaitable[Any]],
    ) -> tuple[AsyncIterator[str], Any]:
        client_any = cast(Any, self.llm_client)
        if tools and hasattr(client_any, "stream_structured_response_with_tools"):
            return await client_any.stream_structured_response_with_tools(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantLlmResponse,
                tools=tools,
                tool_executor=tool_executor,
            )
        return (
            self.llm_client.stream_structured_response(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantLlmResponse,
            ),
            None,
        )

    async def stream(  # noqa: C901 - 안전·권한·도구 경로를 한 흐름에서 스트리밍한다.
        self,
        request: HealthAssistantChatRequest,
        account: ServiceAccount | None = None,
        client_ip: str | None = None,
    ) -> AsyncIterator[tuple[str, Any]]:
        prepared = await self._prepare_execution(request, account, client_ip)
        if isinstance(prepared, HealthAssistantResponse):
            yield "delta", {"text": prepared.assistant_message}
            yield "result", prepared.model_dump(mode="json")
            return

        request = prepared.request
        raw = ""

        async def tool_executor(name: str, args: dict[str, Any]) -> Any:
            return await self._execute_tool(
                name,
                args,
                account=account,
                profile_id=self._parse_profile_id(prepared.profile_context.profile_id)
                if prepared.profile_context
                else None,
            )

        stream_gen, generated_tool_result = await self._get_stream_generator(
            request,
            prepared.system_instruction,
            prepared.tools,
            tool_executor,
        )
        generated_tool_results = (
            generated_tool_result
            if isinstance(generated_tool_result, list)
            else [generated_tool_result]
            if generated_tool_result is not None
            else []
        )
        tool_result: Any | None = [*prepared.preloaded_results, *generated_tool_results] or None

        if prepared.decision.requires_authoritative_evidence and not self.boundary_service.has_required_evidence(
            prepared.decision,
            tool_result,
            prepared.outdoor_conditions,
            messages=request.messages,
        ):
            response = self.boundary_service.enforce_grounding(
                prepared.decision,
                HealthAssistantResponse(intent="health_advice", assistant_message=""),
                tool_result=tool_result,
                outdoor_conditions=prepared.outdoor_conditions,
                messages=request.messages,
            )
            # 만약 enforce_grounding 이 차단(고정 응답)을 하지 않아 빈 문자열이 그대로 반환되었다면,
            # LLM이 직접 대답할 수 있도록 흐름을 이어간다.
            if response.assistant_message:
                yield "delta", {"text": response.assistant_message}
                yield "result", response.model_dump(mode="json")
                return

        if generated_tool_results:
            from app.dtos.food_nutrition import FoodNutritionSearchResult
            from app.dtos.health_record_query import HealthRecordQueryResult
            from app.dtos.medication import MedicationSearchResult

            for generated_tool in generated_tool_results:
                payload = (
                    generated_tool.model_dump(mode="json") if hasattr(generated_tool, "model_dump") else generated_tool
                )
                if isinstance(generated_tool, FoodNutritionSearchResult):
                    yield "food_nutrition", payload
                elif isinstance(generated_tool, HealthRecordQueryResult):
                    res_obj = HealthAssistantResponse(
                        intent="query_records",
                        assistant_message=generated_tool.message,
                        health_record_query_result=generated_tool,
                        outdoor_conditions=prepared.outdoor_conditions,
                    )
                    validated = self.safety_service.validate_response(res_obj)
                    validated = self.boundary_service.enforce_grounding(
                        prepared.decision,
                        validated,
                        tool_result=tool_result,
                        outdoor_conditions=prepared.outdoor_conditions,
                        messages=request.messages,
                    )
                    yield "delta", {"text": validated.assistant_message}
                    yield "result", validated.model_dump(mode="json")
                    return
                elif isinstance(generated_tool, MedicationSearchResult):
                    yield "medication", payload
                else:
                    yield "facility", payload
                    summary_msg = getattr(generated_tool, "message", None) or "주변 의료시설을 조회했습니다."
                    res_obj = HealthAssistantResponse(
                        intent="search_facility",
                        assistant_message=summary_msg,
                        facility_search_draft=generated_tool,
                        outdoor_conditions=prepared.outdoor_conditions,
                    )
                    validated = self.safety_service.validate_response(res_obj)
                    validated = self.boundary_service.enforce_grounding(
                        prepared.decision,
                        validated,
                        tool_result=tool_result,
                        outdoor_conditions=prepared.outdoor_conditions,
                        messages=request.messages,
                    )
                    yield "delta", {"text": validated.assistant_message}
                    yield "result", validated.model_dump(mode="json")
                    return

        async for piece in stream_gen:
            raw += piece

        try:
            llm_parsed = HealthAssistantLlmResponse.model_validate_json(raw)
            parsed = HealthAssistantResponse.model_validate(llm_parsed.model_dump())
            parsed = self._enrich_parsed_response(parsed, tool_result, prepared.outdoor_conditions)
        except Exception as ex:
            raise LlmProviderFailedError(f"응답 구조화 실패: {type(ex).__name__}") from ex

        parsed = self._remove_irrelevant_supplement_disclaimer(parsed, request)
        parsed = self._clear_unstated_pain_intensity(parsed, request)
        validated = self.safety_service.validate_response(parsed)
        validated = self.boundary_service.enforce_grounding(
            prepared.decision,
            validated,
            tool_result=tool_result,
            outdoor_conditions=prepared.outdoor_conditions,
            messages=request.messages,
        )
        # 생성 중인 문장을 먼저 전송하면 최종 safety/grounding이 차단해도
        # 이미 사용자에게 노출된다. 검증된 문장만 delta로 내보낸다.
        yield "delta", {"text": validated.assistant_message}
        yield "result", validated.model_dump(mode="json")

    @staticmethod
    def _enrich_parsed_response(
        parsed: HealthAssistantResponse,
        tool_result: Any,
        outdoor_conditions: Any,
    ) -> HealthAssistantResponse:
        HealthAssistantService._attach_tool_result_to_response(parsed, tool_result)
        if outdoor_conditions and not parsed.outdoor_conditions:
            parsed.outdoor_conditions = outdoor_conditions
        return parsed
