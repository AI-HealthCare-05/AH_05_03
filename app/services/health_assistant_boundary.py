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
from app.dtos.health_knowledge import HealthKnowledgeSearchResult
from app.dtos.health_record_query import AlcoholConsultationSnapshot, HealthRecordQueryResult
from app.dtos.medical_facility import FacilitySearchResult
from app.dtos.medication import MedicationSearchResult
from app.dtos.outdoor_conditions import OutdoorConditionsResult
from app.integrations.llm.protocol import LLMClientProtocol
from app.prompts.health_assistant_boundary import build_health_assistant_scope_instruction
from app.services.facility_topic import (
    FACILITY_KEYWORDS,
    FACILITY_SEARCH_KEYWORDS,
    is_facility_location_followup,
)
from app.services.health_knowledge_catalog import is_alcohol_topic
from app.services.medication_topic import mentions_medication

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
PREGNANCY_SYMPTOM_EVIDENCE_MESSAGE = (
    "현재 연결된 공식 정보만으로는 임신 중 이 증상의 원인이나 안전 여부를 판단하기 어렵습니다. "
    "증상이 계속되거나 걱정된다면 담당 산부인과에 확인해 주세요."
)
PREGNANCY_MEDICATION_EVIDENCE_MESSAGE = (
    "임신 중 약이나 영양제의 새 복용은 임신 주수, 복용 목적, 처방 여부에 따라 달라 "
    "현재 연결된 공식 정보만으로 복용 여부나 용량을 판단하기 어렵습니다. "
    "처방받지 않은 약이나 영양제를 새로 시작하기 전에는 담당 산부인과 또는 약사에게 확인해 주세요."
)
CLASSIFICATION_FAILED_MESSAGE = (
    "질문을 정확히 이해하지 못했습니다. 건강과 관련된 내용을 조금 더 구체적으로 말씀해 주세요."
)
CLARIFICATION_PREFIX = "안전하게 안내하기 위해 한 가지만 먼저 확인할게요."
CLARIFICATION_FALLBACK_QUESTION = (
    "일반적인 건강정보가 필요한지, 현재 상태에 맞춘 개인적인 안내가 필요한지 알려주시겠어요?"
)
CLARIFICATION_QUESTIONS = {
    "request_goal": "본인의 건강 위험이 궁금하신가요, 아니면 가족을 돌보는 방법이 궁금하신가요?",
    "pregnancy_supplement_context": "현재 임신 주수와 복용하려는 이유, 처방받은 약인지, 복용 중인 약이나 영양제가 있는지 알려주시겠어요?",
    "pregnancy_symptom_context": "현재 임신 주수와 증상이 시작된 시점, 통증 정도, 함께 나타난 증상이 있나요?",
    "pain_record_context": "통증 기록을 위해 강도를 0~10점 중 몇 점인지 알려주시겠어요?",
    "exercise_safety_context": "현재 증상의 정도와 진단받은 질환 또는 의료진에게 들은 운동 제한이 있나요?",
    "medication_safety_context": "복용하려는 약의 이름과 현재 복용 중인 약, 진단받은 질환이 있나요?",
    "personal_health_context": CLARIFICATION_FALLBACK_QUESTION,
}


@dataclass(frozen=True)
class HealthAssistantBoundaryResult:
    request: HealthAssistantChatRequest | None
    decision: HealthAssistantScopeDecision
    response: HealthAssistantResponse | None = None


# 1. 하드 규칙 필터: 비속어, 욕설, 악의적 패턴
PROFANITY_PATTERN = re.compile(
    r"(시발|씨발|개새끼|좆|병신|닥쳐|지랄|미친놈|미친년|존나|좆같|개소리|호구|뒤져|꺼져)",
    re.IGNORECASE,
)

_PROMPT_ATTACK_KEYWORDS = (
    "이전 지침 무시",
    "지침을 무시",
    "시스템 프롬프트",
    "system prompt",
    "ignore previous instructions",
    "jailbreak",
    "탈옥",
)


