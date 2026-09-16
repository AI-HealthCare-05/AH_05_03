"""국가건강정보포털 질의를 주제어 형태로 다듬는다.

**포털은 문장이 아니라 주제어에 매칭된다.** 실측(2026-09-16):

    "임신 중인데 달리기 해도 돼?"   ->  0건
    "임신 중 달리기 안전성"         ->  0건   (그럴듯한 enriched_query 도 마찬가지)
    "임신 운동"                    ->  3건
    "무릎이 아픈데 산책해도 돼?"     ->  0건
    "무릎 운동"                    ->  1건
    "달리기" · "산책"               ->  0건   (활동어 단독은 안 걸린다)

그래서 `조건어 + 주제어` 형태로 줄인 **2차 질의**를 만든다. 1차(원문 또는
`enriched_query`)를 대체하지 않는다 — 1차가 결과를 냈으면 그게 더 구체적이다.
0건일 때만 한 번 더 시도한다.

여기 목록은 **안전 경계가 아니라 검색 품질**이다. 단어가 빠지면 결과가 0건으로
남아 기존처럼 안전하게 차단될 뿐, 근거 없는 답이 새어 나가지 않는다. 판정
키워드(`health_assistant_boundary`)와 성격이 달라 일부러 분리해 둔다.
"""

from __future__ import annotations

#: 활동을 가리키는 말. 포털에는 전부 "운동" 으로 색인돼 있다.
ACTIVITY_WORDS = (
    "달리기",
    "러닝",
    "조깅",
    "마라톤",
    "산책",
    "걷기",
    "걸어",
    "유산소",
    "자전거",
    "라이딩",
    "등산",
    "수영",
    "요가",
    "필라테스",
    "스쿼트",
    "웨이트",
    "근력",
    "운동",
)

_DIET_WORDS = ("음식", "식단", "식이", "먹어도", "섭취", "영양")

#: 조건어. 먼저 걸리는 것 하나만 쓴다 — 포털 질의는 짧을수록 잘 맞는다.
_CONDITION_WORDS = (
    "임신",
    "임산부",
    "산모",
    "무릎",
    "허리",
    "어깨",
    "발목",
    "손목",
    "골반",
    "팔꿈치",
    "고관절",
    "고혈압",
    "당뇨",
    "천식",
    "관절염",
    "심장",
    "신장",
    "협심증",
    "골다공증",
    "항암",
    "방사선",
    "투석",
    "암",
)

#: 포털이 쓰는 표제어로 맞춘다.
_CONDITION_ALIASES = {"임산부": "임신", "산모": "임신", "항암": "암", "방사선": "암"}


def mentions_activity(text: str) -> bool:
    """문장이 신체 활동을 가리키는지 본다."""
    return any(word in text.replace(" ", "") for word in ACTIVITY_WORDS)


def normalize_knowledge_query(text: str) -> str | None:
    """`조건어 + 주제어` 로 줄인 2차 질의. 만들 수 없으면 None.

    None 을 돌려주는 쪽이 안전하다 — 엉뚱한 질의로 관련 없는 문서를 끌어오는 것보다
    근거 없음으로 차단하는 편이 낫다.
    """
    compact = text.replace(" ", "")

    condition = next((word for word in _CONDITION_WORDS if word in compact), None)
    if condition is None:
        return None

    if any(word in compact for word in ACTIVITY_WORDS):
        topic = "운동"
    elif any(word in compact for word in _DIET_WORDS):
        topic = "식이"
    else:
        return None

    return f"{_CONDITION_ALIASES.get(condition, condition)} {topic}"
