from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.dtos.food_nutrition import FoodNutritionSearchResult
from app.dtos.health_assistant import (
    ChatMessage,
    HealthAssistantChatRequest,
    HealthAssistantClinicalContext,
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
from app.services.health_knowledge_query import mentions_activity
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


#: 통증 기록 패스트패스가 "순수한 진술"인지 가릴 때 쓰는 **문장 형태** 기준.
#: 조언의 의미 목록이 아니다 — `asks_pain_advice` 에 `괜찮`·`위험`은 있고 `해도 돼`가
#: 없어서 같은 질문이 말투 하나로 갈렸다(2026-09-15). 의미 목록은 새 표현이 나올 때마다
#: 빠지지만, 한국어 종결어미와 허가 구문은 닫힌 문법 집합이라 그렇게 늘어나지 않는다.
#: 통증 진술 단어. 통증 기록 패스트패스와 야외 규칙의 예외가 **같은 목록**을 본다.
#: 두 벌로 두면 한쪽만 늘어나고 다른 쪽이 조용히 뚫린다.
_PAIN_WORDS = ("아파", "아픈", "통증", "쑤셔", "저려", "결려", "뻐근", "시큰", "찌릿")
#: "몸에 조건이 걸린 상태". 이런 사람의 "이거 해도 되나" 는 날씨 질문이 아니라
#: 개인 안전 판단이다. 상태 이름은 닫힌 집합이라 조언 표현처럼 무한히 늘지 않는다.
_CHRONIC_CONDITION_WORDS = ("고혈압", "당뇨", "심장", "신장", "천식", "협심증", "관절염")
_EXPLICIT_CHRONIC_CONDITION_WORDS = (
    "고혈압",
    "당뇨",
    "천식",
    "협심증",
    "관절염",
    "심장질환",
    "심부전",
    "신장질환",
    "만성신장",
)
_PREGNANCY_WORDS = ("임신", "임산부", "산모")
_TREATMENT_WORDS = ("암치료", "항암", "방사선치료", "투석")
_URGENT_SYMPTOM_WORDS = ("가슴", "흉통", "호흡", "숨이", "마비", "의식", "출혈", "실신", "경련")
_EXPLICIT_MEDICATION_CONTEXT_WORDS = (
    "약물",
    "복약",
    "복용",
    "처방",
    "영양제",
    "혈압약",
    "당뇨약",
    "혈당약",
    "피임약",
    "감기약",
    "소화제",
    "진통제",
    "소염진통제",
    "항생제",
    "위장약",
    "타이레놀",
    "아스피린",
)
#: 판정이 성립하려면 모델이 **직접 돌려줘야** 하는 필드. 기본값으로 조용히 채워진
#: 판정은 "무릎이 아파" 를 `information` 이라고 말하게 되고, 그 값을 읽는 안전 조건이
#: 조용히 죽는다.
_REQUIRED_DECISION_FIELDS = frozenset({"request_kind", "clinical_contexts"})

_CLINICAL_CONTEXT_ORDER: tuple[HealthAssistantClinicalContext, ...] = (
    "pregnancy",
    "symptom",
    "chronic_condition",
    "medication",
    "treatment",
)


def _mentions_conditioned_body(compact: str) -> bool:
    """개인 안전 판단이 필요한 신체 조건이 언급됐는지 본다."""
    return any(word in compact for word in _CHRONIC_CONDITION_WORDS + _PREGNANCY_WORDS + _TREATMENT_WORDS + _PAIN_WORDS)


def detect_explicit_protected_contexts(messages: list[ChatMessage]) -> set[str]:
    """원문에 명시된 보호 맥락만 고정밀도로 복구한다.

    조언 의도를 분류하는 함수가 아니다. LLM이 명백한 임신·증상·질환·복약·치료
    단서를 놓쳤을 때 안전 하한선을 복구하는 센티널로만 사용한다.
    """
    user_text = "\n".join(message.content for message in messages if message.role == "user")
    compact = user_text.replace(" ", "")
    contexts: set[str] = set()

    if any(word in compact for word in _PREGNANCY_WORDS):
        contexts.add("pregnancy")
    if any(word in compact for word in _PAIN_WORDS + _URGENT_SYMPTOM_WORDS):
        contexts.add("symptom")
    if any(word in compact for word in _EXPLICIT_CHRONIC_CONDITION_WORDS):
        contexts.add("chronic_condition")
    if any(word in compact for word in _TREATMENT_WORDS):
        contexts.add("treatment")
    if mentions_medication(user_text) and any(word in compact for word in _EXPLICIT_MEDICATION_CONTEXT_WORDS):
        contexts.add("medication")

    return contexts


_REQUEST_ENDINGS = ("줘", "주세요", "주라", "다오", "부탁", "부탁해", "부탁드려")
#: 의문 종결과 글자가 겹치는 평서형("아프구나"의 `나")을 먼저 건져 낸다.
_STATEMENT_ENDINGS = ("구나", "더라", "거든", "네요", "군요", "는데요")
_QUESTION_ENDINGS = ("까", "나", "니", "냐", "죠", "지요", "돼", "되", "는지", "을지", "은가", "는가")
#: "~해도 되/돼/괜찮" 처럼 허가를 구하는 구문. 물음표를 안 찍어도 질문이다.
#:
#: 어미 앞 글자를 열거하면 안 된다 — 한국어는 종결어미가 어간에 붙어 `타도`(타+도)·
#: `봐도`·`써도` 처럼 글자가 무한히 갈린다. `아|어|여|해|러|려` 만 봤다가
#: "자전거 타도 돼?" 를 놓쳤다(2026-09-16). 앞 글자는 한글 한 자면 충분하다.
#: `좋`은 제외한다. "무릎도 좋아졌고 발목이 아파"의 상태 변화를 허가 질문으로
#: 오인해 통증 기록 경로를 삼키기 때문이다.
_PERMISSION_PATTERN = re.compile(r"[가-힣]도\s*(?:되|돼|괜찮|무방|상관|괜챦)")


#: 개인 의료 판단을 뒷받침할 수 있는 근거 종류. 날씨·음식·시설·기록은 그 자체로
#: "이 사람에게 이 행동이 안전한가" 를 지지하지 못한다.
_MEDICAL_EVIDENCE_TYPES = frozenset({"health_knowledge", "medication"})


def _fast_path_contexts(messages: list[ChatMessage]) -> list[HealthAssistantClinicalContext]:
    """패스트패스가 선언할 임상 맥락. 원문에 명시된 것만 담고, 없으면 `["none"]`.

    패스트패스도 두 필드를 **반드시 명시**한다. 기본값에 기대면 "무릎이 아파" 가
    `information` 이라고 말하게 되고(유령 입력 — AGENTS.md 6번), 그 값을 읽는
    `enforce_grounding` 의 조건이 조용히 죽는다. 판별은 센티널 하나를 공유한다.
    """
    contexts = detect_explicit_protected_contexts(messages)
    return [context for context in _CLINICAL_CONTEXT_ORDER if context in contexts] or ["none"]


def _asks_activity_clearance(messages: list[ChatMessage]) -> bool:
    """몸에 조건이 있는 사람이 활동 가능 여부를 물었는지 본다."""
    latest_user = next((message.content for message in reversed(messages) if message.role == "user"), "")
    if not (mentions_activity(latest_user) or _recent_activity_clearance(messages)):
        return False
    return bool(detect_explicit_protected_contexts(messages)) and asks_personal_clearance(messages)


def _recent_activity_clearance(messages: list[ChatMessage]) -> bool:
    """직전 활동 질문을 바로 잇는 짧은 후속 발화만 보수적으로 연결한다.

    모든 과거 질문을 합치면 새 주제로 전환한 뒤에도 오래된 허가 요청이 살아난다.
    그래서 최근 두 사용자 발화만 보고, 최신 발화가 임상 맥락 추가 또는 짧은
    수락 표현일 때에만 직전 질문을 이어받는다.
    """
    user_turns = [message.content for message in messages if message.role == "user"]
    if len(user_turns) < 2:
        return False
    previous, latest = user_turns[-2:]
    if not mentions_activity(previous):
        return False
    previous_compact = previous.replace(" ", "")
    if detect_explicit_protected_contexts([ChatMessage(role="user", content=latest)]):
        return bool(_PERMISSION_PATTERN.search(previous_compact))
    short_followups = {"응알려줘", "네알려줘", "알려줘", "응", "네", "그래", "좋아"}
    if latest.replace(" ", "").rstrip(".!?。！？") not in short_followups:
        return False
    has_previous_context = bool(detect_explicit_protected_contexts([ChatMessage(role="user", content=previous)]))
    return has_previous_context and (bool(_PERMISSION_PATTERN.search(previous_compact)) or "어때" in previous_compact)


def asks_personal_clearance(messages: list[ChatMessage]) -> bool:
    """원문이 "나에게 이게 괜찮은가"를 묻는 허가 구문인지 본다.

    `clinical_contexts` 에 센티널을 둔 것과 같은 이유다. `request_kind` 도 LLM 만
    채우는 필드라, LLM 이 개인 조언 질문을 `information` 으로 잘못 주면 불변조건이
    아예 안 걸린다 — 센티널이 맥락을 복구해도 조건의 다른 쪽이 False 라 무근거로
    통과한다(2026-09-15). 판별은 `_PERMISSION_PATTERN` 하나를 공유한다.
    """
    latest_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
    pending_question = _pending_question(messages)
    return (
        bool(_PERMISSION_PATTERN.search(latest_user.replace(" ", "")))
        or bool(pending_question and _PERMISSION_PATTERN.search(pending_question.replace(" ", "")))
        or _recent_activity_clearance(messages)
    )


def _pending_question(messages: list[ChatMessage]) -> str | None:
    """직전 확인 질문에 대한 짧은 답이면 바로 앞 사용자 요청을 되살린다."""
    if len(messages) < 3 or messages[-1].role != "user" or messages[-2].role != "assistant":
        return None
    reply = messages[-1].content.strip()
    if not reply or len(reply) > 30 or "?" in reply or "？" in reply:
        return None
    if not any(mark in messages[-2].content for mark in ("?", "？")):
        return None
    return next((message.content for message in reversed(messages[:-2]) if message.role == "user"), None)


def _contextual_enriched_query(messages: list[ChatMessage], decision: HealthAssistantScopeDecision) -> str | None:
    query = decision.enriched_query
    previous = _pending_question(messages)
    if previous and decision.scope == "health" and previous not in (query or ""):
        return f"{previous} {query or ''}".strip()
    return query


def _is_pure_statement(text: str) -> bool:
    """통증 진술이 질문·요청이 아니라 순수한 기록 입력인지 문장 형태로 가른다.

    틀리는 방향이 중요하다. 여기서 틀려 `False` 가 되면 판정이 LLM 으로 넘어가
    1.4~1.8초가 더 걸릴 뿐이지만, `True` 로 틀리면 의료 조언이 근거 0건으로 나간다.
    그래서 조금이라도 질문·요청으로 보이면 `False` 쪽으로 기운다.
    """
    stripped = text.strip()
    if not stripped:
        return False
    if "?" in stripped or "？" in stripped:
        return False

    compact = stripped.replace(" ", "")
    if _PERMISSION_PATTERN.search(compact):
        return False

    tail = stripped.rstrip(".。!！~… \t\n")
    if not tail:
        return False
    # 요청형이 먼저다 — "알려주세요" 는 평서형처럼 `요` 로 끝나지만 요청이다.
    if any(tail.endswith(end) for end in _REQUEST_ENDINGS):
        return False
    if any(tail.endswith(end) for end in _STATEMENT_ENDINGS):
        return True
    return not any(tail.endswith(end) for end in _QUESTION_ENDINGS)


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
                request_kind="information",
                clinical_contexts=["none"],
                requires_authoritative_evidence=False,
            )

        # 2. 명확한 일상 인사 / 사용법 문의
        cleaned = re.sub(r"[!?.~^]+", "", last_msg).strip()
        if cleaned in _SERVICE_USAGE_EXACT or compact in {k.replace(" ", "") for k in _SERVICE_USAGE_EXACT}:
            return HealthAssistantScopeDecision(
                scope="service_usage",
                request_kind="information",
                clinical_contexts=["none"],
                requires_authoritative_evidence=False,
            )

        # 3. 확인 질문에 대한 짧은 답은 이전 요청과 함께 판정 모델에 맡긴다.
        # 통증 점수 확인만 기존 기록 경로를 유지한다.
        is_pain_score_followup = any(c.isdigit() for c in compact) and previous_assistant_message == (
            f"{CLARIFICATION_PREFIX} {CLARIFICATION_QUESTIONS['pain_record_context']}"
        )
        if _pending_question(messages) and not is_pain_score_followup:
            return None

        # 맥락이 없는 명확한 단답형 입력
        is_short_answer = len(compact) <= 5 and (
            any(c.isdigit() for c in compact)
            or compact in ("응", "어", "네", "아니", "아니오", "아니요", "맞아", "아님", "없어", "있어", "몰라", "모름")
            or compact
            in (
                "응",
                "어",
                "네",
                "아니",
                "아니오",
                "아니요",
                "맞아",
                "아님",
                "없어",
                "있어",
                "몰라",
                "모름",
                "ㅇ",
                "ㅇㅇ",
                "ㄴ",
                "ㄴㄴ",
                "ㅇㅋ",
                "넵",
                "넹",
            )
            or compact
            in (
                "응",
                "어",
                "네",
                "아니",
                "아니오",
                "아니요",
                "맞아",
                "아님",
                "없어",
                "있어",
                "몰라",
                "모름",
                "ㅇ",
                "ㅇㅇ",
                "ㄴ",
                "ㄴㄴ",
                "ㅇㅋ",
                "넵",
                "넹",
                "ㄱㄱ",
                "고고",
                "응응",
            )
            or compact
            in (
                "응",
                "어",
                "네",
                "아니",
                "아니오",
                "아니요",
                "맞아",
                "아님",
                "없어",
                "있어",
                "몰라",
                "모름",
                "ㅇ",
                "ㅇㅇ",
                "ㄴ",
                "ㄴㄴ",
                "ㅇㅋ",
                "넵",
                "넹",
                "ㄱㄱ",
                "고고",
                "응응",
            )
        )
        if is_short_answer:
            return HealthAssistantScopeDecision(
                scope="health",
                request_kind="operation" if is_pain_score_followup else "information",
                clinical_contexts=["symptom"] if is_pain_score_followup else ["none"],
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
                request_kind="operation",
                clinical_contexts=_fast_path_contexts(messages),
                requires_authoritative_evidence=False,
                required_evidence_types=[],
            )

        # 통증만 말한 경우는 의학적 조언 요청이 아니라 통증 기록 입력이다. 이 경로를
        # 판정 모델에 맡기면 근거 검색이 필요한 health_advice로 분류되어 기록도 못 남긴다.
        #
        # **다만 "조언 단어가 없으면 기록" 은 기본값이 틀렸다.** `asks_pain_advice` 에
        # `괜찮`·`위험`은 있고 `해도 돼`가 없어서, 같은 질문이 말투 하나로 갈렸다:
        #   "무릎이 아픈데 산책해도 돼?"    -> 기록(근거 요구 0건)
        #   "무릎이 아픈데 산책해도 괜찮아?" -> outdoor(날씨만)
        #   "무릎이 아픈데 산책하면 위험해?" -> LLM 위임
        # 셋 다 "아픈데 운동해도 되나"를 묻는 같은 질문이다. 그래서 순수한 진술임을
        # `_is_pure_statement` 로 **증명했을 때만** 기록으로 확정한다. 증명에 실패하면
        # 판정을 LLM 에 넘긴다 — 틀려도 안전한 쪽으로 틀린다.
        has_pain_statement = any(word in compact for word in _PAIN_WORDS)
        asks_pain_advice = any(
            word in compact for word in ("왜", "어떻게", "어떡", "원인", "치료", "괜찮", "병원", "위험", "심각")
        )
        has_urgent_symptom = any(word in compact for word in _URGENT_SYMPTOM_WORDS)
        if (
            has_pain_statement
            and _is_pure_statement(last_msg)
            and not asks_pain_advice
            and not has_urgent_symptom
            and not is_pregnancy_symptom_context(messages)
        ):
            return HealthAssistantScopeDecision(
                scope="health",
                request_kind="operation",
                clinical_contexts=["symptom"],
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
                request_kind="operation",
                clinical_contexts=_fast_path_contexts(messages),
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
                request_kind="personalized_advice",
                clinical_contexts=_fast_path_contexts(messages),
                requires_authoritative_evidence=True,
                required_evidence_types=["health_knowledge", "health_records"],
            )

        # 임신 중 개인 복용 가능 여부는 검색 결과가 없을 때 곧바로 거절하지 않는다.
        # 먼저 주수·목적·처방 여부를 고정 질문으로 확인해 모델의 임의 판단을 막는다.
        if is_pregnancy_medication_question(messages):
            return HealthAssistantScopeDecision(
                scope="health",
                request_kind="personalized_advice",
                clinical_contexts=["pregnancy", "medication"],
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
                request_kind="information",
                clinical_contexts=_fast_path_contexts(messages),
                requires_authoritative_evidence=True,
                required_evidence_types=["medication"],
            )

        # 식품 영양성분 질의
        if any(k in compact for k in ("칼로리", "열량", "나트륨", "당류", "영양성분")) and any(
            k in compact for k in ("라면", "짜장", "짬뽕", "찌개", "음식", "밥", "고기", "치킨", "피자")
        ):
            return HealthAssistantScopeDecision(
                scope="health",
                request_kind="information",
                clinical_contexts=_fast_path_contexts(messages),
                requires_authoritative_evidence=True,
                required_evidence_types=["food_nutrition"],
            )

        # 주변 의료시설 / 응급실 / 약국 질의
        # NOTE: 키워드는 facility_topic 모듈 하나로 모아뒀다 — "영업중"이 여기만 있고
        # health_assistant.py의 실제 도구 연결 목록엔 없어서 조용히 차단된 적이 있다.
        if any(k in compact for k in FACILITY_KEYWORDS) and any(k in compact for k in FACILITY_SEARCH_KEYWORDS):
            return HealthAssistantScopeDecision(
                scope="health",
                request_kind="information",
                clinical_contexts=_fast_path_contexts(messages),
                requires_authoritative_evidence=True,
                required_evidence_types=["facility"],
            )

        if is_facility_location_followup(previous_assistant_message, last_msg):
            return HealthAssistantScopeDecision(
                scope="health",
                request_kind="information",
                clinical_contexts=_fast_path_contexts(messages),
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
                request_kind="personalized_advice",
                clinical_contexts=["pregnancy", "symptom"],
                requires_authoritative_evidence=True,
                required_evidence_types=["health_knowledge"],
                response_mode="clarify",
                clarification_kind="pregnancy_symptom_context",
            )

        # 야외 활동 / 러닝 / 운동 / 날씨 / 대기질 질의
        outdoor_place_keywords = ("야외", "밖에서", "외출", "한강")
        outdoor_env_keywords = ("날씨", "미세먼지", "초미세먼지", "대기질")
        has_outdoor_place = any(k in compact for k in outdoor_place_keywords)
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
        ) or bool(_PERMISSION_PATTERN.search(compact))
        # `해도돼`만 나열하면 `뛰어도 돼`·`걸어도 되나` 가 샌다. 허가 구문은 한 곳에서 본다.

        needs_outdoor = False
        if has_outdoor_env:
            needs_outdoor = True
        elif has_outdoor_place and has_outdoor_intent:
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
            # 몸에 조건이 걸린 사람의 "이거 해도 되나" 는 날씨 질문이 아니다. 이 예외는
            # 원래도 있었지만 만성질환 일곱 개뿐이어서, 성격이 같은 통증·임신·치료중이
            # 목록에 없다는 이유만으로 날씨를 근거로 답해졌다(2026-09-15):
            #   "무릎이 아픈데 산책해도 돼?"  -> outdoor (무릎과 미세먼지는 무관하다)
            #   "무릎이 아픈데 수영해도 돼?"  -> LLM    (수영이 야외 활동 목록에 없어서)
            # 같은 질문이 활동 단어 하나로 갈렸다. 상태 쪽을 기준으로 맞춘다.
            if not _mentions_conditioned_body(compact):
                return HealthAssistantScopeDecision(
                    scope="health",
                    request_kind="information",
                    clinical_contexts=["none"],
                    requires_authoritative_evidence=True,
                    required_evidence_types=["outdoor"],
                )

        # 5. 그 외 복잡/혼합/애매한 질문은 LLM 판정기로 위임 (None 반환)
        return None

    async def _classify(
        self,
        llm_client: LLMClientProtocol,
        request: HealthAssistantChatRequest,
    ) -> HealthAssistantScopeDecision | None:
        """패스트패스로 확정하거나, 애매하면 판정 모델에 맡긴다. 실패하면 None."""
        decision = self._fast_path_decision(request.messages)
        if decision is not None:
            return decision
        try:
            return await llm_client.generate_structured_response(
                system_instruction=build_health_assistant_scope_instruction(),
                messages=request.messages,
                response_schema=HealthAssistantScopeDecision,
            )
        except Exception:
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

        # Step 2~3: 룰 기반 패스트패스, 안 걸리면 LLM 판정 모델
        decision = await self._classify(llm_client, request)
        if decision is None:
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

        # 정규화 **전에** 본다. 기본값이 채워진 뒤에는 모델이 실제로 필드를 돌려줬는지
        # 구별할 수 없다 — `model_fields_set` 은 값이 우연히 기본값과 같아도 "명시함" 으로
        # 남는다. 누락은 판정이 성립하지 않은 것이므로 건강 사실을 만들지 않고 끝낸다.
        if not _REQUIRED_DECISION_FIELDS.issubset(decision.model_fields_set):
            return HealthAssistantBoundaryResult(
                request=None,
                decision=decision,
                response=self._clarification_response("personal_health_context"),
            )

        decision = self._validate_and_normalize_decision(request.messages, decision)

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

        enriched_query = _contextual_enriched_query(request.messages, decision)
        if decision.inferred_intent or enriched_query:
            request = request.model_copy(
                update={
                    "inferred_intent": decision.inferred_intent,
                    "enriched_query": enriched_query,
                }
            )

        return HealthAssistantBoundaryResult(request=request, decision=decision)

    @classmethod
    def _validate_and_normalize_decision(
        cls,
        original_messages: list[ChatMessage],
        decision: HealthAssistantScopeDecision,
    ) -> HealthAssistantScopeDecision:
        """LLM·패스트패스 판정을 같은 의료 안전 불변조건으로 정규화한다."""
        if decision.scope not in {"health", "mixed"}:
            return decision

        llm_contexts = set(decision.clinical_contexts)
        llm_contexts.discard("none")
        effective_contexts = llm_contexts | detect_explicit_protected_contexts(original_messages)
        normalized_contexts = [context for context in _CLINICAL_CONTEXT_ORDER if context in effective_contexts]
        if not normalized_contexts:
            normalized_contexts = ["none"]

        required = list(dict.fromkeys(decision.required_evidence_types))
        asks_clearance = decision.request_kind == "personalized_advice" or asks_personal_clearance(original_messages)
        needs_clinical_evidence = asks_clearance and bool(effective_contexts)

        if needs_clinical_evidence or (decision.requires_authoritative_evidence and not required):
            if "medication" in effective_contexts and "medication" not in required:
                required.append("medication")
            if effective_contexts & {"pregnancy", "symptom", "chronic_condition", "treatment"}:
                if "health_knowledge" not in required:
                    required.append("health_knowledge")

        update: dict[str, Any] = {"clinical_contexts": normalized_contexts}
        if required:
            update.update(
                {
                    "required_evidence_types": required,
                    "requires_authoritative_evidence": True,
                }
            )
        elif decision.requires_authoritative_evidence:
            # 근거가 필요하다는 판정만 있고 종류가 없으면 어떤 도구도 안전하게
            # 선택할 수 없다. 건강 사실을 생성하지 않고 검토된 고정 질문으로 끝낸다.
            update.update(
                {
                    "requires_authoritative_evidence": False,
                    "response_mode": "clarify",
                    "clarification_kind": "personal_health_context",
                }
            )

        return decision.model_copy(update=update)

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
        if response.emergency_notice and not self._has_trusted_facility_notice(
            tool_result, response.emergency_notice, response.intent
        ):
            # 이 필드도 생성 모델이 채운다. 본문·경고를 그대로 보내면 근거 검사와
            # 응답 의도 라벨을 모두 우회할 수 있으므로 서버의 고정 응급 안내만 보낸다.
            notice = "응급 상황이 의심되면 즉시 119에 연락하거나 가까운 응급실을 방문하세요."
            return self._fixed_response(notice, intent="health_advice").model_copy(update={"emergency_notice": notice})

        # [알잘딱깔센] 획일적 무근거 차단 폐지.
        # 일반 질문은 LLM의 지능적 판단(히스토리 교차 검증)을 존중하여 통과시키고,
        # 법적/의학적 치명도가 매우 높은 특정 고위험군(임신 중 약물/증상)만 최후의 보루로 차단한다.
        # 단, 해당 위험군이라도 실제 승인된 근거(has_evidence)가 있다면 통과시킨다.
        has_evidence = self.has_required_evidence(
            decision, tool_result, outdoor_conditions, response.intent, messages=messages
        )
        if has_evidence:
            return response

        if messages and is_pregnancy_symptom_context(messages):
            return self._fixed_response(PREGNANCY_SYMPTOM_EVIDENCE_MESSAGE, intent="health_advice")
        if messages and (is_pregnancy_medication_question(messages) or is_pregnancy_medication_followup(messages)):
            return self._fixed_response(PREGNANCY_MEDICATION_EVIDENCE_MESSAGE, intent="health_advice")
        if messages and _asks_activity_clearance(messages):
            return self._clarification_response("exercise_safety_context")

        # 그 외의 모든 경우, KDCA 근거가 없더라도 LLM의 답변을 신뢰하여 반환한다.
        return response

    @classmethod
    def _has_trusted_facility_notice(cls, tool_result: Any | None, notice: str, intent: str) -> bool:
        """서버 시설 조회가 실제로 낸 응급 고지만 모델 생성 고지와 구분한다."""
        if intent != "search_facility":
            return False
        if isinstance(tool_result, (list, tuple)):
            return any(cls._has_trusted_facility_notice(item, notice, intent) for item in tool_result)
        return isinstance(tool_result, FacilitySearchResult) and tool_result.emergency_notice == notice

    @classmethod
    def _is_personal_medical_clearance(
        cls,
        decision: HealthAssistantScopeDecision,
        messages: list[ChatMessage] | None,
    ) -> bool:
        """원문과 판정을 함께 보고 "개인 의료 판단 요청" 인지 정한다.

        생성 모델이 자기 응답을 뭐라고 라벨하든 이 값은 바뀌지 않는다. 근거 검사를
        여는 조건이 전부 앞 단계의 자기 신고(`decision.requires_authoritative_evidence`,
        `response.intent`)에만 걸려 있으면, 라벨 하나로 검사 전체를 건너뛸 수 있다 —
        `enforce_grounding` 은 앞 단계가 틀렸을 때 잡으라고 있는 관문이므로 앞 단계를
        믿는 조건만 두면 관문이 아니다(2026-09-16).
        """
        asks_advice = decision.request_kind == "personalized_advice" or asks_personal_clearance(messages or [])
        contexts = (set(decision.clinical_contexts) - {"none"}) | detect_explicit_protected_contexts(messages or [])
        return asks_advice and bool(contexts)

    @classmethod
    def has_required_evidence(
        cls,
        decision: HealthAssistantScopeDecision,
        tool_result: Any | None,
        outdoor_conditions: OutdoorConditionsResult | None,
        intent: str = "general_chat",
        *,
        messages: list[ChatMessage] | None = None,
    ) -> bool:
        required = set(decision.required_evidence_types)
        clearance = cls._is_personal_medical_clearance(decision, messages)
        if not required:
            # 근거 종류가 비어 있으면 무엇을 확인해야 할지 모른다. 건강 조언이거나
            # 개인 의료 판단 요청이면 "확인할 것이 없다" 가 아니라 "확인하지 못했다" 다.
            return not (intent == "health_advice" or clearance)
        available = cls.available_evidence_types(tool_result, outdoor_conditions)
        if required.issubset(available):
            return True

        # 부분 답변(Partial Grounding) 정책:
        # 민감 맥락의 개인 허가 질문(임신, 만성질환 등)에서 필수 의료 근거(health_knowledge 등)가
        # 확보되었다면, 부가적인 야외 환경(outdoor) 정보가 누락되었더라도
        # 공식 의료 지침에 기반한 부분 답변 생성을 허용한다.
        if clearance and required - available <= {"outdoor"}:
            required_medical = required & _MEDICAL_EVIDENCE_TYPES
            if required_medical and required_medical.issubset(available):
                return True

        return False

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