def is_pregnancy_symptom_context(messages: list[ChatMessage]) -> bool:
    """현재 질문이 앞선 임신 맥락에 이어진 증상 호소인지 확인한다."""
    latest_user = next((message.content for message in reversed(messages) if message.role == "user"), "")
    compact = latest_user.replace(" ", "")
    pregnancy_was_mentioned = any(
        message.role == "user" and any(word in message.content for word in ("임신", "임산부", "산모"))
        for message in messages
    )
    has_symptom = any(
        word in compact for word in ("아파", "아픈", "통증", "당기", "당겨", "뭉치", "출혈", "어지", "구토")
    )
    return pregnancy_was_mentioned and has_symptom


def is_pregnancy_medication_question(messages: list[ChatMessage]) -> bool:
    """임신 맥락에서 개인의 약·영양제 복용 가능 여부를 묻는지 확인한다."""
    latest_user = next((message.content for message in reversed(messages) if message.role == "user"), "")
    compact = latest_user.replace(" ", "")
    pregnancy_was_mentioned = any(
        message.role == "user" and any(word in message.content for word in ("임신", "임산부", "산모"))
        for message in messages
    )
    mentions_supplement = any(
        word in compact for word in ("영양제", "엽산", "철분", "칼슘", "비타민", "오메가", "유산균", "마그네슘")
    )
    asks_to_take = any(
        phrase in compact for phrase in ("먹어도돼", "먹어도되", "복용해도", "복용할까", "먹을까", "시작해도", "추천")
    )
    return pregnancy_was_mentioned and asks_to_take and (mentions_supplement or mentions_medication(latest_user))


def is_pregnancy_medication_followup(messages: list[ChatMessage]) -> bool:
    """안전 확인 질문 뒤에 이어진 임신 중 약·영양제 답변인지 확인한다."""
    pregnancy_was_mentioned = any(
        message.role == "user" and any(word in message.content for word in ("임신", "임산부", "산모"))
        for message in messages
    )
    previous_assistant = next(
        (message.content for message in reversed(messages[:-1]) if message.role == "assistant"), ""
    )
    return pregnancy_was_mentioned and previous_assistant in {
        f"{CLARIFICATION_PREFIX} {CLARIFICATION_QUESTIONS['pregnancy_supplement_context']}",
        f"{CLARIFICATION_PREFIX} {CLARIFICATION_QUESTIONS['medication_safety_context']}",
    }


def hard_rule_filter(user_input: str) -> tuple[bool, str | None]:
    """1. 하드 규칙 필터 (정규식 및 하드 룰).

    - 악성 비속어/욕설 차단
    - 너무 짧거나 의미 없는 입력 차단 (공백 제외 길이 < 2 또는 자모음 나열)
    - 프롬프트 인젝션 패턴 차단
    """
    compact = user_input.replace(" ", "")
    # 프롬프트 공격/인젝션 차단
    if any(k in user_input or k.replace(" ", "") in compact for k in _PROMPT_ATTACK_KEYWORDS):
        return False, "부적절한 지시문이 감지되었습니다."

    # 비속어/욕설 차단
    if PROFANITY_PATTERN.search(compact):
        return False, "부적절한 비속어 또는 표현이 포함되어 있습니다."

    stripped = user_input.strip()

    # 단순 자음/모음만으로 구성된 무의미한 입력 (예: ㅋㅋ, ㅎㅎ, ㅠㅠ, ㅇㅇ)
    if re.fullmatch(r"[ㄱ-ㆎ\s]+", stripped):
        return False, "유효한 질문을 입력해 주세요."

    return True, None


