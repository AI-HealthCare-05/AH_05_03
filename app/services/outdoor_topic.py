"""야외 활동/환경 질문 주제 키워드 — health_assistant.py와 health_assistant_boundary.py가
공유한다.

`health_assistant.py`의 `_needs_outdoor_conditions`(날씨·대기질 API를 실제로 부를지
정함)와 `health_assistant_boundary.py`의 fast-path(이 질문에 `outdoor` 근거가
필요하다고 판정할지 정함)가 예전에는 이 키워드 목록을 각자 따로 갖고 있었다.
그런데 두 목록이 서로 달랐다 — "유산소"는 앞쪽에만 있고 fast-path에는 없었다.

그 결과 "오늘 유산소 추천" 같은 질문은 날씨 API는 정상 조회되는데
(`_needs_outdoor_conditions`가 True), fast-path는 이 질문을 못 알아채서 일반 LLM
분류기로 넘겼다. 그 분류기 프롬프트에는 outdoor 예시가 아예 없어서 대개
health_knowledge를 요구하는 것으로 판정했고, 실제로 채워진 근거(outdoor)와
요구된 근거(health_knowledge)가 어긋나 항상 차단됐다 — 음주 상담에서 겪었던
것과 같은 유형의 사고다. 여기 하나로 모은다.
"""

from __future__ import annotations

OUTDOOR_ENVIRONMENT_KEYWORDS = ("날씨", "미세먼지", "초미세먼지", "대기질")

OUTDOOR_ACTIVITY_KEYWORDS = (
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


def is_outdoor_topic(text: str) -> bool:
    """메시지가 야외 활동/환경 주제를 다루는지 판별한다 (활동 키워드 또는 환경 키워드)."""

    compact = text.replace(" ", "")
    return any(word in compact for word in OUTDOOR_ACTIVITY_KEYWORDS) or any(
        word in compact for word in OUTDOOR_ENVIRONMENT_KEYWORDS
    )
