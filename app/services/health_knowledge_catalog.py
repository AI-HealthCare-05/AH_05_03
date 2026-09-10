"""승인된 공식 건강정보의 최소 수직 슬라이스.

국가건강정보포털 OpenAPI는 신청한 콘텐츠를 승인받은 뒤 세부 계약이 공개된다.
첫 음주 상담이 API 승인 상태에 묶이지 않도록, 출처와 갱신일을 사람이 확인한
공식 문서의 좁은 요약만 제공한다. 범용 의학 지식 폴백이 아니다.

## 왜 주제별 버킷인가

처음에는 음주 주제 하나만 있었다. 그런데 바운더리의 `required_evidence_types`에
`health_knowledge`가 걸리는 질문은 음주 말고도 많다 — 예를 들어 서비스 범위
판정기(`app/prompts/health_assistant_boundary.py`) 자체가 예시로 드는
"고혈압에 좋은 운동 알려줘"도 그렇다. 그런데 이 카탈로그에 고혈압 항목이 없으면
그 질문은 (판정은 맞게 하고도) 근거를 하나도 못 채워서 항상 차단된다.
그래서 주제를 열거형으로 하나 더 늘리는 대신, 주제별 키워드 → 문서 버킷 구조로
바꿔서 앞으로 다른 주제(당뇨, 이상지질혈증 등)를 추가하기 쉽게 한다.

새 버킷을 추가할 때도 원칙은 그대로다 — **국가건강정보포털에서 실제로 열어
확인한 문서만** 넣는다. 없는 주제는 빈 목록을 돌려주는 것이 맞다. 근거 없이
일반화하는 것보다 "확인된 공식 정보가 없다"고 정직하게 답하는 편이 낫다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol
from zoneinfo import ZoneInfo

from app.dtos.health_knowledge import HealthKnowledgeItem, HealthKnowledgeSearchResult

_SEOUL = ZoneInfo("Asia/Seoul")

#: 음주 주제 판별에 쓰는 키워드. `health_assistant.py`(개인기록 스냅샷 로딩 여부)와
#: `health_assistant_boundary.py`(fast-path 범위 판정)가 예전에는 이 목록을
#: 각자 따로 복사해 갖고 있었다 — 한쪽만 고치면 판정과 근거 로딩이 어긋나는
#: 사고가 나기 쉬워서, 여기 하나로 모으고 `is_alcohol_topic()`으로 노출한다.
ALCOHOL_TOPIC_KEYWORDS = ("술", "음주", "알코올", "맥주", "소주", "와인", "막걸리", "위스키", "양주", "한잔", "반주")

#: 국가건강정보포털에서 실제로 열어 확인한 고혈압 문서 3건 (2026-09-10 확인).
HYPERTENSION_TOPIC_KEYWORDS = ("고혈압", "혈압")

_ALCOHOL_ITEMS = [
    HealthKnowledgeItem(
        title="음주",
        url="https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=5297",
        summary=(
            "과도한 음주는 혈압을 상승시키고 혈압약의 효과를 감소시킬 수 있습니다. "
            "간질환이 있거나 간기능 검사에 이상이 있다면 음주 허용 여부를 일반화하지 말고 금주를 우선해 상담해야 합니다."
        ),
        topics=["alcohol", "blood_pressure", "liver"],
    ),
    HealthKnowledgeItem(
        title="알코올 간질환",
        url="https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=5310",
        summary=(
            "음주량과 빈도가 간 손상 위험에 중요하며, 알코올 간질환 치료의 핵심은 금주입니다. "
            "간기능 검사 이상이 있으면 음주를 계속하지 말고 의료진과 원인을 확인해야 합니다."
        ),
        topics=["alcohol", "liver"],
    ),
]

_HYPERTENSION_ITEMS = [
    HealthKnowledgeItem(
        title="고혈압",
        url="https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=6765",
        summary=(
            "수축기혈압 140mmHg 이상 또는 이완기혈압 90mmHg 이상이면 고혈압입니다. "
            "관리 목표는 일반 환자 140/90mmHg 미만, 고위험군은 130/80mmHg 미만이며, "
            "음주는 남성 하루 2잔 이하·여성 하루 1잔 이하로 줄이거나 가능하면 금주를 권장하고, "
            "염분 6g 이하 섭취, 체질량지수 25kg/m² 미만 유지, 금연이 함께 권고됩니다."
        ),
        topics=["hypertension", "alcohol", "bmi"],
        content_updated_at="2026-04-27",
    ),
    HealthKnowledgeItem(
        title="고혈압 환자의 식이요법",
        url="https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=5999",
        summary="고혈압 환자는 염분 섭취를 줄이고 채소·과일 위주 식단(DASH 식이)을 유지하는 것이 혈압 관리에 도움이 됩니다.",
        topics=["hypertension", "diet"],
    ),
    HealthKnowledgeItem(
        title="고혈압 환자의 운동요법",
        url="https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=5303",
        summary=(
            "주 5회 이상, 하루 30분 이상 걷기·조깅·자전거 타기 같은 유산소 운동이 혈압 관리에 효과적이며, "
            "생활습관 개선만으로도 혈압약 한 가지에 필적하는 효과를 낼 수 있습니다."
        ),
        topics=["hypertension", "exercise"],
    ),
]

#: (주제 판별 키워드, 해당 주제의 공식 문서 목록). 새 주제를 추가할 때는
#: 이 목록에 한 줄만 더하면 된다 — 단, 문서는 반드시 국가건강정보포털에서
#: 실제로 열어 확인한 뒤에만 추가한다.
_TOPIC_BUCKETS: tuple[tuple[tuple[str, ...], list[HealthKnowledgeItem]], ...] = (
    (ALCOHOL_TOPIC_KEYWORDS, _ALCOHOL_ITEMS),
    (HYPERTENSION_TOPIC_KEYWORDS, _HYPERTENSION_ITEMS),
)


def is_alcohol_topic(text: str) -> bool:
    """메시지가 음주 주제를 다루는지 판별한다.

    개인 건강기록(간수치·혈압 등) 스냅샷을 붙일지 결정하는 유일한 판단 기준이다.
    의도(질문/평서문 등)는 보지 않는다 — 그건 바운더리의 fast-path가 이미
    (더 보수적으로) 판단했거나, 애매하면 LLM 판정기가 판단한다. 여기서는
    "이미 근거가 필요하다고 정해졌는데, 그 주제가 음주인가"만 본다.
    """

    compact = text.replace(" ", "")
    return any(word in compact for word in ALCOHOL_TOPIC_KEYWORDS)


class HealthKnowledgeClientProtocol(Protocol):
    async def search(self, query: str) -> HealthKnowledgeSearchResult: ...


class HealthKnowledgeCatalogClient:
    async def search(self, query: str) -> HealthKnowledgeSearchResult:
        compact = query.replace(" ", "").lower()
        items: list[HealthKnowledgeItem] = []
        seen_urls: set[str] = set()
        for keywords, bucket_items in _TOPIC_BUCKETS:
            if not any(word in compact for word in keywords):
                continue
            for item in bucket_items:
                if item.url in seen_urls:
                    continue
                items.append(item)
                seen_urls.add(item.url)
        return HealthKnowledgeSearchResult(
            query=query,
            items=items,
            retrieved_at=datetime.now(_SEOUL),
            message=(
                f"질병관리청 국가건강정보포털 공식 문서 {len(items)}건을 확인했습니다."
                if items
                else "승인된 공식 건강정보에서 관련 문서를 찾지 못했습니다."
            ),
        )