_SERVICE_USAGE_EXACT = {
    "안녕",
    "안녕하세요",
    "안녕하십니까",
    "봄이 안녕",
    "봄이야 안녕",
    "봄아 안녕",
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


class HealthAssistantBoundaryService:
    """서비스 범위와 건강정보 근거 사용을 코드에서 강제한다.

    1. 하드 규칙 필터 (비속어, 초단문, 프롬프트 인젝션 등 0.001초 차단)
    2. 패스트패스 (일상 인사, 정형 기록 입력, 명확한 도구 질의 등 LLM 비용 절감)
    3. 애매한 경우에만 LLM 판정기(HealthAssistantScopeDecision)를 호출해 서비스 범위·
       근거 필요 여부·쿼리 보강을 한 번에 받는다.

    모델은 분류와 표현만 담당한다. 허용되지 않은 주제를 차단하고 공식 도구 결과가
    없는 건강 사실 답변을 폐기하는 결정은 이 서비스가 수행한다(``enforce_grounding``).
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

        previous_assistant_message = ""
        for message in reversed(messages[:-1]):
            if message.role == "assistant":
                previous_assistant_message = message.content
                break

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

        # 3. 명확한 단답형 응답 (숫자, 네/아니오 등) - 의학적 근거 검색 불필요
        is_short_answer = len(compact) <= 5 and (
            any(c.isdigit() for c in compact)
            or compact in ("응", "어", "네", "아니", "아니오", "아니요", "맞아", "아님", "없어", "있어", "몰라", "모름")
        )
        if is_short_answer:
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=False,
                required_evidence_types=[],
            )

        # 3. 명확한 건강 기록 입력 및 단순 조회 (혈압/혈당/복약/운동 수치 등록 및 기록/차트 조회)
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

        # 원인·치료를 묻지 않고 통증만 말한 경우는 의학적 조언 요청이 아니라 통증 기록 입력이다.
        # 이 경로를 판정 모델에 맡기면 근거 검색이 필요한 health_advice로 분류되어 기록도 못 남긴다.
        has_pain_statement = any(
            word in compact for word in ("아파", "아픈", "통증", "쑤셔", "저려", "결려", "뻐근", "시큰", "찌릿")
        )
        asks_pain_advice = any(
            word in compact for word in ("왜", "어떻게", "어떡", "원인", "치료", "괜찮", "병원", "위험", "심각")
        )
        has_urgent_symptom = any(
            word in compact for word in ("가슴", "흉통", "호흡", "숨이", "마비", "의식", "출혈", "실신", "경련")
        )
        if (
            has_pain_statement
            and not asks_pain_advice
            and not has_urgent_symptom
            and not is_pregnancy_symptom_context(messages)
        ):
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=False,
                required_evidence_types=[],
            )

        # 건강기록 단순 조회 / 차트 조회 (의학적 권고/원인/치료 문의가 아닌 단순 기록 열람)
        has_record_query_kw = any(
            k in compact for k in ("조회", "보여줘", "확인해줘", "그래프", "추이", "트렌드", "내역", "기록목록")
        )
        has_metric_kw = any(
            k in compact
            for k in (
                "혈압",
                "혈당",
                "간수치",
                "간기능",
                "ast",
                "alt",
                "ggt",
                "콜레스테롤",
                "검진",
                "몸무게",
                "체중",
                "기록",
            )
        )
        has_medical_advice_kw = any(
            k in compact
            for k in (
                "어때",
                "어떻게",
                "원인",
                "치료",
                "위험",
                "좋은",
                "나쁜",
                "낮추",
                "높이",
                "관리법",
                "왜",
                "위험해",
                "괜찮아",
            )
        )
        if has_record_query_kw and has_metric_kw and not has_medical_advice_kw:
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=False,
                required_evidence_types=[],
            )

        # 4. 명확한 단일/복합 도구 질의
        # 음주 상담 질의
        # NOTE: 주제 키워드는 health_knowledge_catalog.is_alcohol_topic() 하나로 모아뒀다.
        # 이 목록을 health_assistant.py가 따로 복사해 갖고 있으면, 한쪽만 고쳤을 때
        # 판정과 근거 로딩이 어긋날 위험이 있다.
        has_alcohol = is_alcohol_topic(compact)
        has_alcohol_intent = any(
            k in compact
            for k in (
                "마셔",
                "먹어",
                "될까",
                "되나",
                "돼",
                "되려나",
                "해도",
                "괜찮",
                "가능",
                "어때",
                "마실",
                "먹을",
                "금주",
                "절주",
            )
        )
        if has_alcohol and has_alcohol_intent:
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=True,
                required_evidence_types=["health_knowledge", "health_records"],
            )

        # 임신 중 개인 복용 가능 여부는 검색 결과가 없을 때 곧바로 거절하지 않는다.
        # 먼저 주수·목적·처방 여부를 고정 질문으로 확인해 모델의 임의 판단을 막는다.
        if is_pregnancy_medication_question(messages):
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=True,
                required_evidence_types=["health_knowledge"],
                response_mode="clarify",
                clarification_kind="pregnancy_supplement_context",
            )

        # 의약품 / 식품 / 시설
        # 식약처 의약품 / DUR 질의
        # NOTE: 의약품 여부 판정은 medication_topic.mentions_medication() 하나로 모아뒀다.
        # "약"을 부분 문자열로만 보면 "제약회사"도 걸려서, 근거는 필수라고 판정해놓고
        # 실제 도구는 안 붙는 사고(health_assistant.py._needs_medication_info와 기준이
        # 다름)가 났었다.
        if any(
            k in compact for k in ("효능", "부작용", "용법", "용량", "주의사항", "같이먹", "함께먹", "병용")
        ) and mentions_medication(compact):
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
        # NOTE: 키워드는 facility_topic 모듈 하나로 모아뒀다 — "영업중"이 여기만 있고
        # health_assistant.py의 실제 도구 연결 목록엔 없어서 조용히 차단된 적이 있다.
        if any(k in compact for k in FACILITY_KEYWORDS) and any(k in compact for k in FACILITY_SEARCH_KEYWORDS):
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=True,
                required_evidence_types=["facility"],
            )

        if is_facility_location_followup(previous_assistant_message, last_msg):
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=True,
                required_evidence_types=["facility"],
            )

        # 임신 맥락에서 새 증상만 짧게 말한 경우에는 지식 검색 실패 문구부터
        # 보여주지 않고, 판단에 필요한 상황을 서버의 고정 질문으로 먼저 확인한다.
        has_context_details = bool(re.search(r"\d+\s*(?:주|점|분|시간|일)", last_msg)) or any(
            word in compact for word in ("부터", "동안", "출혈", "분비물", "발열", "어지", "심해")
        )
        if is_pregnancy_symptom_context(messages) and not has_context_details:
            return HealthAssistantScopeDecision(
                scope="health",
                requires_authoritative_evidence=True,
                required_evidence_types=["health_knowledge"],
                response_mode="clarify",
                clarification_kind="pregnancy_symptom_context",
            )

        # 야외 활동 / 러닝 / 운동 / 날씨 / 대기질 질의
        outdoor_activity_keywords = (
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
            "한강",
        )
        outdoor_env_keywords = ("날씨", "미세먼지", "초미세먼지", "대기질")
        has_outdoor_activity = any(k in compact for k in outdoor_activity_keywords)
        has_outdoor_env = any(k in compact for k in outdoor_env_keywords)
        has_outdoor_intent = any(
            k in compact
            for k in (
                "어때",
                "어대",
                "괜찮",
                "할건",
                "할거",
                "할까",
                "해도돼",
                "해도되",
                "좋아",
                "뛸까",
                "갈까",
                "추천",
                "뭐할까",
                "계획",
                "예정",
            )
        )

        needs_outdoor = False
        if has_outdoor_env:
            needs_outdoor = True
        elif has_outdoor_activity and has_outdoor_intent:
            needs_outdoor = True
        elif len(messages) >= 2:
            prev_msg = messages[-2]
            if prev_msg.role == "assistant" and any(
                k in prev_msg.content for k in ("실시간 날씨", "날씨와 대기질", "외출 전 기온", "날씨를 확인")
            ):
                from app.services.outdoor_conditions_client import resolve_sido_coordinates

                if resolve_sido_coordinates(last_msg) is not None or "살아" in compact:
                    needs_outdoor = True

        if needs_outdoor:
            if not any(k in compact for k in ("고혈압", "당뇨", "심장", "신장", "천식", "협심증", "관절염")):
                return HealthAssistantScopeDecision(
                    scope="health",
                    requires_authoritative_evidence=True,
                    required_evidence_types=["outdoor"],
                )

        # 5. 그 외 복잡/혼합/애매한 질문은 LLM 판정기로 위임 (None 반환)
        return None

    async def check_request(
        self,
        llm_client: LLMClientProtocol,
        request: HealthAssistantChatRequest,
    ) -> HealthAssistantBoundaryResult:
        latest_user_message = self._latest_user_message(request.messages)

        # Step 1: 하드 규칙 필터 (비속어, 길이, 인젝션) — 0.001초, LLM 호출 없음
        passed, _reason = hard_rule_filter(latest_user_message)
        if not passed:
            return HealthAssistantBoundaryResult(
                request=None,
                decision=HealthAssistantScopeDecision(
                    scope="out_of_scope",
                    requires_authoritative_evidence=False,
                ),
                response=self._fixed_response(HEALTH_ONLY_MESSAGE),
            )

        # Step 2: 룰 기반 패스트패스 — 명확한 패턴은 LLM 호출 없이 즉시 판정
        decision = self._fast_path_decision(request.messages)

        # Step 3: 애매한 경우에만 LLM 판정 모델 호출
        if decision is None:
            try:
                decision = await llm_client.generate_structured_response(
                    system_instruction=build_health_assistant_scope_instruction(),
                    messages=request.messages,
                    response_schema=HealthAssistantScopeDecision,
                )
            except Exception:
                # 판정 실패 시 무조건 통과(fail-open)시키면, 이 판정이 걸러야 할 위험을
                # 그대로 흘려보낸다. 실패는 차단(fail-closed)하고 재질문을 유도한다.
                return HealthAssistantBoundaryResult(
                    request=None,
                    decision=HealthAssistantScopeDecision(
                        scope="unrecognized",
                        requires_authoritative_evidence=False,
                    ),
                    response=self._fixed_response(CLASSIFICATION_FAILED_MESSAGE),
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

        if decision.scope == "health" and decision.response_mode == "clarify":
            return HealthAssistantBoundaryResult(
                request=None,
                decision=decision,
                response=self._clarification_response(decision.clarification_kind),
            )

        if decision.scope == "mixed":
            allowed = (decision.allowed_health_request or "").strip()
            if not allowed or allowed not in latest_user_message:
                return HealthAssistantBoundaryResult(
                    request=None,
                    decision=decision,
                    response=self._fixed_response(HEALTH_ONLY_MESSAGE),
                )
            request = request.model_copy(update={"messages": [ChatMessage(role="user", content=allowed)]})
            return HealthAssistantBoundaryResult(request=request, decision=decision)

        if decision.inferred_intent or decision.enriched_query:
            request = request.model_copy(
                update={
                    "inferred_intent": decision.inferred_intent,
                    "enriched_query": decision.enriched_query,
                }
            )

        return HealthAssistantBoundaryResult(request=request, decision=decision)

    def enforce_grounding(
        self,
        decision: HealthAssistantScopeDecision,
        response: HealthAssistantResponse,
        *,
        tool_result: Any | None,
        outdoor_conditions: OutdoorConditionsResult | None,
        messages: list[ChatMessage] | None = None,
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
            if messages and is_pregnancy_symptom_context(messages):
                return self._fixed_response(PREGNANCY_SYMPTOM_EVIDENCE_MESSAGE, intent="health_advice")
            if messages and (is_pregnancy_medication_question(messages) or is_pregnancy_medication_followup(messages)):
                return self._fixed_response(PREGNANCY_MEDICATION_EVIDENCE_MESSAGE, intent="health_advice")
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
            return True
        return required.issubset(cls.available_evidence_types(tool_result, outdoor_conditions))

    @classmethod
    def available_evidence_types(  # noqa: C901
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
        if isinstance(tool_result, HealthKnowledgeSearchResult):
            if tool_result.items:
                available.add("health_knowledge")
        if isinstance(tool_result, MedicationSearchResult):
            if tool_result.items or tool_result.interaction_items:
                available.add("medication")
        if isinstance(tool_result, FacilitySearchResult):
            available.add("facility")
        if isinstance(tool_result, (HealthRecordQueryResult, AlcoholConsultationSnapshot)):
            available.add("health_records")
        return available

    @staticmethod
    def _latest_user_message(messages: list[ChatMessage]) -> str:
        for message in reversed(messages):
            if message.role == "user":
                return message.content
        return ""
        return next((m.content for m in reversed(messages) if m.role == "user"), "")

    @staticmethod
    def _fixed_response(message: str, *, intent: HealthIntent = "general_chat") -> HealthAssistantResponse:
        return HealthAssistantResponse(
            intent=intent,
            assistant_message=message,
            safety_disclaimer=None,
            missing_fields=[],
            suggested_quick_replies=[],
        )

    @classmethod
    def _clarification_response(cls, clarification_kind: str) -> HealthAssistantResponse:
        # 사용자에게 표시할 문장은 LLM이 작성하지 않는다. 분류값만 받아 서버의
        # 검토된 고정 문구를 선택하므로 한국어 어미 변형으로 안전 필터를 우회할 수 없다.
        safe_question = CLARIFICATION_QUESTIONS.get(clarification_kind, CLARIFICATION_FALLBACK_QUESTION)
        return cls._fixed_response(f"{CLARIFICATION_PREFIX} {safe_question}", intent="health_advice")
